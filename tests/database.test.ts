import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("migration is repeatable; entries deduplicate; topic dates and attempt answers persist", async () => {
  const db = new PGlite();
  try {
    const migration = await readFile(
      new URL("../db/001_initial.sql", import.meta.url),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    const id = "550e8400-e29b-41d4-a716-446655440000",
      set = "550e8400-e29b-41d4-a716-446655440001",
      attempt = "550e8400-e29b-41d4-a716-446655440002";
    for (let i = 0; i < 2; i++)
      await db.query(
        "INSERT INTO study_sessions(id,content,duration,date) VALUES($1,$2,60,$3) ON CONFLICT(id) DO NOTHING",
        [id, "Studied percentages", "2026-09-13"],
      );
    const count = await db.query<{ total: number }>(
      "SELECT SUM(duration)::int AS total FROM study_sessions",
    );
    assert.equal(count.rows[0].total, 60);
    await assert.rejects(
      db.query("UPDATE study_sessions SET duration=120 WHERE id=$1", [id]),
    );
    await db.query(
      "UPDATE study_sessions SET status='processing' WHERE id=$1",
      [id],
    );
    await assert.rejects(
      db.query(
        "INSERT INTO study_sessions(id,content,duration,date) VALUES($1,$2,0,$3)",
        [set, "Bad duration", "2026-09-13"],
      ),
    );
    await db.query(
      "INSERT INTO topic_sets(id,session_id,study_date,topic,subject,normalized_key,available_on) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        set,
        id,
        "2026-09-13",
        "Percentages",
        "Quant",
        "quant:percentages",
        "2026-09-15",
      ],
    );
    assert.equal(
      (
        await db.query(
          "SELECT * FROM topic_sets WHERE available_on<='2026-09-14'",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "SELECT * FROM topic_sets WHERE available_on<='2026-09-15'",
        )
      ).rows.length,
      1,
    );
    await db.query(
      "INSERT INTO quiz_attempts(id,set_id,questions) VALUES($1,$2,$3)",
      [attempt, set, JSON.stringify([{ stem: "A question", correct: 0 }])],
    );
    await db.query(
      "UPDATE quiz_attempts SET answers=$1,score=1,submitted_at=now() WHERE id=$2",
      [JSON.stringify([0]), attempt],
    );
    assert.deepEqual(
      (
        await db.query<{ answers: number[] }>(
          "SELECT answers FROM quiz_attempts",
        )
      ).rows[0].answers,
      [0],
    );
  } finally {
    await db.close();
  }
});
