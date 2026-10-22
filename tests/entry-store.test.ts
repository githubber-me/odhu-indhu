import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type postgres from "postgres";
import { saveDayEntry, saveStudyEntry } from "../lib/entry-store";
import { dayEntrySchema } from "../lib/day-ledger";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const id = "550e8400-e29b-41d4-a716-446655440000";
const secondId = "550e8400-e29b-41d4-a716-446655440001";
const today = "2026-10-22";

// Execute the production tagged SQL against real Postgres constraints in PGlite.
function adapter(database: PGlite): postgres.Sql {
  function tagFor(target: Pick<PGlite, "query">) {
    return async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const query = parts.reduce(
        (sql, part, i) => sql + (i ? `$${i}` : "") + part,
        "",
      );
      return (await target.query(query, values)).rows;
    };
  }
  return Object.assign(tagFor(database), {
    begin: (work: (tx: unknown) => Promise<unknown>) =>
      database.transaction((tx) => work(tagFor(tx))),
  }) as unknown as postgres.Sql;
}

async function setup() {
  const database = new PGlite();
  await database.exec(
    await readFile(new URL("../db/001_initial.sql", import.meta.url), "utf8"),
  );
  await database.query(
    "INSERT INTO app_users(id,handle,display_name) VALUES($1,'second','Second')",
    [other],
  );
  return { database, sql: adapter(database) };
}

test("study save retries retain the original date and reject changed payloads and other owners", async () => {
  const { database, sql } = await setup();
  try {
    const entry = { id, content: "Studied fractions", duration: 60 };
    assert.deepEqual(await saveStudyEntry(sql, owner, entry, today), {
      ok: true,
      duplicate: false,
      duration: 60,
    });
    assert.deepEqual(await saveStudyEntry(sql, owner, entry, "2026-10-23"), {
      ok: true,
      duplicate: true,
      duration: 60,
    });
    assert.ok(
      "error" in
        (await saveStudyEntry(sql, owner, { ...entry, duration: 90 }, today)),
    );
    assert.ok("error" in (await saveStudyEntry(sql, other, entry, today)));
    assert.deepEqual(
      (await database.query("SELECT user_id,date,duration FROM study_sessions"))
        .rows,
      [{ user_id: owner, date: today, duration: 60 }],
    );
  } finally {
    await database.close();
  }
});

test("ledger saves deduplicate before overlap checks and only study rows count toward progress", async () => {
  const { database, sql } = await setup();
  try {
    const entry = dayEntrySchema.parse({
      id,
      date: today,
      startTime: "09:00",
      endTime: "10:00",
      activity: "Study",
      subject: "Math",
      topic: "Fractions",
      note: "Practice",
    });
    assert.deepEqual(await saveDayEntry(sql, owner, entry), {
      ok: true,
      duplicate: false,
      duration: 60,
    });
    assert.deepEqual(await saveDayEntry(sql, owner, entry), {
      ok: true,
      duplicate: true,
      duration: 60,
    });
    assert.ok("error" in (await saveDayEntry(sql, other, entry)));
    const overlapping = { ...entry, id: secondId, activity: "Work" as const };
    assert.equal(
      ((await saveDayEntry(sql, owner, overlapping)) as { overlap: boolean })
        .overlap,
      true,
    );
    assert.deepEqual(
      await saveDayEntry(sql, owner, { ...overlapping, allowOverlap: true }),
      { ok: true, duplicate: false, duration: 60 },
    );
    assert.equal(
      (
        await database.query<{ total: number }>(
          "SELECT count(*)::int AS total FROM day_entries",
        )
      ).rows[0].total,
      2,
    );
    assert.equal(
      (
        await database.query<{ total: number }>(
          "SELECT sum(duration)::int AS total FROM study_sessions",
        )
      ).rows[0].total,
      60,
    );
  } finally {
    await database.close();
  }
});

test("a ledger insertion failure rolls back its study session", async () => {
  const { database, sql } = await setup();
  try {
    await database.exec(`CREATE FUNCTION reject_test_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'save failed'; END; $$;
      CREATE TRIGGER reject_test_row BEFORE INSERT ON day_entries FOR EACH ROW EXECUTE FUNCTION reject_test_row();`);
    const entry = dayEntrySchema.parse({
      id,
      date: today,
      startTime: "09:00",
      endTime: "10:00",
      activity: "Study",
      subject: "Math",
      topic: "Fractions",
      note: "",
    });
    await assert.rejects(saveDayEntry(sql, owner, entry), /save failed/);
    assert.equal(
      (await database.query("SELECT * FROM study_sessions")).rows.length,
      0,
    );
    assert.equal(
      (await database.query("SELECT * FROM day_entries")).rows.length,
      0,
    );
  } finally {
    await database.close();
  }
});
