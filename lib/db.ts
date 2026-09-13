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
  return Boolean(
    process.env.DATABASE_URL &&
    /^\$2[aby]\$\d{2}\$.{53}$/.test(process.env.APP_PASSWORD_HASH || "") &&
    process.env.AUTH_SECRET &&
    process.env.AUTH_SECRET.length >= 32,
  );
}
