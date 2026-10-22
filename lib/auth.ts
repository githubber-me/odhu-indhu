import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { db, configured } from "./db";
import { auth } from "./neon-auth";
import { appUserId } from "./auth-identity";

export { auth };

export async function authenticated() {
  if (!configured()) return null;
  const { data: session, error } = await auth.getSession();
  if (error) {
    if (error.status === 401) return null;
    throw new Error("Unable to verify your session. Please try again.");
  }
  if (!session?.user?.id) return null;
  return appUserId(db(), session.user);
}

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function rateLimit(key: string, limit: number, seconds: number) {
  const rows =
    await db()`INSERT INTO rate_limits(key,count,expires_at) VALUES(${hash(key)},1,now()+${seconds}*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END, expires_at=CASE WHEN rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END RETURNING count`;
  return rows[0].count <= limit;
}

export function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}

export function cronAuthorized(request: Request) {
  const actual = request.headers.get("authorization") || "";
  const expected = "Bearer " + process.env.CRON_SECRET;
  return Boolean(
    process.env.CRON_SECRET &&
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected)),
  );
}
