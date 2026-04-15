import { generateText } from "ai";
import { database } from "./database.js";
import { chatwoot } from "./chatwoot.js";
import { openrouter, AGENT_MODEL } from "./agent.js";

export interface SummaryInput {
  contactKey: string;
  reason: "booked" | "escalated";
  extra?: Record<string, string | null | undefined>;
}

function nowLimaTimestamp(): string {
  const fmt = new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(new Date()) + " (Lima)";
}

function humanizeIsoLima(iso: string | null | undefined): string {
  if (!iso) return "no definida";
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat("es-PE", {
      timeZone: "America/Lima",
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    return fmt.format(d);
  } catch {
    return iso;
  }
}

function buildPrompt(
  contact: Awaited<ReturnType<typeof database.getContact>>,
  history: Awaited<ReturnType<typeof database.getHistory>>,
  input: SummaryInput,
): string {
  const contactBlock = contact
    ? [
        `Nombre: ${contact.name ?? "no brindado"}`,
        `Empresa: ${contact.empresa ?? "no brindada"}`,
        `Cargo: ${contact.cargo ?? "no brindado"}`,
        `RUC: ${contact.ruc ?? "no brindado"}`,
        `Correo: ${contact.email ?? "no brindado"}`,
        `Teléfono: ${contact.phone ?? "no brindado"}`,
        `Necesidad: ${contact.necesidad ?? "no registrada"}`,
        `Modalidad: ${contact.modalidad ?? "no definida"}`,
      ].join("\n")
    : "Sin ficha de contacto registrada.";

  const historyBlock = history
    .slice(-20)
    .map((m) => `${m.role === "user" ? "Cliente" : "Bot"}: ${m.content}`)
    .join("\n");

  const extraBlock = input.extra
    ? Object.entries(input.extra)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
    : "";

  const estadoInstruccion =
    input.reason === "booked"
      ? `Estado: "✅ Agendó consultoría para ${humanizeIsoLima(
          (input.extra?.fecha_iso as string) ?? null,
        )} (${input.extra?.modalidad ?? "modalidad no definida"})"`
      : `Estado: "🔔 Pide hablar con asesor humano — ${
          input.extra?.razon ?? "razón no especificada"
        }"`;

  return `Eres un asistente interno que resume conversaciones comerciales para el equipo humano de Ramo LATAM (Partner SAP Business One).

Genera un resumen breve en español neutro, en Markdown, usando EXACTAMENTE este formato (sin agregar secciones extra, sin encabezados adicionales):

**📋 Resumen de conversación**
• Cliente: <nombre> — <cargo> en <empresa>
• RUC: <ruc o "no brindado">
• Correo: <email o "no brindado">
• Interés/Necesidad: <1-2 líneas>
• ${estadoInstruccion}
• Próximos pasos: <1 línea concreta para el asesor humano>
• Última intervención bot: ${nowLimaTimestamp()}

Si algún dato no está, pon "no brindado". No inventes datos.

## Ficha del contacto
${contactBlock}

## Datos adicionales del evento
${extraBlock || "(ninguno)"}

## Últimos mensajes (más reciente al final)
${historyBlock || "(sin historial)"}`;
}

export const conversationSummary = {
  async generateAndPost(
    conversationId: number | string,
    input: SummaryInput,
  ): Promise<void> {
    try {
      const [contact, history] = await Promise.all([
        database.getContact(input.contactKey),
        database.getHistory(input.contactKey),
      ]);

      const prompt = buildPrompt(contact, history, input);

      const { text } = await generateText({
        model: openrouter(AGENT_MODEL),
        prompt,
        temperature: 0.3,
        maxTokens: 400,
      });

      const content = text.trim();
      if (!content) {
        console.warn("conversationSummary: resumen vacío, se omite nota privada");
        return;
      }

      await chatwoot.sendPrivateNote(conversationId, content);
    } catch (err) {
      console.warn("conversationSummary.generateAndPost falló:", err);
    }
  },
};
