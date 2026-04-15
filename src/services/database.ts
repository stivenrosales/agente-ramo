import postgres from "postgres";
import { config } from "../config.js";
import type { ChatMessage, Contact } from "../types.js";

const MAX_HISTORY = 20;

type SslOption = false | "require" | { rejectUnauthorized: false };

function resolveSsl(): SslOption {
  const mode = (process.env.DATABASE_SSL ?? "disable").toLowerCase();
  if (mode === "disable") return false;
  if (mode === "no-verify") return { rejectUnauthorized: false };
  return "require";
}

const sql = postgres(config.databaseUrl, { ssl: resolveSsl() });

export interface BookingRecord {
  contactKey: string;
  eventId: string | null;
  simulated: boolean;
  scheduledAt: string; // ISO
  durationMin: number;
  modalidad: string;
  emailCliente: string | null;
  topic: string | null;
}

export const database = {
  async getHistory(contactKey: string): Promise<ChatMessage[]> {
    const rows = await sql`
      SELECT role, content FROM messages
      WHERE contact_key = ${contactKey}
      ORDER BY created_at DESC
      LIMIT ${MAX_HISTORY}
    `;
    return rows.reverse().map((r) => ({
      role: r.role as ChatMessage["role"],
      content: r.content,
    }));
  },

  async saveMessage(
    contactKey: string,
    subscriberId: string,
    role: ChatMessage["role"],
    content: string,
  ): Promise<void> {
    await sql`
      INSERT INTO messages (subscriber_id, contact_key, role, content)
      VALUES (${subscriberId}, ${contactKey}, ${role}, ${content})
    `;
  },

  async getContact(contactKey: string): Promise<Contact | null> {
    const rows = await sql`
      SELECT * FROM contacts WHERE contact_key = ${contactKey} LIMIT 1
    `;
    return (rows[0] as Contact) ?? null;
  },

  async upsertContact(
    contactKey: string,
    data: Partial<
      Pick<
        Contact,
        | "name"
        | "phone"
        | "email"
        | "ruc"
        | "empresa"
        | "cargo"
        | "necesidad"
        | "modalidad"
        | "notes"
      >
    >,
  ): Promise<void> {
    const existing = await database.getContact(contactKey);
    if (existing) {
      await sql`
        UPDATE contacts SET
          name      = COALESCE(${data.name ?? null}, name),
          phone     = COALESCE(${data.phone ?? null}, phone),
          email     = COALESCE(${data.email ?? null}, email),
          ruc       = COALESCE(${data.ruc ?? null}, ruc),
          empresa   = COALESCE(${data.empresa ?? null}, empresa),
          cargo     = COALESCE(${data.cargo ?? null}, cargo),
          necesidad = COALESCE(${data.necesidad ?? null}, necesidad),
          modalidad = COALESCE(${data.modalidad ?? null}, modalidad),
          notes     = COALESCE(${data.notes ?? null}, notes),
          last_seen = NOW()
        WHERE contact_key = ${contactKey}
      `;
    } else {
      await sql`
        INSERT INTO contacts (
          contact_key, name, phone, email, ruc, empresa, cargo,
          necesidad, modalidad, notes
        ) VALUES (
          ${contactKey},
          ${data.name ?? null},
          ${data.phone ?? null},
          ${data.email ?? null},
          ${data.ruc ?? null},
          ${data.empresa ?? null},
          ${data.cargo ?? null},
          ${data.necesidad ?? null},
          ${data.modalidad ?? null},
          ${data.notes ?? null}
        )
      `;
    }
  },

  async saveBooking(b: BookingRecord): Promise<void> {
    await sql`
      INSERT INTO bookings (
        contact_key, event_id, simulated, scheduled_at,
        duration_min, modalidad, email_cliente, topic
      ) VALUES (
        ${b.contactKey},
        ${b.eventId},
        ${b.simulated},
        ${b.scheduledAt},
        ${b.durationMin},
        ${b.modalidad},
        ${b.emailCliente},
        ${b.topic}
      )
    `;
  },
};
