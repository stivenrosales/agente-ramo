import { tool } from "ai";
import { z } from "zod";
import { config } from "../config.js";
import { database } from "./database.js";
import { outlookCalendar } from "./outlook-calendar.js";
import { conversationSummary } from "./conversation-summary.js";

const EMAIL_TYPOS: Record<string, string> = {
  "gamil.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.con": "gmail.com",
  "hotmal.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com",
  "outlook.con": "outlook.com",
  "yahoo.con": "yahoo.com",
};

function validateEmail(email: string): { valid: boolean; error?: string } {
  const lower = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) {
    return { valid: false, error: "El formato del correo no es válido." };
  }
  const domain = lower.split("@")[1];
  if (EMAIL_TYPOS[domain]) {
    return {
      valid: false,
      error: `El dominio parece tener un error. ¿Quisiste decir ${lower.split("@")[0]}@${EMAIL_TYPOS[domain]}?`,
    };
  }
  return { valid: true };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Disponibilidad — generación local (sin consultar Graph aún)              */
/* ────────────────────────────────────────────────────────────────────────── */

interface TimeSlot {
  iso_start: string; // ISO con offset Lima (-05:00)
  iso_end: string;
  label: string; // ej. "martes 16 de abril, 10:00 a.m."
}

const DIAS_ES = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];
const MESES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function formatLima(date: Date, hour: number): { iso: string; hhmm: string } {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  return { iso: `${y}-${m}-${d}T${hh}:00:00-05:00`, hhmm: `${hh}:00` };
}

function addMinutesIso(iso: string, minutes: number): string {
  const base = new Date(iso);
  base.setMinutes(base.getMinutes() + minutes);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, "0");
  const d = String(base.getDate()).padStart(2, "0");
  const hh = String(base.getHours()).padStart(2, "0");
  const mm = String(base.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}:00-05:00`;
}

function humanLabel(date: Date, hhmm: string): string {
  const diaSem = DIAS_ES[date.getDay()];
  const numDia = date.getDate();
  const mes = MESES_ES[date.getMonth()];
  const [h] = hhmm.split(":").map(Number);
  const ampm = h < 12 ? "a. m." : "p. m.";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${diaSem} ${numDia} de ${mes}, ${h12}:00 ${ampm}`;
}

