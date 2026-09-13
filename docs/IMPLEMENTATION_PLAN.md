# Odhu Indhu: implementation plan

Status: build-ready product and technical specification. This document is planning only; no application implementation is included.

## 1. Product definition

Odhu Indhu is a private, general-purpose study companion. Its core loop is:

1. A learner records a study session in plain English and enters its duration manually.
2. Sessions on the same IST calendar day accumulate toward a one-hour goal.
3. A day qualifies for the streak as soon as the total reaches 60 minutes.
4. The raw entry remains immutable.
5. Backend processing privately extracts topics and generates 10 rigorously checked MCQs for every unique topic.
6. Questions remain locked for two IST calendar days. Work logged on Monday becomes available on Wednesday.
7. The learner completes a topic-labelled quiz and sees the result, the correct answer, a full solution, and an explanation for every option only after submitting the quiz.

The experience should feel like a disciplined study ledger, not a gamified children's app.

## 2. Decisions already fixed

- Product name: **Odhu Indhu**.
- UI language: English, with restrained Kannada identity.
- Platform: responsive web application deployed on Vercel.
- Users: independent accounts with strictly separated study data.
- Authentication: Google and passwordless Magic Link through Neon Auth.
- Study input: immutable free text plus manually entered duration.
- Streak qualification: at least 60 accumulated minutes in an IST calendar day.
- Backdating: unavailable.
- Day boundary: strict midnight in `Asia/Kolkata`; no grace period.
- Generation failures do not invalidate earned study time or streaks.
- Parsed topics are backend-only and are not shown for review.
- Quiz production: 10 accepted questions for every unique parsed topic.
- Quiz presentation: grouped and visibly labelled by topic.
- Quiz unlocking: source study date plus two calendar days in IST.
- Scoring: correct/incorrect only; no negative marks.
- Explanations: revealed after the entire quiz is submitted.
- AI credentials: centrally configured server-side keys for the MVP.
- Study content and generated data: stored in PostgreSQL with authenticated CSV exports.
- Raw entries: never edited or overwritten through the product UI.

## 3. Recommended stack

- Next.js App Router with TypeScript.
- Vercel Functions using the Node.js runtime.
- Neon Postgres provisioned through the Vercel Marketplace.
- Drizzle ORM and versioned SQL migrations.
- Zod for request validation and LLM response validation.
- Tailwind CSS plus small local primitives; avoid a visually generic component-library result.
- Sarvam chat-completions API for parsing, generation, and critique.
- Parallel Search API for retrieval and evidence gathering.
- `next/font` for the selected Latin and Kannada fonts.
- Vitest for unit/integration tests and Playwright for critical browser flows.

Do not use CSV files as the database. Vercel deployments are immutable, concurrent writes to a flat file are unsafe, and relational data is needed for topics, questions, options, sources, and attempts. PostgreSQL remains canonical; CSV is an export format.

## 4. Information architecture

### `/login`

- Odhu Indhu mark, one password field, and no account-creation path.
- Generic error for invalid credentials.
- Rate-limit failed attempts.

### `/today`

- Current streak is the dominant number.
- Today's progress reads, for example, `42 / 60 MIN`.
- Manual duration control: hours and minutes, normalized to total minutes.
- Large free-text field: “What did you study?”
- Submit button records one immutable session.
- A compact list shows today's submitted sessions, duration, timestamp, and processing state.
- Before 60 minutes: show minutes remaining to protect the streak.
- At 60 minutes: mark the day complete immediately.

### `/history`

- Calendar/ledger view of qualifying and non-qualifying days.
- Selecting a date shows the raw immutable session entries and durations.
- Do not expose parsed topic structures or model metadata here.

### `/quizzes`

- Available sets grouped by source study date, then topic.
- Locked sets may be represented only as an aggregate teaser such as “30 questions arriving Wednesday”; do not reveal their questions.
- Each topic card shows question count, source date, previous score, and completion state.
- A future “Weekly Blast” slot can select across the same question bank without schema changes.

### `/quizzes/[quizSessionId]`

