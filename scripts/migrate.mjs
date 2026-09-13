import nextEnv from "@next/env";
import postgres from "postgres";
import { readFile } from "node:fs/promises";
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL in .env.local first.");
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql.begin(async (tx) => {
    await tx.unsafe(
      await readFile(new URL("../db/001_initial.sql", import.meta.url), "utf8"),
    );
  });
  console.log("Database migration complete.");
} catch {
  console.error(
    "Migration failed. Check the connection string and database permissions. No credentials were printed.",
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
