import "server-only";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { db, configured } from "./db";
import { auth } from "./neon-auth";

export { auth };

type NeonUser = { id: string; name?: string | null; email?: string | null };
const legacyOwnerId = "00000000-0000-4000-8000-000000000001";

async function appUserId(user: NeonUser) {
  const sql = db();
  const displayName =
    user.name?.trim() || user.email?.split("@")[0] || "Student";
  const email = user.email?.trim().toLocaleLowerCase("en-IN") || null;
  return sql.begin(async (tx) => {
    const existing =
      await tx`SELECT id FROM app_users WHERE auth_provider='neon' AND auth_subject=${user.id}`;
    if (existing.length) {
      await tx`UPDATE app_users SET display_name=${displayName},email=${email} WHERE id=${existing[0].id}`;
      return existing[0].id as string;
    }

    // The first Neon identity claims the seeded account so any pre-auth study
    // history remains attached. Later identities receive independent accounts.
    const legacy =
      await tx`SELECT id FROM app_users WHERE id=${legacyOwnerId} AND auth_subject IS NULL FOR UPDATE`;
    if (legacy.length) {
      await tx`UPDATE app_users SET display_name=${displayName},email=${email},auth_provider='neon',auth_subject=${user.id} WHERE id=${legacyOwnerId}`;
      return legacyOwnerId;
    }

    const rows = await tx`
      INSERT INTO app_users(id,handle,display_name,email,auth_provider,auth_subject)
      VALUES(${randomUUID()},${"neon:" + user.id},${displayName},${email},'neon',${user.id})
      ON CONFLICT(auth_provider,auth_subject) DO UPDATE
      SET display_name=EXCLUDED.display_name,email=EXCLUDED.email
      RETURNING id
    `;
    return rows[0].id as string;
  });
}

export async function authenticated() {
  if (!configured()) return null;
  const { data: session } = await auth.getSession();
  if (!session?.user?.id) return null;
  return appUserId(session.user);
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