- One question at a time or a clean paginated list; answers remain editable until submission.
- Topic is always visible.
- No correctness indicators before final submission.
- On submission, freeze answers and show total score followed by per-question review.
- Review includes the correct answer, solution, rationale for all four options, and citations where relevant.

### `/progress`

- Current streak, best streak, qualified hours, questions answered, accuracy, and topic accuracy.
- Avoid leaderboards, social comparison, XP, confetti overload, and artificial scarcity.

### `/settings`

- CSV/JSON export buttons.
- Sign out.
- No provider keys or parsed-topic controls in the MVP UI.

## 5. Streak specification

All timestamps are stored as UTC instants. Every study session also stores the server-derived `study_date` in `Asia/Kolkata`.

A date qualifies when the sum of valid session durations for that user and `study_date` is at least 60 minutes.

Rules:

- The server determines `study_date`; the client cannot submit a date.
- Accepted duration range per session: 1–720 minutes.
- Multiple sessions accumulate.
- Additional minutes after 60 are retained for analytics but do not add extra streak days.
- AI processing status never affects qualification.
- A day is not considered broken while it is still in progress. If yesterday qualified, the existing streak remains visible today with a “minutes to protect” state until midnight.
- Once midnight passes without 60 minutes, the previous streak is closed.
- The current streak is derived from consecutive qualifying dates, not incremented as a mutable counter.
- The best streak can be calculated from the same dates and cached only as a performance optimization.

Every calculation must receive an explicit timezone and be tested around 23:59/00:00 IST and UTC date boundaries.

## 6. Data model

Use UUID primary keys, `timestamptz` for instants, `date` for IST study dates, check constraints where possible, and `created_at`/`updated_at` on processing records.

### `users`

- `id`
- `display_name`
- `timezone`: initially `Asia/Kolkata`
- `created_at`

Create an application user when a Neon identity first signs in.

### `study_sessions`

- `id`
- `user_id`
- `study_date`
- `duration_minutes`
- `raw_content`
- `submitted_at`
- `idempotency_key`
- `processing_status`: `pending | processing | ready | partial | failed`

`raw_content`, `duration_minutes`, `study_date`, and `submitted_at` are immutable. Enforce uniqueness on `(user_id, idempotency_key)`.

### `study_days`

- `user_id`
- `study_date`
- `total_minutes`
- `qualifies_for_streak`
- `first_session_at`
- `last_session_at`

This is an atomic aggregate/cache maintained when a session is inserted. The source of truth remains `study_sessions`.

### `parsed_topics`

- `id`
- `study_session_id`
- `subject`
- `topic`
- `subtopic`
- `normalized_key`
- `coverage_summary`
- `confidence`
- `parser_model`
- `parser_prompt_version`
- `created_at`

Deduplicate matching `normalized_key` values within the same `user_id + study_date`. Repeated study of the same topic on another date remains meaningful and may create a fresh question set.

### `generation_jobs`

- `id`
- `study_session_id`
- `stage`: `parse | retrieve | generate | critique | persist`
- `status`: `queued | running | succeeded | retryable | exhausted`
- `attempt_count`
- `last_error_code`
- `started_at`
- `finished_at`
- `prompt_version`

Never store credentials, complete provider payloads, reasoning traces, or secret-bearing headers.

### `question_sets`

- `id`
- `parsed_topic_id`
- `source_study_date`
- `available_on`
- `status`: `generating | ready | partial | failed`
- `accepted_count`
- `created_at`

`available_on` equals `source_study_date + 2` and is evaluated in IST. A ready set is not queryable by the quiz client until `current_ist_date >= available_on`.

### `questions`

- `id`
- `question_set_id`
- `question_text`
- `difficulty`: `easy | medium | hard`
- `question_kind`: `factual | quantitative | reasoning | language`
- `solution`
- `verification_status`: `accepted | rejected | needs_review`
- `generator_model`
- `critic_model`
- `content_hash`
- `created_at`

Only `accepted` questions can enter a quiz. Use `content_hash` to suppress duplicates.

### `question_options`

