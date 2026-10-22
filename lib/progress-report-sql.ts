import { PROGRESS_REPORT_RELEASE_ID } from "./progress-report-domain";

// These tables are also installed by db/001_initial.sql. The production
// initializer installs them for existing deployments that predate this release.
export const PROGRESS_REPORT_SCHEMA = `
CREATE TABLE IF NOT EXISTS progress_report_campaigns (
 id text PRIMARY KEY,
 cutoff_at timestamptz NOT NULL,
 cutoff_date text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS progress_reports (
 campaign_id text NOT NULL REFERENCES progress_report_campaigns(id),
 user_id uuid NOT NULL REFERENCES app_users(id),
 snapshot jsonb NOT NULL,
 generated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(campaign_id,user_id)
);`;

// One statement freezes both the audience and all data. An existing campaign
// returns no rows, so neither redeploys nor later users can change the report.
// Study time comes only from sealed sessions; ledger rows would double-count it.
// Voice notes, their transcripts, plans and weekly reports are never consulted.
export const CAPTURE_DEPLOYMENT_PROGRESS = `
WITH campaign AS (
 INSERT INTO progress_report_campaigns(id,cutoff_at,cutoff_date)
 SELECT '${PROGRESS_REPORT_RELEASE_ID}',cutoff_at,
        to_char(cutoff_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD')
 FROM (SELECT statement_timestamp() AS cutoff_at) cutoff
 ON CONFLICT(id) DO NOTHING
 RETURNING id,cutoff_at,cutoff_date
), sessions AS MATERIALIZED (
 SELECT s.id,s.user_id,s.date,s.duration
 FROM study_sessions s CROSS JOIN campaign c
 WHERE s.submitted_at<=c.cutoff_at AND s.date<=c.cutoff_date
), study_totals AS (
 SELECT user_id,count(*) AS session_count FROM sessions GROUP BY user_id
), daily_totals AS (
 SELECT user_id,date,sum(duration)::int AS minutes FROM sessions GROUP BY user_id,date
), daily AS (
 SELECT user_id,jsonb_agg(jsonb_build_object('date',date,'minutes',minutes) ORDER BY date) AS minutes
 FROM daily_totals GROUP BY user_id
), topics AS MATERIALIZED (
 SELECT t.id,t.user_id,t.subject,t.normalized_key,t.status,t.available_on
 FROM topic_sets t JOIN sessions s ON s.id=t.session_id AND s.user_id=t.user_id
 CROSS JOIN campaign c
 WHERE t.created_at<=c.cutoff_at AND t.study_date<=c.cutoff_date
), topic_totals AS (
 SELECT t.user_id,count(DISTINCT t.normalized_key) AS topic_count,
        count(*) FILTER (WHERE t.status='ready') AS recall_set_count,
        count(*) FILTER (WHERE t.status='ready' AND t.available_on<=c.cutoff_date) AS available_recall_count
 FROM topics t CROSS JOIN campaign c GROUP BY t.user_id
), subject_totals AS (
 SELECT user_id,subject,count(DISTINCT normalized_key)::int AS topics
 FROM topics GROUP BY user_id,subject
), subjects AS (
 SELECT user_id,jsonb_agg(jsonb_build_object('name',subject,'topics',topics) ORDER BY topics DESC,subject) AS items
 FROM subject_totals GROUP BY user_id
), recall_totals AS (
 SELECT a.user_id,count(*) AS attempt_count,
        sum(jsonb_array_length(a.questions)) AS question_count,
        sum(LEAST(GREATEST(a.score,0),jsonb_array_length(a.questions))) AS correct_count
 FROM quiz_attempts a JOIN topics t ON t.id=a.set_id AND t.user_id=a.user_id
 CROSS JOIN campaign c
 WHERE a.submitted_at<=c.cutoff_at AND a.started_at<=c.cutoff_at AND a.score IS NOT NULL
 GROUP BY a.user_id
)
INSERT INTO progress_reports(campaign_id,user_id,snapshot,generated_at)
SELECT c.id,u.id,jsonb_build_object(
 'sessionCount',COALESCE(s.session_count,0),
 'dailyMinutes',COALESCE(d.minutes,'[]'::jsonb),
 'topicCount',COALESCE(t.topic_count,0),
 'subjects',COALESCE(b.items,'[]'::jsonb),
 'recallSetCount',COALESCE(t.recall_set_count,0),
 'availableRecallCount',COALESCE(t.available_recall_count,0),
 'recallAttemptCount',COALESCE(a.attempt_count,0),
 'recallQuestionCount',COALESCE(a.question_count,0),
 'correctAnswerCount',COALESCE(a.correct_count,0)
),c.cutoff_at
FROM campaign c CROSS JOIN app_users u
LEFT JOIN study_totals s ON s.user_id=u.id
LEFT JOIN daily d ON d.user_id=u.id
LEFT JOIN topic_totals t ON t.user_id=u.id
LEFT JOIN subjects b ON b.user_id=u.id
LEFT JOIN recall_totals a ON a.user_id=u.id
WHERE u.created_at<=c.cutoff_at
ON CONFLICT(campaign_id,user_id) DO NOTHING;`;
