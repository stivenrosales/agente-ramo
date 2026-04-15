import "dotenv/config";
import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("❌ DATABASE_URL is not set in .env");
  process.exit(1);
}

const sslMode = (process.env.DATABASE_SSL ?? "require").toLowerCase();
type SslOption = false | "require" | { rejectUnauthorized: false };
const ssl: SslOption =
  sslMode === "disable"
    ? false
    : sslMode === "no-verify"
      ? { rejectUnauthorized: false }
      : "require";

const sql = postgres(url, { ssl });

const migrationsDir = resolve(process.cwd(), "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error("❌ No .sql migration files found in", migrationsDir);
  process.exit(1);
}

console.log(`📋 Running ${files.length} migration file(s):\n`);

try {
  for (const file of files) {
    const fullPath = resolve(migrationsDir, file);
    const content = readFileSync(fullPath, "utf-8");
    console.log(`  ▶️  ${file}`);
    await sql.unsafe(content);
    console.log(`  ✅  ${file} — done`);
  }
  console.log("\n🎉 All migrations completed successfully");
} catch (err) {
  console.error("\n❌ Migration failed:", err);
  process.exit(1);
} finally {
  await sql.end();
}
