import { tool } from "ai";
import { z } from "zod";
import { config, SUCURSAL_LIST, type Sucursal } from "../config.js";
import { createCalendarEvent } from "./google-calendar.js";
import { database } from "./database.js";

const EMAIL_TYPOS: Record<string, string> = {
  "gamil.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.con": "gmail.com",
  "gmal.com": "gmail.com",
  "gnail.com": "gmail.com",
  "hotmal.com": "hotmail.com",
  "hotmial.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "hotamil.com": "hotmail.com",
  "outlok.com": "outlook.com",
  "outloo.com": "outlook.com",
  "outlook.con": "outlook.com",
  "outlool.com": "outlook.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "tahoo.com": "yahoo.com",
};

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { nombre: parts[0], paterno: "", materno: "" };
  if (parts.length === 2)
    return { nombre: parts[0], paterno: parts[1], materno: "" };
  const materno = parts.pop()!;
  const paterno = parts.pop()!;
  return { nombre: parts.join(" "), paterno, materno };
}

function validateEmail(email: string): { valid: boolean; error?: string } {
  const lower = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) {
    return { valid: false, error: "Formato de correo inválido" };
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

const sucursalEnum = z.enum(SUCURSAL_LIST as unknown as [Sucursal, ...Sucursal[]]);

export function createTools(contactKey: string) {
  const agendarVisita = tool({
  description:
    "Guardar información del lead cuando el cliente CONFIRME la cita después del resumen. Envía los datos a la base de datos y a e-admin.mx.",
  parameters: z.object({
    nombre_completo: z.string().describe("Nombre completo del cliente"),
    correo: z.string().describe("Correo electrónico del cliente"),
    sucursal: sucursalEnum.describe("Sucursal elegida"),
    fecha_visita: z
      .string()
      .describe("Fecha de visita en formato YYYY-MM-DD"),
    hora_visita: z.string().describe("Hora de visita en formato HH:MM (24h)"),
    telefono: z.string().describe("Número de teléfono del cliente"),
    inversion: z
      .string()
      .describe(
        "Plan de inversión elegido: Semanal, Mensualidad, Pago oportuno, Bimestre, Trimestre, Semestre, Anualidad o Por definir",
      ),
    motivacion: z
      .string()
      .describe("Principal motivación del cliente para ir al gym"),
    requisito: z
      .string()
      .describe(
        "Qué debe cumplir Fitness Space para que el cliente lo elija",
      ),
  }),
  execute: async (params) => {
    const emailCheck = validateEmail(params.correo);
    if (!emailCheck.valid) {
      return { success: false, error: emailCheck.error };
    }

    const { nombre, paterno, materno } = splitName(params.nombre_completo);

    const apiKey = config.erpKeys[params.sucursal];
    if (!apiKey) {
      return { success: false, error: "Sucursal no válida" };
    }

    const now = new Date();
    const fechaRegistro = now.toISOString().replace("T", " ").slice(0, 19);

    try {
      const res = await fetch("https://e-admin.mx/api/prospectos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify({
          nombre,
          paterno,
          materno,
          correo: params.correo.toLowerCase().trim(),
          telefono: params.telefono,
          fecha_visita: params.fecha_visita,
          hora_visita: params.hora_visita,
          canal: "instagram",
          estado: "agendado",
          motivacion: params.motivacion,
          inversion: params.inversion,
          fecha_registro: fechaRegistro,
        }),
      });

      const body = await res.text();
      console.log("e-admin.mx response:", res.status, body);

      // Long-term memory: save contact info to contacts table
      try {
        await database.upsertContact(contactKey, {
          name: params.nombre_completo,
          email: params.correo.toLowerCase().trim(),
          phone: params.telefono,
          preferred_sucursal: params.sucursal,
          investment_plan: params.inversion,
          motivation: params.motivacion,
          requirement: params.requisito,
        });
        console.log("Contact profile updated for", contactKey);
      } catch (err) {
        console.error("Failed to update contact profile:", err);
      }

      return {
        success: true,
        message: "Visita agendada correctamente en el sistema",
      };
    } catch (err) {
      console.error("e-admin.mx error:", err);
      return {
        success: false,
        error:
          "Error al guardar en el sistema, pero la visita queda registrada",
      };
    }
  },
  });

  const crearEventoCalendar = tool({
  description:
    "Crear un evento de visita en Google Calendar para la sucursal correspondiente. Usar ÚNICAMENTE cuando el cliente CONFIRME la cita.",
  parameters: z.object({
    sucursal: sucursalEnum.describe("Sucursal elegida por el cliente"),
    event_start: z
      .string()
      .describe(
        "Fecha y hora de inicio en ISO 8601 con zona horaria -06:00 (ej: 2026-03-20T09:00:00-06:00)",
      ),
    event_end: z
      .string()
      .describe(
        "Fecha y hora de fin en ISO 8601, una hora después del inicio (ej: 2026-03-20T10:00:00-06:00)",
      ),
    event_description: z
      .string()
      .describe(
        "Descripción del evento con datos del cliente: nombre, correo, teléfono, sucursal, plan, motivación, requisito",
      ),
    event_title: z
      .string()
      .describe(
        "Título del evento. Formato: Visita {sucursal} - {nombre del cliente}",
      ),
  }),
  execute: async (params) => {
    const calendarId = config.calendarIds[params.sucursal];
    if (!calendarId) {
      return { success: false, error: "Sucursal no válida para calendar" };
    }

    return createCalendarEvent(config.googleCredentials, calendarId, {
      summary: params.event_title,
      description: params.event_description,
      start: params.event_start,
      end: params.event_end,
    });
  },
  });

  return {
    agendar_visita: agendarVisita,
    crear_evento_calendar: crearEventoCalendar,
  };
}
