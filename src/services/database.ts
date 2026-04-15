import postgres from "postgres";
import { config } from "../config.js";
import type { ChatMessage, Contact } from "../types.js";

const MAX_HISTORY = 20;

type SslOption = false | "require" | { rejectUnauthorized: false };

function resolveSsl(): SslOption {
  const mode = (process.env.DATABASE_SSL ?? "require").toLowerCase();
  if (mode === "disable") return false;
  if (mode === "no-verify") return { rejectUnauthorized: false };
  return "require";
}

const sql = postgres(config.databaseUrl, { ssl: resolveSsl() });

export const database = {
  // ─── Messages (short-term memory) ──────────────────────────────

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

  // ─── Contacts (long-term memory) ───────────────────────────────

  async getContact(contactKey: string): Promise<Contact | null> {
    const rows = await sql`
      SELECT * FROM contacts WHERE contact_key = ${contactKey} LIMIT 1
    `;
    return (rows[0] as Contact) ?? null;
  },

  async upsertContact(
    contactKey: string,
    data: {
      name?: string | null;
      phone?: string | null;
      email?: string | null;
      ig_username?: string | null;
      preferred_sucursal?: string | null;
      investment_plan?: string | null;
      motivation?: string | null;
      requirement?: string | null;
      notes?: string | null;
    },
  ): Promise<void> {
    const existing = await database.getContact(contactKey);

    if (existing) {
      await sql`
        UPDATE contacts SET
          name = COALESCE(${data.name ?? null}, name),
          phone = COALESCE(${data.phone ?? null}, phone),
          email = COALESCE(${data.email ?? null}, email),
          ig_username = COALESCE(${data.ig_username ?? null}, ig_username),
          preferred_sucursal = COALESCE(${data.preferred_sucursal ?? null}, preferred_sucursal),
          investment_plan = COALESCE(${data.investment_plan ?? null}, investment_plan),
          motivation = COALESCE(${data.motivation ?? null}, motivation),
          requirement = COALESCE(${data.requirement ?? null}, requirement),
          notes = COALESCE(${data.notes ?? null}, notes),
          last_seen = NOW()
        WHERE contact_key = ${contactKey}
      `;
    } else {
      await sql`
        INSERT INTO contacts (
          contact_key, name, phone, email, ig_username,
          preferred_sucursal, investment_plan, motivation, requirement, notes
        )
        VALUES (
          ${contactKey},
          ${data.name ?? null},
          ${data.phone ?? null},
          ${data.email ?? null},
          ${data.ig_username ?? null},
          ${data.preferred_sucursal ?? null},
          ${data.investment_plan ?? null},
          ${data.motivation ?? null},
          ${data.requirement ?? null},
          ${data.notes ?? null}
        )
      `;
    }
  },
};
