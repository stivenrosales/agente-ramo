import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "../config.js";
import {
  database,
  type ConversationStateRow,
  type ConversationStateValue,
} from "./database.js";
import { chatwoot } from "./chatwoot.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const MODEL = "google/gemini-3.1-flash-lite-preview";
const LIMA_OFFSET_HOURS = -5; // GMT-5 fijo (Perú no usa DST)

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: config.openrouterApiKey,
});

export function isWithinBusinessHoursLima(now: Date = new Date()): boolean {
  // Convertir "now" a hora Lima sin depender de Intl/TZ del sistema.
  const limaMs = now.getTime() + LIMA_OFFSET_HOURS * 3600 * 1000;
  const lima = new Date(limaMs);
  // Usamos getUTC* porque aplicamos el offset manualmente.
  const dayUtc = lima.getUTCDay(); // 0=Dom ... 6=Sáb
  const isoDay = dayUtc === 0 ? 7 : dayUtc; // 1=Lun ... 7=Dom
  const hour = lima.getUTCHours();

  const { businessDaysIso, businessHours } = config.ramo;
  if (!businessDaysIso.includes(isoDay)) return false;
  if (hour < businessHours.startHour) return false;
  if (hour >= businessHours.endHour) return false;
  return true;
}

interface MiniDecision {
  accion: "enviar" | "cerrar";
  mensaje?: string;
  nuevo_estado: "open" | "rejected" | "done";
}

const SYSTEM_PROMPT = `Eres un supervisor de ventas de Ramo LATAM (consultora SAP Business One en Perú).
Analiza esta conversación que quedó sin respuesta 30+ min. Decide si vale la pena enviar UN follow-up personalizado o mejor cerrarla.

Criterios para enviar: cliente mostró interés real, dejó la conversación a medias (abandonó dando datos), quedó esperando respuesta nuestra, o hay oportunidad clara.
Criterios para cerrar: cliente dijo que no, hostil, fuera de nuestro perfil, o conversación ya cerró con claridad (pero no agendó).

Si envías: mensaje corto (2-3 líneas), cálido, referencia su caso específico, NO robótico. No re-preguntes cosas que ya respondió. Respeta el tono Ramo (cálido, profesional, peruano, mezcla tú/usted según la conversación).

Retorna SOLO JSON válido con esta forma exacta:
{"accion":"enviar"|"cerrar","mensaje":"...","nuevo_estado":"open"|"rejected"|"done"}
- Si accion="cerrar", omite "mensaje".
- Si accion="enviar", usa nuevo_estado="open".
Nada más, sin markdown, sin explicaciones.`;

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // Tolerar fences ```json ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenceMatch ? fenceMatch[1] : trimmed;
  // Buscar primer bloque que parezca objeto
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("no JSON object found");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

async function decideFollowup(
  contactKey: string,
): Promise<MiniDecision | null> {
  const contact = await database.getContact(contactKey);
  const historyAll = await database.getHistory(contactKey);
  const history = historyAll.slice(-15);

  if (history.length === 0) return null;

  const contactBrief = contact
    ? `Datos del contacto:
- nombre: ${contact.name ?? "—"}
- empresa: ${contact.empresa ?? "—"}
- cargo: ${contact.cargo ?? "—"}
- ruc: ${contact.ruc ?? "—"}
- correo: ${contact.email ?? "—"}
- necesidad: ${contact.necesidad ?? "—"}
- modalidad: ${contact.modalidad ?? "—"}`
    : "Datos del contacto: (sin ficha)";

  const transcript = history
    .map(
      (m) => `${m.role === "user" ? "CLIENTE" : "BOT"}: ${m.content}`,
    )
    .join("\n");

  const userMsg = `${contactBrief}

Últimos ${history.length} mensajes (más antiguo primero):
${transcript}

Decide si enviar follow-up o cerrar. Retorna solo el JSON.`;

  let raw = "";
  try {
    const result = await generateText({
      model: openrouter(MODEL),
      system: SYSTEM_PROMPT,
      prompt: userMsg,
      temperature: 0.4,
      maxTokens: 400,
    });
    raw = result.text;
  } catch (err) {
    console.warn("[followup] generateText error:", err);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    console.warn("[followup] JSON parse fallido:", err, "raw:", raw);
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const accion = obj.accion;
  const nuevo_estado = obj.nuevo_estado;
  const mensaje = obj.mensaje;

  if (accion !== "enviar" && accion !== "cerrar") return null;
  if (
    nuevo_estado !== "open" &&
    nuevo_estado !== "rejected" &&
    nuevo_estado !== "done"
  ) {
    return null;
  }

  if (accion === "enviar") {
    if (typeof mensaje !== "string" || !mensaje.trim()) return null;
    if (mensaje.length > 500) return null;
    return { accion, mensaje: mensaje.trim(), nuevo_estado: "open" };
  }

  return { accion, nuevo_estado: nuevo_estado as "rejected" | "done" };
}

async function processOne(row: ConversationStateRow): Promise<void> {
  const decision = await decideFollowup(row.contact_key);

  if (!decision) {
    // Mini-IA no pudo decidir: cerrar como 'done' para no reintentar eternamente.
    await database.setConversationState(row.contact_key, "done");
    await database.markFollowupSent(row.contact_key);
    return;
  }

  if (decision.accion === "enviar" && decision.mensaje) {
    // Race guard: re-consultar candidatos; si el row ya no está, el cliente
    // respondió entre medio (touchConversation reseteó) o ya se procesó.
    const fresh = await database.getFollowupCandidates();
    if (!fresh.find((r) => r.contact_key === row.contact_key)) {
      console.log(
        `[followup] ${row.contact_key} ya no es candidato, abort envío`,
      );
      return;
    }
    await chatwoot.sendMessages(row.conversation_id, decision.mensaje);
    await database.markFollowupSent(row.contact_key);
    await database.setConversationState(
      row.contact_key,
      decision.nuevo_estado as ConversationStateValue,
    );
    console.log(`[followup] enviado a ${row.contact_key}`);
  } else {
    await database.setConversationState(
      row.contact_key,
      decision.nuevo_estado as ConversationStateValue,
    );
    await database.markFollowupSent(row.contact_key);
    console.log(
      `[followup] cerrado ${row.contact_key} -> ${decision.nuevo_estado}`,
    );
  }
}

async function tick(): Promise<void> {
  if (!isWithinBusinessHoursLima()) return;
  try {
    const rows = await database.getFollowupCandidates();
    if (rows.length === 0) return;
    console.log(`[followup] ${rows.length} candidatas para revisar`);
    for (const row of rows) {
      try {
        await processOne(row);
      } catch (err) {
        console.error("[followup] error procesando", row.contact_key, err);
      }
    }
  } catch (err) {
    console.error("[followup] tick error:", err);
  }
}

export function startFollowupScheduler(): void {
  console.log(
    `🔁 Follow-up scheduler iniciado (cada ${CHECK_INTERVAL_MS / 1000}s)`,
  );
  setInterval(() => void tick(), CHECK_INTERVAL_MS);
}
