import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),

  // Chatwoot
  CHATWOOT_BASE_URL: z.string().url().default("https://app.chatwoot.com"),
  CHATWOOT_ACCOUNT_ID: z.string().min(1, "CHATWOOT_ACCOUNT_ID is required"),
  CHATWOOT_API_TOKEN: z.string().min(1, "CHATWOOT_API_TOKEN is required"),
  CHATWOOT_INBOX_IDS: z.string().optional().default(""),
  CHATWOOT_ALLOWED_SENDER_IDS: z.string().optional().default(""),

  // Postgres
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Microsoft / Outlook — TODAS opcionales. Mientras estén vacías, el servicio
  // de Outlook corre en modo "stub" (simula el agendamiento y devuelve confirmación).
  MS_TENANT_ID: z.string().optional().default(""),
  MS_CLIENT_ID: z.string().optional().default(""),
  MS_CLIENT_SECRET: z.string().optional().default(""),
  MS_CALENDAR_MAILBOX: z.string().optional().default(""),

  // Negocio (Ramo LATAM - Perú)
  RAMO_TIMEZONE: z.string().default("America/Lima"),
  RAMO_BUSINESS_HOURS: z.string().default("09:00-18:00"),
  RAMO_LUNCH_BLOCK: z.string().default("12:00-14:00"),
  RAMO_BUSINESS_DAYS: z.string().default("1,2,3,4,5"), // 1=Lun ... 7=Dom (ISO)
  RAMO_BOOKING_DURATION_MIN: z.coerce.number().default(60),
  RAMO_DEFAULT_MEETING_PLATFORM: z
    .enum(["teams", "zoom", "meet"])
    .default("teams"),
  RAMO_OFFICE_ADDRESS: z
    .string()
    .default("Av. Aviación 2405, San Borja 15063, Lima"),

  // Seguridad y server
  WEBHOOK_SECRET: z.string().optional().default(""),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;

function splitCsv(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseHourRange(range: string): { startHour: number; endHour: number } {
  const [a, b] = range.split("-").map((s) => s.trim());
  const [ah] = a.split(":").map(Number);
  const [bh] = b.split(":").map(Number);
  return { startHour: ah, endHour: bh };
}

const bizHours = parseHourRange(env.RAMO_BUSINESS_HOURS);
const lunch = parseHourRange(env.RAMO_LUNCH_BLOCK);

const businessDaysIso = splitCsv(env.RAMO_BUSINESS_DAYS)
  .map((n) => Number(n))
  .filter((n) => n >= 1 && n <= 7);

const microsoft = {
  tenantId: env.MS_TENANT_ID,
  clientId: env.MS_CLIENT_ID,
  clientSecret: env.MS_CLIENT_SECRET,
  mailbox: env.MS_CALENDAR_MAILBOX,
  enabled:
    !!env.MS_TENANT_ID &&
    !!env.MS_CLIENT_ID &&
    !!env.MS_CLIENT_SECRET &&
    !!env.MS_CALENDAR_MAILBOX,
};

export const config = {
  openrouterApiKey: env.OPENROUTER_API_KEY,
  chatwootBaseUrl: env.CHATWOOT_BASE_URL.replace(/\/+$/, ""),
  chatwootAccountId: env.CHATWOOT_ACCOUNT_ID,
  chatwootApiToken: env.CHATWOOT_API_TOKEN,
  allowedInboxIds: splitCsv(env.CHATWOOT_INBOX_IDS),
  allowedSenderIds: splitCsv(env.CHATWOOT_ALLOWED_SENDER_IDS),
  databaseUrl: env.DATABASE_URL,
  microsoft,
  ramo: {
    timezone: env.RAMO_TIMEZONE,
    businessHours: bizHours,
    lunchBlock: lunch,
    businessDaysIso,
    bookingDurationMin: env.RAMO_BOOKING_DURATION_MIN,
    defaultPlatform: env.RAMO_DEFAULT_MEETING_PLATFORM,
    officeAddress: env.RAMO_OFFICE_ADDRESS,
  },
  webhookSecret: env.WEBHOOK_SECRET,
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
} as const;

export type Config = typeof config;
