import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type postgres from "postgres";
import { appUserId } from "../lib/auth-identity";
import {
  entryDraftKey,
  readEntryDraft,
  writeEntryDraft,
} from "../lib/entry-draft";

test("Neon identities stay independent; legacy ownership requires the configured subject", async () => {
  const database = new PGlite();
  try {
    await database.exec(
      await readFile(new URL("../db/001_initial.sql", import.meta.url), "utf8"),
    );
    const adapt = (
      connection: Pick<PGlite, "query">,
    ): ReturnType<typeof postgres> => {
      const tag = async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const query = strings.reduce(
          (text, part, index) => text + (index ? `$${index}` : "") + part,
          "",
        );
        return (await connection.query(query, values)).rows;
      };
      return Object.assign(tag, {
        begin: (
          callback: (tx: ReturnType<typeof postgres>) => Promise<unknown>,
        ) => database.transaction((tx) => callback(adapt(tx))),
      }) as unknown as ReturnType<typeof postgres>;
    };
    const sql = adapt(database);
    const first = await appUserId(
      sql,
      { id: "first", email: "  STUDENT@example.com " },
      undefined,
    );
    const second = await appUserId(
      sql,
      { id: "second", email: "student@example.com" },
      undefined,
    );
    assert.notEqual(first, "00000000-0000-4000-8000-000000000001");
    assert.notEqual(first, second, "matching emails must not merge subjects");
    assert.equal(
      first,
      await appUserId(
        sql,
        { id: "first", email: "student@example.com" },
        undefined,
      ),
    );
    await database.query(
      "UPDATE app_users SET display_name='Chosen name',display_name_edited=true WHERE id=$1",
      [first],
    );
    await appUserId(
      sql,
      { id: "first", email: "new-name@example.com" },
      undefined,
    );
    assert.deepEqual(
      (
        await database.query(
          "SELECT display_name,email FROM app_users WHERE id=$1",
          [first],
        )
      ).rows[0],
      {
        display_name: "Chosen name",
        email: "new-name@example.com",
      },
    );
    const outsider = await appUserId(sql, { id: "outsider" }, "actual-owner");
    assert.notEqual(outsider, "00000000-0000-4000-8000-000000000001");
    assert.equal(
      await appUserId(sql, { id: "actual-owner" }, "actual-owner"),
      "00000000-0000-4000-8000-000000000001",
    );
    assert.equal(
      (
        await database.query<{ auth_subject: string }>(
          "SELECT auth_subject FROM app_users WHERE id='00000000-0000-4000-8000-000000000001'",
        )
      ).rows[0].auth_subject,
      "actual-owner",
    );
  } finally {
    await database.close();
  }
});

test("entry drafts isolate accounts, retain retry IDs and reject malformed storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const draft = {
    content: "Percentages",
    duration: 90,
    id: "550e8400-e29b-41d4-a716-446655440000",
  };
  writeEntryDraft(storage, "student-a", draft);
  assert.deepEqual(readEntryDraft(storage, "student-a"), draft);
  assert.equal(readEntryDraft(storage, "student-b"), null);
  storage.setItem("odhu-indhu-entry-draft", JSON.stringify(draft));
  assert.equal(readEntryDraft(storage, "student-b"), null);
  storage.setItem(entryDraftKey("student-b"), "not JSON");
  assert.equal(readEntryDraft(storage, "student-b"), null);
  storage.setItem(
    entryDraftKey("student-b"),
    JSON.stringify({ ...draft, duration: -1 }),
  );
  assert.equal(readEntryDraft(storage, "student-b"), null);
  storage.setItem(
    entryDraftKey("student-b"),
    JSON.stringify({ ...draft, id: "invalid" }),
  );
  assert.equal(readEntryDraft(storage, "student-b")?.id, null);
  writeEntryDraft(storage, "student-a", {
    content: "",
    duration: 60,
    id: null,
  });
  assert.equal(readEntryDraft(storage, "student-a"), null);
});
