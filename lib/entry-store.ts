import type postgres from "postgres";
import { DayEntryInput, dayEntryInterval, studyContent } from "./day-ledger";

type SaveResult =
  | { ok: true; duplicate: boolean; duration: number }
  | { error: string; overlap?: boolean };

const conflict = { error: "This entry was already sealed. Start a new entry." };
class SaveConflict extends Error {}

export async function saveStudyEntry(
  sql: postgres.Sql,
  userId: string,
  entry: { id: string; content: string; duration: number },
  today: string,
): Promise<SaveResult> {
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM app_users WHERE id=${userId} FOR UPDATE`;
    const inserted = await tx`
      INSERT INTO study_sessions(id,user_id,content,duration,date)
      VALUES(${entry.id},${userId},${entry.content},${entry.duration},${today})
      ON CONFLICT(id) DO NOTHING RETURNING id`;
    const saved =
      await tx`SELECT content,duration FROM study_sessions WHERE id=${entry.id} AND user_id=${userId}`;
    if (
      !saved.length ||
      saved[0].content !== entry.content ||
      saved[0].duration !== entry.duration
    )
      return conflict;
    return { ok: true, duplicate: !inserted.length, duration: entry.duration };
  });
}

export async function saveDayEntry(
  sql: postgres.Sql,
  userId: string,
  entry: DayEntryInput,
): Promise<SaveResult> {
  const interval = dayEntryInterval(entry.startTime, entry.endTime)!;
  try {
    return await sql.begin(async (tx) => {
      // Serialize a user's interval checks and writes, including concurrent tabs.
      await tx`SELECT id FROM app_users WHERE id=${userId} FOR UPDATE`;
      const existing = await tx`SELECT * FROM day_entries WHERE id=${entry.id}`;
      if (existing.length) {
        const saved = existing[0];
        if (
          saved.user_id === userId &&
          saved.date === entry.date &&
          saved.start_minute === interval.startMinute &&
          saved.end_minute === interval.endMinute &&
          saved.activity === entry.activity &&
          saved.subject === entry.subject &&
          saved.topic === entry.topic &&
          saved.note === entry.note
        )
          return { ok: true, duplicate: true, duration: interval.duration };
        return conflict;
      }
      const overlaps = await tx`
        SELECT 1 FROM day_entries WHERE user_id=${userId} AND date=${entry.date}
        AND start_minute<${interval.endMinute} AND end_minute>${interval.startMinute}
        LIMIT 1`;
      if (overlaps.length && !entry.allowOverlap)
        return {
          error:
            "This interval overlaps an existing row. Check the time, or choose SAVE OVERLAP to keep both.",
          overlap: true,
        };
      const isStudy = entry.activity === "Study";
      const collision =
        await tx`SELECT 1 FROM study_sessions WHERE id=${entry.id}`;
      if (collision.length) return conflict;
      if (isStudy) {
        const inserted = await tx`
          INSERT INTO study_sessions(id,user_id,content,duration,date)
          VALUES(${entry.id},${userId},${studyContent(entry.subject, entry.topic, entry.note)},${interval.duration},${entry.date})
          ON CONFLICT(id) DO NOTHING RETURNING id`;
        if (!inserted.length) return conflict;
      }
      const inserted = await tx`
        INSERT INTO day_entries(id,user_id,date,start_minute,end_minute,activity,subject,topic,note,study_session_id)
        VALUES(${entry.id},${userId},${entry.date},${interval.startMinute},${interval.endMinute},${entry.activity},${entry.subject},${entry.topic},${entry.note},${isStudy ? entry.id : null})
        ON CONFLICT(id) DO NOTHING RETURNING id`;
      // Roll back a study session if a different user won this UUID concurrently.
      if (!inserted.length) throw new SaveConflict();
      return { ok: true, duplicate: false, duration: interval.duration };
    });
  } catch (error) {
    if (error instanceof SaveConflict) return conflict;
    throw error;
  }
}
