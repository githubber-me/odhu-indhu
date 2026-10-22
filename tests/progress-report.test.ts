import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  PROGRESS_REPORT_RELEASE_ID,
  progressReportMetrics,
  type ProgressSnapshot,
} from "../lib/progress-report-domain";
import {
  CAPTURE_DEPLOYMENT_PROGRESS,
  PROGRESS_REPORT_SCHEMA,
} from "../lib/progress-report-sql";

const emptySnapshot: ProgressSnapshot = {
  sessionCount: 0,
  dailyMinutes: [],
  topicCount: 0,
  subjects: [],
  recallSetCount: 0,
  availableRecallCount: 0,
  recallAttemptCount: 0,
  recallQuestionCount: 0,
  correctAnswerCount: 0,
};

test("progress metrics use the frozen cutoff day, weighted recall accuracy and study day totals", () => {
  const snapshot: ProgressSnapshot = {
    ...emptySnapshot,
    sessionCount: 4,
    dailyMinutes: [
      { date: "2000-01-03", minutes: 30 },
      { date: "2000-01-01", minutes: 60 },
      { date: "2000-01-02", minutes: 90 },
    ],
    recallAttemptCount: 2,
    recallQuestionCount: 12,
    correctAnswerCount: 9,
  };
  const metrics = progressReportMetrics(snapshot, "2000-01-03");
  assert.equal(metrics.totalMinutes, 180);
  assert.equal(metrics.activeDays, 3);
  assert.equal(metrics.qualifiedDays, 2);
  assert.equal(metrics.currentStreak, 2);
  assert.equal(metrics.bestStreak, 2);
  assert.equal(metrics.firstStudyDate, "2000-01-01");
  assert.equal(metrics.lastStudyDate, "2000-01-03");
  assert.equal(metrics.recallAccuracy, 75);
  assert.match(metrics.summary, /75% accuracy across 12 questions/);
  assert.equal(snapshot.dailyMinutes[0].date, "2000-01-03");
  assert.deepEqual(progressReportMetrics(snapshot, "2000-01-03"), metrics);
});

test("empty reports describe the absence of evidence without assigning zero recall accuracy", () => {
  const metrics = progressReportMetrics(emptySnapshot, "2026-10-22");
  assert.equal(metrics.totalMinutes, 0);
  assert.equal(metrics.recallAccuracy, null);
  assert.equal(metrics.firstStudyDate, null);
  assert.equal(metrics.lastStudyDate, null);
  assert.equal(metrics.currentStreak, 0);
  assert.match(metrics.summary, /No study entries/);
  assert.match(metrics.summary, /No recall attempts/);
});

