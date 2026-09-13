import "server-only";
import { createNeonAuth } from "@neondatabase/auth/next/server";

const configuredCookieRoot =
  process.env.NEON_AUTH_COOKIE_SECRET || process.env.CRON_SECRET;
const neonAuthBaseUrl =
  process.env.NEON_AUTH_BASE_URL || process.env.DATABASE_NEON_AUTH_BASE_URL;
const cookieSecret =
  configuredCookieRoot && configuredCookieRoot.length >= 32
    ? "odhu-indhu/neon-auth-cookie/v1:" + configuredCookieRoot
    : "odhu-indhu-disabled-auth-cookie-secret-000000000000000000000000";

export const auth = createNeonAuth({
  baseUrl: neonAuthBaseUrl || "http://127.0.0.1/disabled-neon-auth",
  cookies: { secret: cookieSecret },
});
