import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, configured } from "@/lib/db";
import {
  authenticated,
  rateLimit,
  sameOrigin,
  cronAuthorized,
} from "@/lib/auth";
import {
  entrySchema,
  istDate,
  publicQuestions,
  Question,
  csv,
} from "@/lib/domain";
import { drainWork } from "@/lib/pipeline";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function handler(request: Request) {
  const path = new URL(request.url).pathname.slice(5),
    method = request.method;
  try {
    if (method === "POST" && !sameOrigin(request))
      return json({ error: "Request origin rejected." }, 403);
    if (path === "status") {
      if (!configured())
        return json({ configured: false, authenticated: false });
      try {
        return json({
          configured: true,
          authenticated: Boolean(await authenticated()),
        });
      } catch {
        return json({ configured: false, authenticated: false });
      }
    }
    if (!configured())
      return json(
        { error: "Private access is being set up. Please return shortly." },
        503,
      );
    const sql = db();
    if (path === "cron" && method === "GET") {
      if (!cronAuthorized(request)) return json({ error: "Unauthorized" }, 401);
      await drainWork();
      await sql`DELETE FROM rate_limits WHERE expires_at<now()`;
      return json({ ok: true });
    }
    const userId = await authenticated();
    if (!userId) return json({ error: "Please sign in again." }, 401);
    if (path === "data" && method === "GET") {
      const profiles =
        await sql`SELECT display_name FROM app_users WHERE id=${userId}`;
      const sessions =
        await sql`SELECT id,date,duration,content,submitted_at AS "submittedAt",status FROM study_sessions WHERE user_id=${userId} ORDER BY submitted_at DESC`;
      const sets =
        await sql`SELECT id,topic,subject,study_date AS "studyDate",available_on AS "availableOn",jsonb_array_length(questions) AS count,status FROM topic_sets WHERE user_id=${userId} ORDER BY study_date DESC`;
      const attempts =
        await sql`SELECT id,set_id AS "setId",score,jsonb_array_length(questions) AS count,submitted_at AS "submittedAt" FROM quiz_attempts WHERE user_id=${userId} AND submitted_at IS NOT NULL ORDER BY submitted_at DESC`;
      return json({
        today: istDate(),
        displayName: profiles[0]?.display_name || "Student",
        sessions,
        sets: sets.map((s) => ({
          ...s,
          topic: s.availableOn <= istDate() ? s.topic : "Upcoming recall",
          subject: s.availableOn <= istDate() ? s.subject : "",
          locked: s.availableOn > istDate(),
        })),
        attempts,
      });
    }
    if (path === "entries" && method === "POST") {
      const body = entrySchema.parse(await request.json());
      if (!(await rateLimit("entries:" + userId, 30, 3600)))
        return json({ error: "Please wait before adding more sessions." }, 429);
      await sql`INSERT INTO study_sessions(id,user_id,content,duration,date) VALUES(${body.id},${userId},${body.content},${body.duration},${istDate()}) ON CONFLICT(id) DO NOTHING`;
      const saved =
        await sql`SELECT content,duration FROM study_sessions WHERE id=${body.id} AND user_id=${userId}`;
      if (
        saved[0].content !== body.content ||
        saved[0].duration !== body.duration
      )
        return json(
          { error: "This entry was already saved. Start a new entry." },
          409,
        );
      after(() => drainWork(body.id));
      return json({ ok: true });
    }
    if (path === "retry" && method === "POST") {
      if (!(await rateLimit("retry:" + userId, 12, 3600)))
        return json({ error: "Please allow processing to finish." }, 429);
      const { id } = z
        .object({ id: z.string().uuid() })
        .parse(await request.json());
      await sql`UPDATE study_sessions SET status='queued',attempts=0,failures=0,leased_until=NULL WHERE id=${id} AND user_id=${userId} AND status='failed'`;
      after(() => drainWork(id));
      return json({ ok: true });
    }
    if (path === "work" && method === "POST") {
      if (await rateLimit("work:" + userId, 1, 20))
        after(() => drainWork(undefined, userId));
      return json({ ok: true });
    }
    if (path === "quiz/start" && method === "POST") {
      const { id } = z
        .object({ id: z.string().uuid() })
        .parse(await request.json());
      if (!(await rateLimit("quiz-start:" + userId, 60, 3600)))
        return json({ error: "Too many quiz starts." }, 429);
      const sets =
        await sql`SELECT * FROM topic_sets WHERE id=${id} AND user_id=${userId} AND available_on<=${istDate()} AND jsonb_array_length(questions)>0`;
      if (!sets.length)
        return json({ error: "This quiz is not available yet." }, 404);
      const attemptId = randomUUID(),
        set = sets[0];
      await sql`INSERT INTO quiz_attempts(id,user_id,set_id,questions) VALUES(${attemptId},${userId},${id},${sql.json(set.questions)})`;
      return json({
        id: attemptId,
        topic: set.topic,
        questions: publicQuestions(set.questions),
      });
    }
    if (path === "quiz/submit" && method === "POST") {
      const { id, answers } = z
        .object({
          id: z.string().uuid(),
          answers: z.array(z.number().int().min(-1).max(3)).min(1).max(10),
        })
        .parse(await request.json());
      const result = await sql.begin(async (tx) => {
        const rows =
          await tx`SELECT * FROM quiz_attempts WHERE id=${id} AND user_id=${userId} FOR UPDATE`;
        if (!rows.length) throw new Error("NOT_FOUND");
        const attempt = rows[0],
          questions: Question[] = attempt.questions;
        if (answers.length !== questions.length)
          throw new Error("INVALID_ANSWERS");
        if (attempt.submitted_at)
          return { questions, answers: attempt.answers, score: attempt.score };
        const score = questions.reduce(
          (n, q, i) => n + Number(q.correct === answers[i]),
          0,
        );
        await tx`UPDATE quiz_attempts SET answers=${tx.json(answers)},score=${score},submitted_at=now() WHERE id=${id}`;
        return { questions, answers, score };
      });
      return json(result);
    }
    if (path.startsWith("exports/") && method === "GET") {
      const type = path.slice(8);
      let rows;
      if (type === "raw")
        rows =
          await sql`SELECT * FROM study_sessions WHERE user_id=${userId} ORDER BY submitted_at`;
      else if (type === "topics")
        rows =
          await sql`SELECT id,session_id,study_date,topic,subject,available_on,status FROM topic_sets WHERE user_id=${userId} ORDER BY created_at`;
      else if (type === "questions")
        rows =
          await sql`SELECT topic,study_date,questions,evidence FROM topic_sets WHERE user_id=${userId} AND available_on<=${istDate()} AND EXISTS(SELECT 1 FROM quiz_attempts WHERE set_id=topic_sets.id AND user_id=${userId} AND submitted_at IS NOT NULL)`;
      else if (type === "attempts")
        rows =
          await sql`SELECT id,set_id,answers,score,submitted_at FROM quiz_attempts WHERE user_id=${userId} AND submitted_at IS NOT NULL`;
      else return json({ error: "Unknown export" }, 404);
      return new Response(csv(rows), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="odhu-indhu-${type}.csv"`,
          "cache-control": "no-store",
        },
      });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return json({ error: "Please check the submitted values." }, 400);
    return json(
      {
        error:
          "Unable to complete this request. Your saved entries are safe. Please try again.",
      },
      503,
    );
  }
}
export { handler as GET, handler as POST };
