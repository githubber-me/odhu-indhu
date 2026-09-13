import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db, configured } from "./db";
export const cookieName = "odhu_session";
export const hash = (value: string) =>
  createHmac("sha256", process.env.AUTH_SECRET || "")
    .update(value)
    .digest("hex");
export async function authenticated() {
  if (!configured()) return false;
  const token = (await cookies()).get(cookieName)?.value;
  if (!token || token.length !== 64) return false;
  const rows =
    await db()`SELECT 1 FROM auth_sessions WHERE token_hash=${hash(token)} AND expires_at>now()`;
  return rows.length > 0;
}
export async function createSession() {
  const token = randomBytes(32).toString("hex");
  await db()`INSERT INTO auth_sessions(token_hash,expires_at) VALUES(${hash(token)},now()+interval '7 days')`;
  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 604800,
  });
}
export async function rateLimit(key: string, limit: number, seconds: number) {
  const rows =
    await db()`INSERT INTO rate_limits(key,count,expires_at) VALUES(${hash(key)},1,now()+${seconds}*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END, expires_at=CASE WHEN rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END RETURNING count`;
  return rows[0].count <= limit;
}
export function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}
export function cronAuthorized(request: Request) {
  const actual = request.headers.get("authorization") || "",
    expected = "Bearer " + process.env.CRON_SECRET;
  return Boolean(
    process.env.CRON_SECRET &&
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected)),
  );
}