function generateSlots(daysAhead: number, limit: number): TimeSlot[] {
  const { startHour, endHour } = config.ramo.businessHours;
  const { startHour: lunchStart, endHour: lunchEnd } = config.ramo.lunchBlock;
  const duration = config.ramo.bookingDurationMin;
  const businessDaysIso = new Set(config.ramo.businessDaysIso);

  const slots: TimeSlot[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let offset = 1; offset <= Math.max(daysAhead, 7); offset++) {
    if (slots.length >= limit) break;
    const d = new Date(today);
    d.setDate(d.getDate() + offset);

    const isoDay = d.getDay() === 0 ? 7 : d.getDay(); // ISO: Lun=1 .. Dom=7
    if (!businessDaysIso.has(isoDay)) continue;

    const pickHours = [startHour, 15].filter(
      (h) => h >= startHour && h + 1 <= endHour && (h < lunchStart || h >= lunchEnd),
    );

    for (const h of pickHours) {
      if (slots.length >= limit) break;
      const start = formatLima(d, h);
      slots.push({
        iso_start: start.iso,
        iso_end: addMinutesIso(start.iso, duration),
        label: humanLabel(d, start.hhmm),
      });
    }
  }
  return slots;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Tools                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export function createTools(
  contactKey: string,
  conversationId: number | string,
) {
  const guardarLead = tool({
    description:
      "Guardar o actualizar los datos del lead (nombre, empresa, RUC, cargo, necesidad, etc.) a medida que el cliente los brinda. Llámalo apenas tengas un dato nuevo — no esperes a tener todo.",
    parameters: z.object({
      nombre: z.string().optional(),
      empresa: z.string().optional(),
      cargo: z.string().optional(),
      ruc: z.string().optional(),
      correo: z.string().optional(),
      telefono: z.string().optional(),
      necesidad: z
        .string()
        .optional()
        .describe("Breve descripción del interés o necesidad del cliente"),
      modalidad: z
        .enum(["virtual", "oficina_ramo", "oficina_cliente"])
        .optional()
        .describe(
          "Modalidad preferida: 'virtual' (Teams), 'oficina_ramo' (San Borja), 'oficina_cliente' (Lima Metro)",
        ),
    }),
    execute: async (params) => {
      if (params.correo) {
        const check = validateEmail(params.correo);
        if (!check.valid) {
          return { success: false, error: check.error };
        }
      }
      try {
        await database.upsertContact(contactKey, {
          name: params.nombre ?? null,
          empresa: params.empresa ?? null,
          cargo: params.cargo ?? null,
          ruc: params.ruc ?? null,
          email: params.correo?.toLowerCase().trim() ?? null,
          phone: params.telefono ?? null,
          necesidad: params.necesidad ?? null,
          modalidad: params.modalidad ?? null,
        });
        return { success: true };
      } catch (err) {
        console.error("guardarLead error:", err);
        return {
          success: false,
          error: "No se pudo guardar la información en este momento.",
        };
      }
    },
  });

  const sugerirHorarios = tool({
    description:
      "Devuelve 3-4 opciones de horario disponibles para la consultoría gratuita de SAP Business One, a partir de mañana, en horario hábil de Lima (L-V, 09:00-18:00, evitando almuerzo 12-14). Úsalo antes de pedirle al cliente que elija día/hora.",
    parameters: z.object({
      dias_adelante: z
        .number()
        .int()
        .min(1)
        .max(14)
        .default(7)
        .describe("Cuántos días hacia adelante explorar (máx 14)"),
      cantidad: z
        .number()
        .int()
        .min(1)
        .max(6)
        .default(4)
        .describe("Cuántos slots sugerir"),
    }),
    execute: async ({ dias_adelante, cantidad }) => {
      const slots = generateSlots(dias_adelante, cantidad);
      return { success: true, slots, timezone: config.ramo.timezone };
    },
  });

  const confirmarReserva = tool({
    description:
      "Crear el evento de consultoría en Outlook cuando el cliente CONFIRME expresamente el resumen. Llamar solo una vez, con todos los datos validados. Si Outlook aún no está configurado, el sistema simula la reserva y retorna `simulated: true`; aun así, responde al cliente como si estuviera agendada.",
    parameters: z.object({
      nombre: z.string().describe("Nombre completo del cliente"),
      correo: z.string().describe("Correo del cliente (para la invitación)"),
      empresa: z.string().optional(),
      ruc: z.string().optional(),
      cargo: z.string().optional(),
      necesidad: z.string().describe("Resumen breve de la necesidad"),
      iso_start: z
        .string()
        .describe("Inicio ISO 8601 con offset -05:00 (ej: 2026-04-20T10:00:00-05:00)"),
      iso_end: z
        .string()
        .describe("Fin ISO 8601 con offset -05:00"),
      modalidad: z.enum(["virtual", "oficina_ramo", "oficina_cliente"]),
      direccion_cliente: z
        .string()
        .optional()
        .describe(
          "Dirección exacta del cliente. Obligatorio si modalidad = 'oficina_cliente'. Ignorado en las otras.",
        ),
    }),
    execute: async (p) => {
      const check = validateEmail(p.correo);
      if (!check.valid) {
        return { success: false, error: check.error };
      }

      // Resolver ubicación según modalidad.
      let location: string | null;
      let modalidadHumana: string;
      switch (p.modalidad) {
        case "virtual":
          location = null;
          modalidadHumana = "Virtual por Microsoft Teams";
          break;
        case "oficina_ramo":
          location = `Oficina Ramo LATAM · ${config.ramo.officeAddress}`;
          modalidadHumana = `Oficina Ramo LATAM (${config.ramo.officeAddress})`;
          break;
        case "oficina_cliente":
          if (!p.direccion_cliente) {
            return {
              success: false,
              error:
                "Falta la dirección del cliente (modalidad=oficina_cliente).",
            };
          }
          location = `Oficina del cliente · ${p.direccion_cliente}`;
          modalidadHumana = `Oficina del cliente (${p.direccion_cliente})`;
          break;
      }

      const subject = `Consultoría SAP Business One — ${p.empresa ?? p.nombre}`;
      const body = [
        `<p>Consultoría gratuita con <strong>Ramo LATAM · Partner SAP Business One</strong> (60 min).</p>`,
        `<p><strong>Cliente:</strong> ${p.nombre}${p.cargo ? ` — ${p.cargo}` : ""}</p>`,
        p.empresa ? `<p><strong>Empresa:</strong> ${p.empresa}${p.ruc ? ` (RUC ${p.ruc})` : ""}</p>` : "",
        `<p><strong>Necesidad:</strong> ${p.necesidad}</p>`,
        `<p><strong>Modalidad:</strong> ${modalidadHumana}</p>`,
      ]
        .filter(Boolean)
        .join("");

      const result = await outlookCalendar.createEvent({
        subject,
        body,
        startIso: p.iso_start,
        endIso: p.iso_end,
        attendeeEmail: p.correo.toLowerCase().trim(),
        attendeeName: p.nombre,
        modalidad: p.modalidad,
        location,
      });

      if (!result.success) {
        return { success: false, error: result.error ?? "Error al agendar" };
      }

      try {
        await database.upsertContact(contactKey, {
          name: p.nombre,
          empresa: p.empresa ?? null,
          ruc: p.ruc ?? null,
          cargo: p.cargo ?? null,
          email: p.correo.toLowerCase().trim(),
          necesidad: p.necesidad,
          modalidad: p.modalidad,
        });
        await database.saveBooking({
          contactKey,
          eventId: result.eventId,
          simulated: result.simulated,
          scheduledAt: p.iso_start,
          durationMin: config.ramo.bookingDurationMin,
          modalidad: p.modalidad,
          emailCliente: p.correo.toLowerCase().trim(),
          topic: p.necesidad,
        });
      } catch (err) {
        console.error("No se pudo persistir booking:", err);
      }

      database.setConversationState(contactKey, "booked").catch(() => {});

      conversationSummary
        .generateAndPost(conversationId, {
          contactKey,
          reason: "booked",
          extra: {
            fecha_iso: p.iso_start,
            modalidad: p.modalidad,
            empresa: p.empresa ?? null,
            topic: p.necesidad,
          },
        })
        .catch(() => {});

      return {
        success: true,
        simulated: result.simulated,
        event_id: result.eventId,
        join_url: result.joinUrl,
      };
    },
  });

  const solicitarAsesorHumano = tool({
    description:
      "Úsalo SOLO cuando el cliente pida hablar con un humano O cuando el bot literalmente no puede responder con la info del prompt (después de haber intentado ayudar). NO lo uses si el cliente solo pregunta precio o algo técnico — ahí tu trabajo es derivar a agendar consultoría. Solo marca escalación genuina.",
    parameters: z.object({
      razon: z
        .string()
        .describe("Breve motivo por el que derivas a humano"),
    }),
    execute: async ({ razon }) => {
      database.setConversationState(contactKey, "escalated").catch(() => {});
      conversationSummary
        .generateAndPost(conversationId, {
          contactKey,
          reason: "escalated",
          extra: { razon },
        })
        .catch(() => {});
      return { success: true, escalated: true };
    },
  });

  return {
    guardar_lead: guardarLead,
    sugerir_horarios: sugerirHorarios,
    confirmar_reserva: confirmarReserva,
    solicitar_asesor_humano: solicitarAsesorHumano,
  };
}