- `id`
- `question_id`
- `position`: `A | B | C | D`
- `option_text`
- `is_correct`
- `explanation`

Database constraints plus application validation must ensure exactly four options and exactly one correct option.

### `question_sources`

- `id`
- `question_id`
- `url`
- `title`
- `publisher`
- `published_at`
- `retrieved_at`
- `evidence_excerpt`
- `evidence_hash`
- `source_role`: `primary | corroborating | definition`

### `quiz_sessions`

- `id`
- `user_id`
- `mode`: `topic | weekly_blast | review`
- `topic_label`
- `started_at`
- `submitted_at`
- `correct_count`
- `question_count`

### `quiz_session_questions`

- `quiz_session_id`
- `question_id`
- `sort_order`
- `selected_option_id`
- `is_correct`
- `answered_at`

Snapshot question ordering and selections so later bank changes cannot rewrite an attempt.

## 7. Submission and processing lifecycle

### Request path

1. Authenticate the signed HTTP-only session.
2. Validate duration and raw text.
3. Derive the IST study date on the server.
4. Insert the immutable `study_session` and atomically update `study_days`.
5. Return the new daily total and streak state immediately.
6. Start backend processing after the response with Vercel `waitUntil`.

### Reliability

- Persist a `generation_job` before starting AI work.
- Make every stage idempotent.
- Retry provider timeouts, `429`, and `5xx` with bounded exponential backoff and jitter.
- Do not retry invalid schemas indefinitely.
- A protected daily Vercel Cron route sweeps stale `pending`, `processing`, and `retryable` jobs. Exact cron timing is not product-critical.
- After the retry ceiling, retain the raw session, preserve the streak, mark processing `failed`, and allow a private server-side reprocess action.
- Do not expose raw provider errors to learners.

Vercel Queues may replace the database-backed retry/sweeper mechanism later, but the database-backed approach is sufficient for the current scale.

## 8. LLM and retrieval pipeline

### Stage A: parse

Send only the raw entry and its study context to Sarvam. Require strict JSON matching a versioned schema:

- `subject`
- `topic`
- `subtopic`
- `coverage_summary`
- `confidence`
- `search_queries`

Use low temperature. When using GLM-5.2 structured output, disable its thinking mode for reliable JSON. Validate with Zod and retry once with a repair prompt if necessary.

### Stage B: retrieve evidence

For each unique parsed topic, call Parallel with a self-contained objective and 2–3 concise queries. Retrieval policy varies by question kind:

- Current affairs and changing facts: recent primary source plus independent corroboration.
- Polity, history, geography, economics, and science: prefer government, statutory, educational, or other authoritative references.
- English: prefer reputable dictionary, usage, and grammar sources.
- Quantitative aptitude and reasoning: retrieval may provide definitions or conventions, but correctness should primarily come from deterministic calculation.

Store only the evidence used for accepted questions. Record retrieval time because factual validity can age.

### Stage C: generate candidates

Ask for 12–14 candidates per topic so weak questions can be rejected while retaining 10. Every candidate must include:

- One unambiguous stem.
- Exactly four distinct options.
- Exactly one correct option.
- A full solution.
- An explanation of why each option is right or wrong.
- Difficulty and question-kind labels.
- Evidence references for factual claims.
- Structured calculation inputs for supported quantitative templates.

### Stage D: deterministic validation

Reject candidates that fail any rule:

- Missing, duplicate, overlapping, or trivially distinguishable options.
- More or fewer than one correct answer.
- “All/none of the above.”
- Negative wording unless visually emphasized and unavoidable.
- Unsupported dates, names, figures, quotations, or current claims.
- Question/answer leakage, subjective wording, or multiple reasonable interpretations.
- Near-duplicate stem or answer pattern in the existing bank.
- Broken arithmetic, units, ranges, or option ordering.

For supported Quant and Reasoning templates, recompute the result in application code and require it to match the marked answer.

### Stage E: critic pass

Use a separate generation-time Sarvam call and a different prompt to judge each candidate against its evidence. The critic returns only structured verdicts and reason codes. It must explicitly test whether any distractor could also be correct.

