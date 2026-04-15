import "dotenv/config";
import { z } from "zod";

const SUCURSALES = [
  "Taxqueña",
  "Las Torres",
  "Ermita",
  "Plutarco",
  "Jiutepec",
] as const;

export type Sucursal = (typeof SUCURSALES)[number];

export const SUCURSAL_LIST: readonly Sucursal[] = SUCURSALES;

const SUCURSAL_TO_ENV_KEY: Record<Sucursal, string> = {
  Taxqueña: "TAXQUENA",
  "Las Torres": "LAS_TORRES",
  Ermita: "ERMITA",
  Plutarco: "PLUTARCO",
  Jiutepec: "JIUTEPEC",
};

const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  CHATWOOT_BASE_URL: z
    .string()
    .url("CHATWOOT_BASE_URL must be a valid URL (e.g. https://app.chatwoot.com)")
    .default("https://app.chatwoot.com"),
  CHATWOOT_ACCOUNT_ID: z.string().min(1, "CHATWOOT_ACCOUNT_ID is required"),
  CHATWOOT_API_TOKEN: z.string().min(1, "CHATWOOT_API_TOKEN is required"),
  CHATWOOT_INBOX_IDS: z.string().optional().default(""),
  CHATWOOT_ALLOWED_SENDER_IDS: z.string().optional().default(""),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  GOOGLE_SERVICE_ACCOUNT_B64: z
    .string()
    .min(1, "GOOGLE_SERVICE_ACCOUNT_B64 is required"),
  WEBHOOK_SECRET: z.string().optional().default(""),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  FS_ERP_KEY_TAXQUENA: z.string().min(1),
  FS_ERP_KEY_LAS_TORRES: z.string().min(1),
  FS_ERP_KEY_ERMITA: z.string().min(1),
  FS_ERP_KEY_PLUTARCO: z.string().min(1),
  FS_ERP_KEY_JIUTEPEC: z.string().min(1),
  FS_CALENDAR_ID_TAXQUENA: z.string().min(1),
  FS_CALENDAR_ID_LAS_TORRES: z.string().min(1),
  FS_CALENDAR_ID_ERMITA: z.string().min(1),
  FS_CALENDAR_ID_PLUTARCO: z.string().min(1),
  FS_CALENDAR_ID_JIUTEPEC: z.string().min(1),
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

function decodeGoogleCredentials(b64: string): {
  client_email: string;
  private_key: string;
  token_uri: string;
} {
  try {
    const json = Buffer.from(b64, "base64").toString("utf-8");
    const parsed = JSON.parse(json);
    if (!parsed.client_email || !parsed.private_key || !parsed.token_uri) {
      throw new Error("missing required fields");
    }
    return parsed;
  } catch (err) {
    console.error(
      "❌ GOOGLE_SERVICE_ACCOUNT_B64 is not a valid base64-encoded service account JSON:",
      err,
    );
    process.exit(1);
  }
}

const googleCredentials = decodeGoogleCredentials(env.GOOGLE_SERVICE_ACCOUNT_B64);

const erpKeys: Record<Sucursal, string> = {
  Taxqueña: env.FS_ERP_KEY_TAXQUENA,
  "Las Torres": env.FS_ERP_KEY_LAS_TORRES,
  Ermita: env.FS_ERP_KEY_ERMITA,
  Plutarco: env.FS_ERP_KEY_PLUTARCO,
  Jiutepec: env.FS_ERP_KEY_JIUTEPEC,
};

const calendarIds: Record<Sucursal, string> = {
  Taxqueña: env.FS_CALENDAR_ID_TAXQUENA,
  "Las Torres": env.FS_CALENDAR_ID_LAS_TORRES,
  Ermita: env.FS_CALENDAR_ID_ERMITA,
  Plutarco: env.FS_CALENDAR_ID_PLUTARCO,
  Jiutepec: env.FS_CALENDAR_ID_JIUTEPEC,
};

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  openrouterApiKey: env.OPENROUTER_API_KEY,
  chatwootBaseUrl: env.CHATWOOT_BASE_URL.replace(/\/+$/, ""),
  chatwootAccountId: env.CHATWOOT_ACCOUNT_ID,
  chatwootApiToken: env.CHATWOOT_API_TOKEN,
  allowedInboxIds: splitCsv(env.CHATWOOT_INBOX_IDS),
  allowedSenderIds: splitCsv(env.CHATWOOT_ALLOWED_SENDER_IDS),
  databaseUrl: env.DATABASE_URL,
  googleCredentials,
  erpKeys,
  calendarIds,
  webhookSecret: env.WEBHOOK_SECRET,
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  sucursalEnvKey: SUCURSAL_TO_ENV_KEY,
} as const;

export type Config = typeof config;
