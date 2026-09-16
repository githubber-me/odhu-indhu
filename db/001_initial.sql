CREATE TABLE IF NOT EXISTS app_users (
 id uuid PRIMARY KEY, handle text NOT NULL UNIQUE,
 display_name text NOT NULL, email text,
 display_name_edited boolean NOT NULL DEFAULT false,
 auth_provider text, auth_subject text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(auth_provider, auth_subject)
);
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS display_name_edited boolean NOT NULL DEFAULT false;
UPDATE app_users SET display_name=initcap(handle) WHERE display_name IS NULL;
ALTER TABLE app_users ALTER COLUMN display_name SET NOT NULL;
ALTER TABLE app_users DROP COLUMN IF EXISTS password_hash;
INSERT INTO app_users(id,handle,display_name) VALUES('00000000-0000-4000-8000-000000000001','varun','Varun')
ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS study_sessions (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES app_users(id),
 content text NOT NULL CHECK(length(content) BETWEEN 3 AND 12000),
 duration integer NOT NULL CHECK(duration BETWEEN 1 AND 720),
 date text NOT NULL, submitted_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0,
 leased_until timestamptz, error_code text
);
CREATE INDEX IF NOT EXISTS study_sessions_date ON study_sessions(date);
CREATE TABLE IF NOT EXISTS topic_sets (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES app_users(id),
 session_id uuid NOT NULL REFERENCES study_sessions(id),
 study_date text NOT NULL, topic text NOT NULL, subject text NOT NULL,
 normalized_key text NOT NULL, available_on text NOT NULL,
 questions jsonb NOT NULL DEFAULT '[]', evidence jsonb NOT NULL DEFAULT '[]',
 status text NOT NULL DEFAULT 'queued', created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT topic_sets_user_date_topic_key UNIQUE(user_id, study_date, normalized_key)
);
CREATE TABLE IF NOT EXISTS day_entries (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES app_users(id),
 date text NOT NULL,
 start_minute integer NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
 end_minute integer NOT NULL CHECK(end_minute BETWEEN 1 AND 1440 AND end_minute>start_minute),
 activity text NOT NULL CHECK(activity IN ('Study','Work','Sleep','Break','Exercise','Travel','Personal','Other')),
 subject text NOT NULL DEFAULT '' CHECK(length(subject)<=100),
 topic text NOT NULL DEFAULT '' CHECK(length(topic)<=200),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 study_session_id uuid UNIQUE REFERENCES study_sessions(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS day_entries_user_date_time
ON day_entries(user_id,date,start_minute,end_minute);
CREATE TABLE IF NOT EXISTS quiz_attempts (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES app_users(id),
 set_id uuid NOT NULL REFERENCES topic_sets(id),
 questions jsonb NOT NULL, answers jsonb, score integer,
 started_at timestamptz NOT NULL DEFAULT now(), submitted_at timestamptz
);
DROP TABLE IF EXISTS auth_sessions;
CREATE TABLE IF NOT EXISTS rate_limits (
 key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS weekly_voice_notes (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES app_users(id),
 week_start text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('plan','reflection')),
 blob_url text NOT NULL,
 blob_pathname text NOT NULL,
 content_type text NOT NULL,
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 26214400),
 transcript text,
 structured jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','transcribing','ready','failed')),
 sarvam_job_id text,
 attempts integer NOT NULL DEFAULT 0,
 leased_until timestamptz,
 error_code text,
 uploaded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,week_start,kind)
);
CREATE INDEX IF NOT EXISTS weekly_voice_notes_work ON weekly_voice_notes(status,leased_until,uploaded_at);
CREATE TABLE IF NOT EXISTS weekly_reports (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES app_users(id),
 week_start text NOT NULL,
 metrics jsonb NOT NULL,
 generated_at timestamptz NOT NULL DEFAULT now(),
 downloaded_at timestamptz,
 UNIQUE(user_id,week_start)
);
ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS failures integer NOT NULL DEFAULT 0;
ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';
ALTER TABLE topic_sets ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';
ALTER TABLE topic_sets ADD COLUMN IF NOT EXISTS generator_model text;
ALTER TABLE topic_sets ADD COLUMN IF NOT EXISTS prompt_version text;
ALTER TABLE topic_sets DROP CONSTRAINT IF EXISTS topic_sets_study_date_normalized_key_key;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='study_sessions_user_id_fkey') THEN
  ALTER TABLE study_sessions ADD CONSTRAINT study_sessions_user_id_fkey FOREIGN KEY(user_id) REFERENCES app_users(id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='topic_sets_user_id_fkey') THEN
  ALTER TABLE topic_sets ADD CONSTRAINT topic_sets_user_id_fkey FOREIGN KEY(user_id) REFERENCES app_users(id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='quiz_attempts_user_id_fkey') THEN
  ALTER TABLE quiz_attempts ADD CONSTRAINT quiz_attempts_user_id_fkey FOREIGN KEY(user_id) REFERENCES app_users(id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='topic_sets_user_date_topic_key') THEN
  ALTER TABLE topic_sets ADD CONSTRAINT topic_sets_user_date_topic_key UNIQUE(user_id,study_date,normalized_key);
 END IF;
END $$;
CREATE OR REPLACE FUNCTION preserve_study_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.content IS DISTINCT FROM OLD.content
 OR NEW.user_id IS DISTINCT FROM OLD.user_id
 OR NEW.duration IS DISTINCT FROM OLD.duration OR NEW.date IS DISTINCT FROM OLD.date
 OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
 RAISE EXCEPTION 'Sealed study entries cannot be edited';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS immutable_study_entry ON study_sessions;
CREATE TRIGGER immutable_study_entry BEFORE UPDATE ON study_sessions
FOR EACH ROW EXECUTE FUNCTION preserve_study_entry();
