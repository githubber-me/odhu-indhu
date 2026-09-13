import "server-only";
import postgres from "postgres";
let client: ReturnType<typeof postgres> | undefined;
export function db() {
  if (!process.env.DATABASE_URL) throw new Error("Database not configured");
  return (client ??= postgres(process.env.DATABASE_URL, {
    max: 3,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
  }));
}
export function configured() {
  const cookieSecret =
    process.env.NEON_AUTH_COOKIE_SECRET || process.env.CRON_SECRET || "";
  return Boolean(
    process.env.DATABASE_URL &&
    process.env.NEON_AUTH_BASE_URL &&
    cookieSecret.length >= 32,
  );
}
