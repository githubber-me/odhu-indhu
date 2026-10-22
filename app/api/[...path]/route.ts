import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { get } from "@vercel/blob";
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
import {
  drainWeeklyWork,
  generateEligibleReports,
  weeklyDashboard,
  completeWeeklyUpload,
} from "@/lib/weekly";
import {
  MAX_VOICE_BYTES,
  VOICE_CONTENT_TYPES,
  voiceNoteOpen,
  voiceNoteSchema,
  voicePathMatches,
} from "@/lib/voice";
import {
  handleVoiceUploadCallback,
  InvalidVoiceCallbackError,
} from "@/lib/voice-callback";
import { weeklyPdf } from "@/lib/weekly-pdf";
import { recordEvent } from "@/lib/observability";
import { dayEntrySchema } from "@/lib/day-ledger";
import { saveDayEntry, saveStudyEntry } from "@/lib/entry-store";
import {
  ensureDeploymentProgressReports,
  progressReportForUser,
} from "@/lib/progress-report";
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
    const uploadBody =
      path === "weekly/upload" && method === "POST"
        ? ((await request.clone().json()) as HandleUploadBody)
        : null;
    const onUploadCompleted: NonNullable<
      Parameters<typeof handleUpload>[0]["onUploadCompleted"]
    > = async ({ blob, tokenPayload }) => {
      const payload = voiceNoteSchema
        .extend({ userId: z.string().uuid() })
        .parse(JSON.parse(tokenPayload || "null"));
      observation.userId = payload.userId;
      await completeWeeklyUpload(
        payload.userId,
        payload,
        blob.url,
        blob.pathname,
      );
      after(() => drainWeeklyWork(payload.userId));
    };
    // Vercel's completion webhook has no browser session or Origin header.
    // handleUpload verifies its signature before invoking this callback.
    if (uploadBody?.type === "blob.upload-completed") {
      if (!process.env.BLOB_READ_WRITE_TOKEN || !process.env.DATABASE_URL)
        return json(
          { error: "Weekly voice storage is not connected yet." },
          503,
        );
      try {
        return json(
          await handleVoiceUploadCallback(
            request,
            uploadBody,
            onUploadCompleted,
          ),
        );
      } catch (error) {
        if (error instanceof InvalidVoiceCallbackError)
          return json({ error: "Invalid upload callback." }, 403);
        throw error;
      }
    }
    if (method === "POST" && !sameOrigin(request))
      return json({ error: "Request origin rejected." }, 403);
    if (path === "status") {
      if (!configured())
        return json({ configured: false, authenticated: false });
      try {
        await ensureDeploymentProgressReports();
        return json({
          configured: true,
          authenticated: Boolean(await authenticated()),
        });
      } catch {
        return json(
          { error: "Unable to check your session. Please try again." },
          503,
        );
      }
    }
    if (!configured())
      return json(
        { error: "Private access is being set up. Please return shortly." },
        503,
      );
    await ensureDeploymentProgressReports();
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
    const expectedAccount = request.headers.get("x-account-id");
    if (
      method === "POST" &&
      ((["entries", "day-entries", "profile"].includes(path) &&
        !expectedAccount) ||
        (expectedAccount && expectedAccount !== userId))
    )
      return json(
        {
          error: "Your account changed. Reopen your ledger before saving.",
          code: "ACCOUNT_CHANGED",
        },
        409,
      );
    if (path === "client-event" && method === "POST") {
      if (!(await rateLimit("client-event:" + userId, 180, 3600)))
        return json({ error: "Too many diagnostic events." }, 429);
      const event = z
        .object({
          level: z.enum(["info", "warn", "error"]).optional(),
          eventType: z.string().trim().min(1).max(120),
          outcome: z.string().trim().min(1).max(40).optional(),
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
        level: event.level ?? "error",
        category: "client",
        eventType: event.eventType,
        outcome:
          event.outcome ?? (event.level === "info" ? "success" : "error"),
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
      const dayEntries =
        await sql`SELECT id,date,start_minute AS "startMinute",end_minute AS "endMinute",end_minute-start_minute AS duration,activity,subject,topic,note,created_at AS "createdAt" FROM day_entries WHERE user_id=${userId} ORDER BY date DESC,start_minute,created_at`;
      const recallVisible =
        new Set(sessions.map((session) => session.date)).size >= 2;
      return json({
        userId,
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
        dayEntries,
        weekly: await weeklyDashboard(userId),
        progressReport: await progressReportForUser(userId),
      });
    }
    if (path === "profile" && method === "POST") {
      if (!(await rateLimit("profile:" + userId, 20, 3600)))
        return json(
          { error: "Please wait before changing your profile again." },
          429,
        );
      const { displayName } = z
        .object({ displayName: z.string().trim().min(1).max(60) })
        .parse(await request.json());
      await sql`UPDATE app_users SET display_name=${displayName},display_name_edited=true WHERE id=${userId}`;
      return json({ ok: true, displayName });
    }
    if (path === "weekly/upload" && method === "POST") {
      if (!process.env.BLOB_READ_WRITE_TOKEN)
        return json(
          { error: "Weekly voice storage is not connected yet." },
          503,
        );
      if (!(await rateLimit("voice-upload:" + userId, 30, 3600)))
        return json(
          { error: "Please wait before uploading more voice notes." },
          429,
        );
      const result = await handleUpload({
        request,
        body: uploadBody!,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          const payload = voiceNoteSchema.parse(
            JSON.parse(clientPayload || "null"),
          );
          if (!voicePathMatches(pathname, userId, payload))
            throw new Error("Invalid upload path");
          if (!voiceNoteOpen(payload, istDate()))
            throw new Error("This weekly note is not open yet");
          const existing =
            await sql`SELECT 1 FROM weekly_voice_notes WHERE user_id=${userId} AND week_start=${payload.weekStart} AND kind=${payload.kind}`;
          if (existing.length)
            throw new Error("This voice note is already sealed");
          return {
            allowedContentTypes: VOICE_CONTENT_TYPES,
            maximumSizeInBytes: MAX_VOICE_BYTES,
            addRandomSuffix: true,
            allowOverwrite: false,
            validUntil: Date.now() + 15 * 60 * 1000,
            tokenPayload: JSON.stringify({ ...payload, userId }),
          };
        },
        onUploadCompleted,
      });
      return json(result);
    }
    if (path === "weekly/complete" && method === "POST") {
      const body = voiceNoteSchema
        .extend({
          url: z.string().url(),
          pathname: z.string().min(1),
        })
        .parse(await request.json());
      try {
        await completeWeeklyUpload(userId, body, body.url, body.pathname);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_VOICE_UPLOAD")
          return json(
            { error: "The uploaded voice note could not be verified." },
            400,
          );
        if (error instanceof Error && error.message === "VOICE_ALREADY_SAVED")
          return json(
            {
              error:
                "A voice note has already been saved for this week. Refresh to see it.",
            },
            409,
          );
        throw error;
      }
      after(() => drainWeeklyWork(userId));
      return json({ ok: true });
    }
    if (path === "weekly/retry" && method === "POST") {
      if (!(await rateLimit("voice-retry:" + userId, 12, 3600)))
        return json({ error: "Please allow voice processing to finish." }, 429);
      const { id } = z
        .object({ id: z.string().uuid() })
        .parse(await request.json());
      const rows = await sql`UPDATE weekly_voice_notes SET
        status=CASE WHEN transcript IS NOT NULL THEN 'transcribing' ELSE 'queued' END,
        sarvam_job_id=CASE WHEN transcript IS NOT NULL THEN sarvam_job_id ELSE NULL END,
        attempts=0,leased_until=NULL,error_code=NULL
        WHERE id=${id} AND user_id=${userId} AND status='failed' RETURNING id`;
      if (!rows.length)
        return json({ error: "A failed voice note was not found." }, 404);
      after(() => drainWeeklyWork(userId));
      return json({ ok: true });
    }
    if (path === "weekly/report" && method === "GET") {
      const id = z
        .string()
        .uuid()
        .parse(new URL(request.url).searchParams.get("id"));
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
      const id = z
        .string()
        .uuid()
        .parse(new URL(request.url).searchParams.get("id"));
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
      const result = await saveStudyEntry(sql, userId, body, istDate());
      if ("error" in result) return json(result, 409);
      if (!result.duplicate) after(() => drainWork(body.id));
      return json(result);
    }
    if (path === "day-entries" && method === "POST") {
      const body = dayEntrySchema.parse(await request.json());
      if (body.date > istDate())
        return json(
          { error: "Future rows belong in a plan, not the day ledger." },
          400,
        );
      if (!(await rateLimit("day-entries:" + userId, 120, 3600)))
        return json({ error: "Please wait before adding more day rows." }, 429);
      const result = await saveDayEntry(sql, userId, body);
      if ("error" in result) return json(result, 409);
      if (body.activity === "Study" && !result.duplicate)
        after(() => drainWork(body.id));
      return json(result);
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
      else if (type === "day-ledger")
        rows =
          await sql`SELECT id,date,start_minute,end_minute,end_minute-start_minute AS duration,activity,subject,topic,note,study_session_id,created_at FROM day_entries WHERE user_id=${userId} ORDER BY date,start_minute`;
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
      message:
        error instanceof Error ? error.message : "Unhandled API exception",
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
  data: "Learner dashboard loaded",
  profile: "Learner profile updated",
  cron: "Background processing cycle completed",
  "weekly/cron": "Weekly processing cycle completed",
  "weekly/upload": "Private voice upload authorised",
  "weekly/complete": "Private voice upload verified",
  "weekly/retry": "Saved voice note processing restarted",
  "weekly/report": "Weekly PDF report served",
  "weekly/voice": "Private voice note served",
  entries: "Study entry accepted",
  "day-entries": "Day ledger row accepted",
  retry: "Study processing retry requested",
  work: "Learner processing cycle requested",
  "quiz/start": "Quiz attempt opened",
  "quiz/submit": "Quiz attempt response accepted",
};

function categoryFor(path: string) {
  if (path.startsWith("weekly/upload") || path.startsWith("weekly/voice"))
    return "storage" as const;
  return "api" as const;
}

async function observedHandler(request: Request) {
  const observation: RequestObservation = {
    userId: null,
    exceptionLogged: false,
  };
  const path = new URL(request.url).pathname.slice(5);
  const method = request.method;
  const response = await handler(request, observation);
  const successMessage =
    successMessages[path] ||
    (path.startsWith("exports/") ? "Learner data export served" : null);

  if (response.status >= 400 && !observation.exceptionLogged) {
    const payload = (await response
      .clone()
      .json()
      .catch(() => null)) as { error?: unknown } | null;
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
