import { randomUUID } from "node:crypto";
import type postgres from "postgres";

export type NeonIdentity = {
  id: string;
  name?: string | null;
  email?: string | null;
};

const legacyOwnerId = "00000000-0000-4000-8000-000000000001";

export async function appUserId(
  sql: ReturnType<typeof postgres>,
  user: NeonIdentity,
  legacyOwnerSubject = process.env.LEGACY_OWNER_AUTH_SUBJECT,
) {
  const email = user.email?.trim().toLocaleLowerCase("en-IN") || null;
  const emailName = email
    ?.split("@")[0]
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-IN"));
  const displayName = (emailName || user.name?.trim() || "Student").slice(
    0,
    60,
  );
  return sql.begin(async (tx) => {
    const existing =
      await tx`SELECT id FROM app_users WHERE auth_provider='neon' AND auth_subject=${user.id}`;
    if (existing.length) {
      await tx`UPDATE app_users SET display_name=CASE WHEN display_name_edited THEN display_name ELSE ${displayName} END,email=${email} WHERE id=${existing[0].id}`;
      return existing[0].id as string;
    }

    // A legacy ledger can only be linked to the subject explicitly selected by
    // its administrator. Being the next person to sign in proves no ownership.
    if (legacyOwnerSubject && user.id === legacyOwnerSubject) {
      const legacy =
        await tx`SELECT id FROM app_users WHERE id=${legacyOwnerId} AND auth_subject IS NULL FOR UPDATE`;
      if (legacy.length) {
        await tx`UPDATE app_users SET display_name=${displayName},display_name_edited=false,email=${email},auth_provider='neon',auth_subject=${user.id} WHERE id=${legacyOwnerId}`;
        return legacyOwnerId;
      }
    }

    const rows = await tx`
      INSERT INTO app_users(id,handle,display_name,email,auth_provider,auth_subject)
      VALUES(${randomUUID()},${"neon:" + user.id},${displayName},${email},'neon',${user.id})
      ON CONFLICT(auth_provider,auth_subject) DO UPDATE
      SET display_name=CASE WHEN app_users.display_name_edited THEN app_users.display_name ELSE EXCLUDED.display_name END,email=EXCLUDED.email
      RETURNING id
    `;
    return rows[0].id as string;
  });
}