Accept a question only when deterministic checks and the critic both pass. Refill rejected slots with bounded regeneration. If fewer than 10 survive, publish a partial set rather than lowering the quality threshold, then let the retry job attempt the remainder.

The quiz-taking path makes no LLM or search calls.

## 9. Quiz selection and future growth

For MVP, every available topic is visible as its own 10-question set. Do not combine all unlocked questions into an unexpectedly huge mandatory session.

The question bank supports future modes without changing generated content:

- Weekly Blast: stratified random selection across the previous seven days.
- Mistake Review: prioritize previously missed questions.
- Spaced Review: resurface questions after configurable intervals.
- Weak Topic: weight selection by topic accuracy.
- Mixed Mock: combine topics and difficulty bands.
- Freshness retirement: exclude time-sensitive questions after their validity window.

Random selection must be seeded and persisted to `quiz_session_questions` so refreshing cannot change the quiz.

## 10. API surface

All mutation routes require authentication, origin/CSRF checks, rate limits, Zod validation, and structured error responses.

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/today`
- `POST /api/study-sessions`
- `GET /api/history?from=&to=`
- `GET /api/streak`
- `GET /api/quizzes/available`
- `POST /api/quiz-sessions`: creates a persisted quiz from an available set.
- `GET /api/quiz-sessions/:id`: omits correctness and explanations before submission.
- `POST /api/quiz-sessions/:id/submit`: transactionally freezes answers and returns review data.
- `GET /api/progress`
- `GET /api/exports/raw.csv`
- `GET /api/exports/topics.csv`
- `GET /api/exports/questions.csv`
- `GET /api/exports/attempts.csv`
- `GET /api/cron/retry-processing`: Vercel Cron secret only.

Never serialize `is_correct`, solutions, option explanations, or evidence excerpts into the pre-submission page payload. Hiding them with CSS is not security.

## 11. Authentication and security

Use one passphrase without self-service registration:

- Store only `APP_PASSWORD_HASH` and `AUTH_SECRET` in Vercel environment variables.
- Compare hashes with a timing-safe function.
- Issue a short, signed HTTP-only, secure, `SameSite=Lax` cookie.
- Rotate the session on successful login and expire it on logout.
- Rate-limit login and AI-triggering routes by session and IP.
- Apply a restrictive Content Security Policy.
- Mark provider modules server-only.
- Keep `SARVAM_API_KEY` and `PARALLEL_API_KEY` out of client bundles and API responses.
- Redact authorization headers and avoid logging request bodies containing study notes.
- Add `.env*` to `.gitignore` while retaining a value-free `.env.example`.

Required environment-variable names:

- `DATABASE_URL`
- `SARVAM_API_KEY`
- `PARALLEL_API_KEY`
- `APP_PASSWORD_HASH`
- `AUTH_SECRET`
- `CRON_SECRET`

The current `.env.local` was verified as an empty, zero-byte file on 2026-09-13. Populate it before integration testing; never commit its values.

## 12. Export and data ownership

Provide authenticated, streaming CSV exports generated from database queries:

- Raw ledger: submitted timestamp, IST study date, duration, raw content, processing status.
- Parsed topics: source session, subject, topic, subtopic, summary, confidence, model and prompt version.
- Question bank: topic, stem, options, correct option, solution, validation state and source URLs.
- Attempts: quiz, topic, selected option, correctness and timestamps.

Quote and escape CSV fields correctly, emit UTF-8, and use stable column ordering. JSON export can be added using the same query layer. Do not create continuously mutated CSV files on Vercel.

## 13. Visual system

### Brand hierarchy

- Product name in navigation: `ODHU INDHU` as typography, separate from the icon.
- Primary logo: symbol only; the product name does not need to be embedded in the mark.
- Kannada appears as a small seal or secondary line: `ಓದು ಇಂದು`.
- Suggested tagline: `STUDY TODAY. RECALL LATER.`

### Palette

- Ink: `#111111`
- Paper: `#F4F0E6`
- Vermilion: `#A51C20`
- Muted ink: `#66615A`
- Hairline: `#D8D1C5`

