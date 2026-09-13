CREATE TABLE IF NOT EXISTS study_sessions (
 id uuid PRIMARY KEY, content text NOT NULL CHECK(length(content) BETWEEN 3 AND 12000),
 duration integer NOT NULL CHECK(duration BETWEEN 1 AND 720),
 date text NOT NULL, submitted_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0,
 leased_until timestamptz, error_code text
);
CREATE INDEX IF NOT EXISTS study_sessions_date ON study_sessions(date);
CREATE TABLE IF NOT EXISTS topic_sets (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES study_sessions(id),
 study_date text NOT NULL, topic text NOT NULL, subject text NOT NULL,
 normalized_key text NOT NULL, available_on text NOT NULL,
 questions jsonb NOT NULL DEFAULT '[]', evidence jsonb NOT NULL DEFAULT '[]',
 status text NOT NULL DEFAULT 'queued', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(study_date, normalized_key)
);
CREATE TABLE IF NOT EXISTS quiz_attempts (
 id uuid PRIMARY KEY, set_id uuid NOT NULL REFERENCES topic_sets(id),
 questions jsonb NOT NULL, answers jsonb, score integer,
 started_at timestamptz NOT NULL DEFAULT now(), submitted_at timestamptz
);
CREATE TABLE IF NOT EXISTS auth_sessions (
 token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
 key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL
);
ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS failures integer NOT NULL DEFAULT 0;
ALTER TABLE topic_sets ADD COLUMN IF NOT EXISTS generator_model text;
ALTER TABLE topic_sets ADD COLUMN IF NOT EXISTS prompt_version text;
CREATE OR REPLACE FUNCTION preserve_study_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.content IS DISTINCT FROM OLD.content
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
