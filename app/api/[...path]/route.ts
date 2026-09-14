import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { handleUpload } from "@vercel/blob/client";
import { get, head } from "@vercel/blob";
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
  shiftDate,
  publicQuestions,
  Question,
  csv,
} from "@/lib/domain";
import { drainWork } from "@/lib/pipeline";
import {
  drainWeeklyWork,
  generateEligibleReports,
  weeklyDashboard,
} from "@/lib/weekly";
import { startOfIstWeek } from "@/lib/weekly-domain";
import { weeklyPdf } from "@/lib/weekly-pdf";
import { recordEvent } from "@/lib/observability";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
type RequestObservation = { userId: string | null; exceptionLogged: boolean };

async function handler(request: Request, observation: RequestObservation) {
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
      await drainWeeklyWork();
      await sql`DELETE FROM rate_limits WHERE expires_at<now()`;
      return json({ ok: true });
    }
    if (path === "weekly/cron" && method === "GET") {
      if (!cronAuthorized(request)) return json({ error: "Unauthorized" }, 401);
      await generateEligibleReports();
      await drainWeeklyWork();
      return json({ ok: true });
    }
    const userId = (observation.userId = await authenticated());
    if (!userId) return json({ error: "Please sign in again." }, 401);
    if (path === "client-event" && method === "POST") {
      if (!(await rateLimit("client-event:" + userId, 180, 3600)))
        return json({ error: "Too many diagnostic events." }, 429);
      const event = z
        .object({
          eventType: z.string().trim().min(1).max(120),
          message: z.string().trim().min(1).max(500),
          errorCode: z.string().trim().max(160).optional(),
          metadata: z
            .record(
              z.string().trim().min(1).max(80),
              z.union([
                z.string().max(2_000),
                z.number().finite(),
                z.boolean(),
                z.null(),
              ]),
            )
            .optional(),
        })
        .parse(await request.json());
      await recordEvent({
        level: "error",
        category: "client",
        eventType: event.eventType,
        outcome: "error",
        userId,
        message: event.message,
        errorCode: event.errorCode,
        metadata: event.metadata,
      });
      return json({ ok: true }, 202);
    }
    if (path === "data" && method === "GET") {
      const profiles =
        await sql`SELECT display_name,email FROM app_users WHERE id=${userId}`;
      const sessions =
        await sql`SELECT id,date,duration,content,submitted_at AS "submittedAt",status FROM study_sessions WHERE user_id=${userId} ORDER BY submitted_at DESC`;
      const sets =
        await sql`SELECT id,topic,subject,study_date AS "studyDate",available_on AS "availableOn",jsonb_array_length(questions) AS count,status FROM topic_sets WHERE user_id=${userId} ORDER BY study_date DESC`;
      const attempts =
        await sql`SELECT id,set_id AS "setId",score,jsonb_array_length(questions) AS count,submitted_at AS "submittedAt" FROM quiz_attempts WHERE user_id=${userId} AND submitted_at IS NOT NULL ORDER BY submitted_at DESC`;
      const recallVisible = new Set(sessions.map((session) => session.date)).size >= 2;
      return json({
        today: istDate(),
        displayName: profiles[0]?.display_name || "Student",
        email: profiles[0]?.email || "",
        recallVisible,
        sessions,
        sets: recallVisible
          ? sets.map((s) => ({
              ...s,
              topic: s.availableOn <= istDate() ? s.topic : "Upcoming recall",
              subject: s.availableOn <= istDate() ? s.subject : "",
              locked: s.availableOn > istDate(),
            }))
          : [],
        attempts: recallVisible ? attempts : [],
        weekly: await weeklyDashboard(userId),
      });
    }
    if (path === "profile" && method === "POST") {
      if (!(await rateLimit("profile:" + userId, 20, 3600)))
        return json({ error: "Please wait before changing your profile again." }, 429);
      const { displayName } = z
        .object({ displayName: z.string().trim().min(1).max(60) })
        .parse(await request.json());
      await sql`UPDATE app_users SET display_name=${displayName},display_name_edited=true WHERE id=${userId}`;
      return json({ ok: true, displayName });
    }
    if (path === "weekly/upload" && method === "POST") {
      if (!process.env.BLOB_READ_WRITE_TOKEN)
        return json({ error: "Weekly voice storage is not connected yet." }, 503);
      const result = await handleUpload({
        request,
        body: await request.json(),
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          const payload = z
            .object({
              noteId: z.string().uuid(),
              weekStart: z.string().date(),
              kind: z.enum(["plan", "reflection"]),
            })
            .parse(JSON.parse(clientPayload || "null"));
          if (!pathname.startsWith(`weekly/${payload.noteId}/`))
            throw new Error("Invalid upload path");
          const currentWeek = startOfIstWeek(istDate());
          if (
            (payload.kind === "plan" && payload.weekStart !== currentWeek) ||
            (payload.kind === "reflection" &&
              (payload.weekStart > currentWeek ||
                istDate() < shiftDate(payload.weekStart, 6)))
          )
            throw new Error("This weekly note is not open yet");
          const existing =
            await sql`SELECT 1 FROM weekly_voice_notes WHERE user_id=${userId} AND week_start=${payload.weekStart} AND kind=${payload.kind}`;
          if (existing.length) throw new Error("This voice note is already sealed");
          return {
            allowedContentTypes: [
              "audio/aac",
              "audio/flac",
              "audio/m4a",
              "audio/mp4",
              "audio/mpeg",
              "audio/ogg",
              "audio/x-m4a",
              "audio/x-wav",
              "audio/vnd.wave",
              "audio/wav",
              "audio/webm",
              "video/webm",
            ],
            maximumSizeInBytes: 25 * 1024 * 1024,
            addRandomSuffix: true,
            tokenPayload: JSON.stringify({ ...payload, userId }),
          };
        },
      });
      return json(result);
    }
    if (path === "weekly/complete" && method === "POST") {
      const body = z
        .object({
          noteId: z.string().uuid(),
          weekStart: z.string().date(),
          kind: z.enum(["plan", "reflection"]),
          url: z.string().url(),
          pathname: z.string().min(1),
        })
        .parse(await request.json());
      const metadata = await head(body.url);
      if (
        metadata.pathname !== body.pathname ||
        !metadata.pathname.startsWith(`weekly/${body.noteId}/`) ||
        !metadata.contentType.startsWith("audio/") &&
          metadata.contentType !== "video/webm" ||
        metadata.size > 25 * 1024 * 1024
      )
        return json({ error: "The uploaded voice note could not be verified." }, 400);
      const currentWeek = startOfIstWeek(istDate());
      if (
        (body.kind === "plan" && body.weekStart !== currentWeek) ||
        (body.kind === "reflection" &&
          (body.weekStart > currentWeek ||
            istDate() < shiftDate(body.weekStart, 6)))
      )
        return json({ error: "This weekly note is not open yet." }, 400);
      await sql`
        INSERT INTO weekly_voice_notes(
          id,user_id,week_start,kind,blob_url,blob_pathname,content_type,size_bytes
        ) VALUES(
          ${body.noteId},${userId},${body.weekStart},${body.kind},${body.url},
          ${metadata.pathname},${metadata.contentType},${metadata.size}
        ) ON CONFLICT(user_id,week_start,kind) DO NOTHING`;
      after(() => drainWeeklyWork(userId));
      return json({ ok: true });
    }
    if (path === "weekly/report" && method === "GET") {
      const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
      const rows = await sql`
        SELECT r.metrics,u.display_name
        FROM weekly_reports r JOIN app_users u ON u.id=r.user_id
        WHERE r.id=${id} AND r.user_id=${userId}`;
      if (!rows.length) return json({ error: "Report not found." }, 404);
      const bytes = await weeklyPdf(rows[0].display_name, rows[0].metrics);
      await sql`UPDATE weekly_reports SET downloaded_at=COALESCE(downloaded_at,now()) WHERE id=${id} AND user_id=${userId}`;
      return new Response(Buffer.from(bytes), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="odhu-indhu-weekly-${rows[0].metrics.weekStart}.pdf"`,
          "cache-control": "no-store",
        },
      });
    }
    if (path === "weekly/voice" && method === "GET") {
      const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
      const rows =
        await sql`SELECT blob_url FROM weekly_voice_notes WHERE id=${id} AND user_id=${userId}`;
      if (!rows.length) return json({ error: "Voice note not found." }, 404);
      const blob = await get(rows[0].blob_url, { access: "private" });
      if (!blob || blob.statusCode !== 200)
        return json({ error: "Voice note not found." }, 404);
      return new Response(blob.stream, {
        headers: {
          "content-type": blob.blob.contentType,
          "content-length": String(blob.blob.size),
          "content-disposition": "inline",
          "cache-control": "private, no-store",
          "accept-ranges": "none",
        },
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
        after(async () => {
          await Promise.all([
            drainWork(undefined, userId),
            drainWeeklyWork(userId),
          ]);
        });
      return json({ ok: true });
    }
    if (path === "quiz/start" && method === "POST") {
      const { id } = z
        .object({ id: z.string().uuid() })
        .parse(await request.json());
      if (!(await rateLimit("quiz-start:" + userId, 60, 3600)))
        return json({ error: "Too many quiz starts." }, 429);
      const usage =
        await sql`SELECT count(DISTINCT date)::int AS days FROM study_sessions WHERE user_id=${userId}`;
      if (Number(usage[0]?.days || 0) < 2)
        return json({ error: "Recall is not available yet." }, 404);
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
    observation.exceptionLogged = true;
    await recordEvent({
      level: "error",
      category: categoryFor(path),
      eventType: "api.request.exception",
      outcome: "error",
      userId: observation.userId,
      message: error instanceof Error ? error.message : "Unhandled API exception",
      errorCode: error instanceof Error ? error.name : "API_EXCEPTION",
      metadata: {
        path,
        method,
        stack:
          error instanceof Error && error.stack
            ? error.stack.slice(0, 2_000)
            : undefined,
      },
    });
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

const successMessages: Record<string, string> = {
  profile: "Learner profile updated",
  "weekly/upload": "Private voice upload authorised",
  "weekly/complete": "Private voice upload verified",
  "weekly/report": "Weekly PDF report served",
  "weekly/voice": "Private voice note served",
  entries: "Study entry accepted",
  retry: "Study processing retry requested",
  "quiz/start": "Quiz attempt opened",
  "quiz/submit": "Quiz attempt response accepted",
};

function categoryFor(path: string) {
  if (path.startsWith("weekly/upload") || path.startsWith("weekly/voice"))
    return "storage" as const;
  return "api" as const;
}

async function observedHandler(request: Request) {
  const observation: RequestObservation = { userId: null, exceptionLogged: false };
  const path = new URL(request.url).pathname.slice(5);
  const method = request.method;
  const response = await handler(request, observation);
  const successMessage =
    successMessages[path] ||
    (path.startsWith("exports/") ? "Learner data export served" : null);

  if (response.status >= 400 && !observation.exceptionLogged) {
    const payload = await response
      .clone()
      .json()
      .catch(() => null) as { error?: unknown } | null;
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : `Request failed with HTTP ${response.status}`;
    await recordEvent({
      level: "error",
      category: categoryFor(path),
      eventType: "api.request.failed",
      outcome: "error",
      userId: observation.userId,
      message,
      errorCode: `HTTP_${response.status}`,
      metadata: { path, method, status: response.status },
    });
  } else if (successMessage) {
    await recordEvent({
      level: "info",
      category: categoryFor(path),
      eventType: "api.request.succeeded",
      outcome: "success",
      userId: observation.userId,
      message: successMessage,
      metadata: { path, method, status: response.status },
    });
  }

  return response;
}

export { observedHandler as GET, observedHandler as POST };