No pastel palette, gradients in the UI, glassmorphism, neon effects, or soft cartoon illustration.

### Typography

- Display/data: IBM Plex Mono or another crisp typewriter-derived mono.
- Body/UI: IBM Plex Sans or a neutral system sans.
- Kannada fallback/accent: Noto Sans Kannada.
- Use tabular numerals for streaks, dates, minutes, and scores.

### Graphic language

- Strong black rules and ledger columns.
- Vermilion used for active progress, qualified days, and answer-review emphasis.
- Kasuti-inspired stepped geometry only as a small divider, seal, or construction grid.
- Motion should be functional: a single restrained stamp/line completion when 60 minutes is reached.

The raster marks in `assets/brand` are concept explorations. They must be redrawn as simple SVGs before production use, with gradients removed and 16/24/32-pixel legibility checked.

## 14. Testing requirements

### Unit tests

- IST date derivation around UTC boundaries.
- Multiple-session accumulation and the exact 60-minute boundary.
- Current-streak behavior before and after midnight.
- Best-streak calculation across gaps.
- `available_on = source_date + 2` across month/year boundaries.
- Request idempotency and duplicate submission protection.
- Exactly-four/exactly-one-correct question invariants.
- Quiz score calculation and submission immutability.
- CSV quoting, Unicode, newlines, and formula-injection neutralization.

### Integration tests

- Persist raw input even when parsing fails.
- Provider retry and timeout behavior with mocked Sarvam/Parallel responses.
- Parser schema repair and terminal failure.
- Candidate rejection/refill and partial-set behavior.
- Locked question data cannot be fetched before its date.
- Correct answers cannot be obtained before quiz submission.
- Cron reclaims stale jobs without duplicating topics/questions.

### End-to-end tests

- Login, submit two sessions totalling 60 minutes, and observe streak qualification.
- Submit at both sides of the IST midnight boundary.
- See a quiz remain unavailable until the third calendar day.
- Complete a quiz, submit once, and review all option explanations.
- Download each export while authenticated; reject unauthenticated exports.

## 15. Observability and cost controls

- Structured logs contain job/session IDs, stages, durations, token counts, result counts, and sanitized error codes.
- Never log API keys, raw request headers, model reasoning, or full study text.
- Track generated, accepted, rejected, and regenerated questions per topic.
- Track provider latency and estimated spend per job.
- Bound topics, candidate refills, retries, output tokens, and source count per request.
- Alert privately when jobs are exhausted or acceptance rate falls below a configured threshold.
- Version every parsing, generation, and critic prompt so quality changes are traceable.

## 16. Delivery order for Luna

1. Project shell, database, migrations, environment validation, and passphrase authentication.
2. Immutable study submission, daily aggregates, streak engine, and history.
3. Job state machine with mocked providers and retry sweeper.
4. Sarvam parsing plus Parallel evidence retrieval.
5. Candidate generation, deterministic validation, critic pass, and question persistence.
6. Locked topic quiz list, quiz taking, atomic submission, and explanation review.
7. Progress metrics and CSV exports.
8. Apply the visual system, redraw the selected emblem as SVG, responsive QA, accessibility, and deployment checks.

Each phase should land with its relevant tests. Provider integrations should remain behind interfaces so models can be changed without touching product logic.

## 17. Acceptance criteria

The MVP is complete only when:

- Two immutable sessions of 30 minutes on the same IST date qualify that date.
- A failed AI job does not remove the qualified day.
- No client request can backdate a session.
- Ten accepted questions exist for each unique parsed topic, or the set is clearly marked partial while retries continue.
- Day-one questions cannot be fetched on days one or two and become available on day three IST.
- A quiz reveals no answers before submission and all explanations afterward.
- Every accepted factual MCQ has stored evidence and passes the ambiguity critic.
- Raw, structured, question, and attempt data can be downloaded as authenticated CSV.
- Neither provider key appears in client bundles, logs, database rows, or exports.
- The primary interface remains usable at mobile and desktop widths with keyboard navigation and accessible contrast.