test("deployment capture freezes each existing user's study and recall evidence without voice notes", async () => {
  const db = new PGlite();
  const owner = "00000000-0000-4000-8000-000000000001";
  const other = "00000000-0000-4000-8000-000000000002";
  const empty = "00000000-0000-4000-8000-000000000003";
  const later = "00000000-0000-4000-8000-000000000004";
  try {
    await db.exec(
      await readFile(new URL("../db/001_initial.sql", import.meta.url), "utf8"),
    );
    await db.exec(PROGRESS_REPORT_SCHEMA);
    await db.exec(PROGRESS_REPORT_SCHEMA);
    await db.query(
      "INSERT INTO app_users(id,handle,display_name,created_at) VALUES($1,'other','Other','2000-01-01'),($2,'empty','Empty','2000-01-01')",
      [other, empty],
    );
    const sessions = [
      [
        "10000000-0000-4000-8000-000000000001",
        owner,
        60,
        "2000-01-01",
        "2000-01-01",
      ],
      [
        "10000000-0000-4000-8000-000000000002",
        owner,
        30,
        "2000-01-02",
        "2000-01-02",
      ],
      [
        "10000000-0000-4000-8000-000000000003",
        other,
        120,
        "2000-01-02",
        "2000-01-02",
      ],
      [
        "10000000-0000-4000-8000-000000000004",
        owner,
        500,
        "2000-01-03",
        "2999-01-01",
      ],
      [
        "10000000-0000-4000-8000-000000000005",
        owner,
        500,
        "2999-01-01",
        "2000-01-01",
      ],
    ];
    for (const row of sessions)
      await db.query(
        "INSERT INTO study_sessions(id,user_id,content,duration,date,submitted_at) VALUES($1,$2,'Study entry',$3,$4,$5)",
        row,
      );
    const topics = [
      [
        "20000000-0000-4000-8000-000000000001",
        owner,
        sessions[0][0],
        "2000-01-01",
        "ready",
        "2000-01-01",
      ],
      [
        "20000000-0000-4000-8000-000000000002",
        owner,
        sessions[1][0],
        "2000-01-02",
        "queued",
        "2000-01-02",
      ],
      [
        "20000000-0000-4000-8000-000000000003",
        owner,
        sessions[0][0],
        "2000-01-03",
        "ready",
        "2999-01-01",
      ],
    ];
    for (const row of topics)
      await db.query(
        "INSERT INTO topic_sets(id,user_id,session_id,study_date,status,created_at,topic,subject,normalized_key,available_on) VALUES($1,$2,$3,$4,$5,$6,'Percentages','Mathematics','math:percentages','2000-01-04')",
        row,
      );
    await db.query(
      `INSERT INTO quiz_attempts(id,user_id,set_id,questions,score,started_at,submitted_at)
       VALUES('30000000-0000-4000-8000-000000000001',$1,$2,'[{},{},{}]',2,'2000-01-04','2000-01-04'),
       ('30000000-0000-4000-8000-000000000002',$1,$2,'[{}]',1,'2000-01-04','2999-01-01'),
       ('30000000-0000-4000-8000-000000000003',$1,$2,'[{}]',NULL,'2000-01-04',NULL)`,
      [owner, topics[0][0]],
    );
    await db.query(
      `INSERT INTO day_entries(id,user_id,date,start_minute,end_minute,activity,study_session_id)
       VALUES($1,$2,'2000-01-01',540,600,'Study',$1)`,
      [sessions[0][0], owner],
    );
    await db.query(
      `INSERT INTO weekly_voice_notes(id,user_id,week_start,kind,blob_url,blob_pathname,content_type,size_bytes,transcript,structured,status)
       VALUES('40000000-0000-4000-8000-000000000001',$1,'2000-01-03','plan','https://example.com/voice','voice','audio/webm',1,'I studied for 900 hours','{"goals":[{"title":"900 hours"}]}','ready')`,
      [owner],
    );
    await db.exec(CAPTURE_DEPLOYMENT_PROGRESS);
    const reports = await db.query<{
      user_id: string;
      snapshot: ProgressSnapshot;
    }>("SELECT user_id,snapshot FROM progress_reports ORDER BY user_id");
    assert.equal(reports.rows.length, 3);
    const ownerSnapshot = reports.rows.find(
      (row) => row.user_id === owner,
    )?.snapshot;
    assert.ok(ownerSnapshot);
    assert.deepEqual(ownerSnapshot, {
      sessionCount: 2,
      dailyMinutes: [
        { date: "2000-01-01", minutes: 60 },
        { date: "2000-01-02", minutes: 30 },
      ],
      topicCount: 1,
      subjects: [{ name: "Mathematics", topics: 1 }],
      recallSetCount: 1,
      availableRecallCount: 1,
      recallAttemptCount: 1,
      recallQuestionCount: 3,
      correctAnswerCount: 2,
    });
    assert.equal(
      reports.rows.find((row) => row.user_id === other)?.snapshot.sessionCount,
      1,
    );
    assert.deepEqual(
      reports.rows.find((row) => row.user_id === empty)?.snapshot,
      emptySnapshot,
    );
    const campaigns = await db.query<{
      id: string;
      cutoff_at: Date;
      cutoff_date: string;
    }>("SELECT id,cutoff_at,cutoff_date FROM progress_report_campaigns");
    assert.equal(campaigns.rows[0].id, PROGRESS_REPORT_RELEASE_ID);
    assert.equal(
      campaigns.rows[0].cutoff_date,
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        campaigns.rows[0].cutoff_at,
      ),
    );

    // A new deployment/request must not add later users or revise existing data,
    // even when those users add backdated study or complete earlier quizzes.
    await db.query(
      "INSERT INTO app_users(id,handle,display_name,created_at) VALUES($1,'later','Later','2000-01-01')",
      [later],
    );
    await db.query(
      "INSERT INTO study_sessions(id,user_id,content,duration,date,submitted_at) VALUES('10000000-0000-4000-8000-000000000006',$1,'Later study entry',60,'2000-01-01','2000-01-01')",
      [owner],
    );
    await db.exec(
      "UPDATE quiz_attempts SET score=3,submitted_at=now() WHERE submitted_at IS NULL",
    );
    await db.exec("UPDATE topic_sets SET status='ready'");
    await db.exec(
      "UPDATE weekly_voice_notes SET status='failed',transcript='Updated voice progress'",
    );
    await db.exec(CAPTURE_DEPLOYMENT_PROGRESS);
    assert.deepEqual(
      (
        await db.query(
          "SELECT user_id,snapshot FROM progress_reports ORDER BY user_id",
        )
      ).rows,
      reports.rows,
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT id,cutoff_at,cutoff_date FROM progress_report_campaigns",
        )
      ).rows,
      campaigns.rows,
    );
  } finally {
    await db.close();
  }
});
