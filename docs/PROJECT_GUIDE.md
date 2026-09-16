# Odhu Indhu project guide

Odhu Indhu is a quiet study companion built around a simple promise: show up, record the work, and come back tomorrow.

Each person's data stays separate. A student can sign in with Google or a Magic Link, record any subject they studied, build a streak using IST calendar days, and later answer carefully researched MCQs generated from their own notes.

The visual language is deliberately restrained. Warm paper, black type, Karnataka red, strong borders, and typewriter details keep the interface focused without making it feel clinical.

## A look at the app

### A first visit

Authentication lives on the home page. There is no separate password screen and the application never stores passwords.

![Odhu Indhu sign-in screen](docs/screenshots/sign-in.png)

### The daily ledger

The home screen puts today's commitment first. Its headline changes once per IST calendar day, using all 40 Kannada and English combinations before a newly shuffled cycle begins.

![Odhu Indhu desktop study ledger](docs/screenshots/dashboard-desktop.png)

### The same ledger on mobile

The experience is responsive and keeps the study entry, duration controls, progress and history usable on a narrow screen.

![Odhu Indhu mobile study ledger](docs/screenshots/dashboard-mobile.png)

## What it does

### Study entries that stay honest

A student writes what they studied and enters the number of minutes spent. Multiple sessions can be added on the same day. The server assigns the calendar date in `Asia/Kolkata`, so changing a device clock cannot move an entry into another day.

Once an entry is sealed, its content, duration, date, owner and submission time cannot be edited. PostgreSQL enforces this rule with a trigger, not just the interface. Requests are idempotent, so retrying a submission does not create a duplicate entry.

The input experience includes:

- automatic draft recovery within the browser session
- a text area that grows with the note
- quick duration choices for 30, 45, 60, 90 and 120 minutes
- `Command + Enter` or `Control + Enter` submission
- server-side limits for content and duration

### Streaks based on real calendar days

A day qualifies after the student's sessions total at least 60 minutes. Streaks use IST calendar days and do not depend on whether an AI provider is available. Yesterday's completed streak remains alive while today is still open, then closes at midnight IST if the day's hour was not completed.

The dashboard shows the current streak, best streak, total study time and a compact calendar ledger.

### Recall that appears at the right time

Recall is intentionally absent for a brand new student. The tab, topic count and quiz metadata remain hidden until study has been logged on two distinct IST calendar days. The backend still parses notes, researches topics and prepares questions during this period.

Each topic quiz opens two calendar days after the original study date. A topic studied on Monday can first be attempted on Wednesday. Starting the quiz creates a frozen attempt, so later changes to the question bank cannot alter an attempt already in progress.

Questions are multiple choice. Before submission the client receives only the stem and four options. After submission it receives:

- the score and submitted answer
- the correct option
- a worked solution
- an explanation for every option
- the evidence URLs used during generation

Scoring happens locally on the server from the frozen question set. Taking or submitting a quiz does not call an LLM.

### A daily voice without daily repetition

The hero copy contains 40 independent Kannada, English and mixed-language combinations. A seeded shuffle chooses one for each IST date. Every line appears exactly once within a 40-day cycle, refreshing does not change the day's line, and cycle boundaries are checked to prevent the same line appearing on consecutive days.

## How question preparation works

The study note is stored first. AI processing is separate from streak calculation, which means a provider outage can delay a quiz but can never erase a completed study day.

For each entry, the worker follows this sequence:

1. Sarvam extracts concrete, unique topics from the raw note.
2. Each topic is stored privately with an availability date two IST calendar days later.
3. Parallel searches for authoritative supporting material. Government sources, NCERT, established educational sources and dated primary material are preferred.
4. Sarvam creates MCQ candidates grounded in that evidence.
5. Schema checks reject malformed questions, duplicate choices, unsupported source URLs, and `all of the above` or `none of the above` options.
6. A separate Sarvam critic pass checks the answer, ambiguity, calculations, sources and every distractor explanation.
7. Accepted questions accumulate until the topic contains ten.

Each worker invocation handles one topic and uses a five-minute database lease. Accepted partial work survives retries. Submitting an entry triggers processing immediately, the open application nudges pending work, and a daily Vercel Cron request recovers anything left behind.

This review process is deliberately conservative, but generated questions should still be treated as assisted study material rather than a certified exam bank. The most valuable future quality improvement would be deterministic checking for mathematical question families plus a curated evaluation set.

## Architecture

| Area | Implementation |
|---|---|
| Web application | Next.js 16, React 19 and TypeScript |
| Hosting | Vercel |
| Database | Neon Serverless Postgres |
| Authentication | Neon Auth with Google and passwordless Magic Link |
| Topic and question model | Sarvam API |
| Evidence retrieval | Parallel Search API |
| Validation | Zod plus deterministic application checks |
| Browser verification | Playwright using Chrome |
| Database verification | PGlite running the real migration |

The application uses a small number of direct, parameterized SQL queries. There is no ORM because the data model is compact and the SQL constraints are an important part of the product behavior.

### Data model

| Table | Purpose |
|---|---|
| `app_users` | Maps a Neon identity to a stable internal user ID and display name |
| `study_sessions` | Stores immutable raw notes, duration, IST date and processing state |
| `day_entries` | Stores structured daily time intervals; study rows link atomically to study sessions |
| `topic_sets` | Stores parsed topics, evidence, generated questions and unlock dates |
| `quiz_attempts` | Freezes questions for an attempt and records answers and score |
| `rate_limits` | Applies small database-backed limits to sensitive actions |
| `weekly_voice_notes` | Stores private audio references, transcripts and one-time structured elements |
| `weekly_reports` | Stores deterministic weekly metrics and PDF download state |

Every study session, topic set and attempt carries `user_id`. Each Neon identity receives an independent application account. A compatibility path can still attach a legacy unclaimed record to its first authenticated owner, preserving data from installations that existed before authentication.

## Authentication and security

Neon Auth owns identity, Google OAuth, Magic Link delivery and session cookies. Email and password credentials are disabled. The application stores only the Neon subject mapping required to associate product data with a user.

Sign-in is embedded on `/`. The legacy `/auth/sign-in` location redirects home. Google and Magic Link still need `/auth/callback` as a technical return route. Next.js Proxy completes Neon's verifier exchange and creates the signed session cookie, preventing the callback loop that occurs when OAuth returns without middleware.

Other safeguards include:

- a closed-by-default startup state when database or Auth configuration is absent
- authenticated ownership checks on all application data
- same-origin checks on state-changing requests
- a separate bearer secret for the cron endpoint
- server-side request validation and rate limiting
- answer, explanation and evidence redaction before quiz submission
- spreadsheet formula neutralization in CSV exports
- `no-store` responses for private application data
- browser security headers and a restrictive content security policy

Provider keys are server-only. They are never sent to the browser or stored in application tables.

## Local setup

### Requirements

- Node.js 20 or newer
- a Neon Postgres project with Neon Auth enabled
- Sarvam API access
- Parallel API access
- Google Chrome for the current Playwright configuration, or a local adjustment to use Playwright Chromium

### 1. Install dependencies

```sh
npm install
```

### 2. Configure the environment

Copy `.env.example` to `.env.local` and fill in the values. Never commit `.env.local`.

| Variable | Required | Notes |
|---|---:|---|
| `DATABASE_URL` | Yes | Use the pooled Neon connection string for ordinary application traffic |
| `NEON_AUTH_BASE_URL` | Yes | Neon Auth endpoint; `DATABASE_NEON_AUTH_BASE_URL` is also accepted automatically |
| `CRON_SECRET` | Yes | Random secret used to authenticate Vercel Cron |
| `SARVAM_API_KEY` | Yes | Server-only credential for topic extraction, MCQ generation and critique |
| `PARALLEL_API_KEY` | Yes | Server-only credential for evidence retrieval |
| `SARVAM_MODEL` | No | Defaults to `sarvam-105b`; use `glm5.2` only when that model is enabled for the account |
| `NEON_AUTH_COOKIE_SECRET` | No | Dedicated cookie-signing secret of at least 32 characters; otherwise a separated key is derived from `CRON_SECRET` |

A suitable cron secret can be generated with:

```sh
openssl rand -hex 32
```

### 3. Prepare the database

```sh
npm run db:migrate
```

The migration is repeatable. It creates missing tables and constraints, upgrades older installations, adds user ownership where needed and installs the immutable-entry trigger.

### 4. Configure Neon Auth

In the Neon Auth dashboard:

1. Enable Google.
2. Enable Magic Link.
3. Leave email and password credentials disabled.
4. Add the local and deployed application domains to the allowed domains.

### 5. Start the app

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploying to Vercel

Connect the repository to Vercel, then install the Neon integration for the project. The integration can create the production and preview database variables automatically. Depending on its custom prefix, the Auth URL may arrive as `NEON_AUTH_BASE_URL` or `DATABASE_NEON_AUTH_BASE_URL`; the application accepts both.

Add these server-side variables to the required Vercel environments:

- `CRON_SECRET`
- `SARVAM_API_KEY`
- `PARALLEL_API_KEY`
- `SARVAM_MODEL`, only when overriding the default
- `NEON_AUTH_COOKIE_SECRET`, only when using a dedicated cookie secret

Run the database migration against the production connection before the first sign-in. Then redeploy so the latest variables are available to the application.

The included `vercel.json` schedules `/api/cron` at `03:00 UTC`, which is `08:30 IST`. Vercel Hobby supports the daily recovery sweep. Immediate entry processing and authenticated browser nudges usually prepare work sooner. A public, high-volume version should move processing to a durable queue or use a more frequent scheduled worker.

## Useful commands

```sh
npm run dev           # start local development
npm run lint          # run the TypeScript check
npm test              # run domain and database tests
npm run test:browser  # run the Playwright flows
npm run build         # create the production build
npm run db:migrate    # apply the repeatable database migration
```

`node scripts/check-providers.mjs` performs one small Sarvam request and one small Parallel request. It is useful when provider configuration changes, but it makes billable API calls.

## Verification coverage

The automated suite covers:

- IST midnight and date arithmetic
- streak continuity and the 60-minute threshold
- all 40 daily hero messages without repetition inside a cycle
- request validation and immutable database entries
- user ownership persistence
- delayed quiz availability
- pre-submission answer redaction
- explanation and source visibility after submission
- CSV escaping and spreadsheet safety
- first-time and returning authentication presentation
- hidden Recall navigation during the first study day
- desktop and mobile ledger interaction

Browser tests mock authenticated API data so they can verify the complete interface without controlling a real Google account. Provider credentials have passed small live checks, but a real Google OAuth round trip and a full production quiz generation remain deployment-level smoke tests.

## Exports and ownership

Authenticated users can download CSV exports for:

- raw study sessions
- parsed topics
- questions from quizzes that have already been attempted
- submitted attempts and scores

Question exports stay restricted until the related quiz has been submitted. Direct Neon database access remains the administrative path for a complete private backup.

## Project map

```text
app/
  api/[...path]/route.ts       protected product API, exports and cron
  api/auth/[...path]/route.ts  Neon Auth route handler
  auth/                        Auth callback screens and first-visit content
  page.tsx                     daily ledger, history and Recall experience
db/
  001_initial.sql              repeatable schema and integrity constraints
docs/screenshots/              verified product captures used in this README
lib/
  auth.ts                      identity mapping, origin checks and rate limits
  daily-hero.ts                40-day shuffled copy rotation
  db.ts                        Neon connection setup
  domain.ts                    IST dates, streaks, schemas and CSV output
  neon-auth.ts                 shared Neon Auth server configuration
  pipeline.ts                  topic extraction, research, MCQs and critique
proxy.ts                       OAuth verifier exchange and page session routing
tests/                         domain, database and browser verification
vercel.json                    daily recovery schedule
```

`docs/IMPLEMENTATION_PLAN.md` preserves the earlier design thinking. This README and the running code describe the current application. Weekly question blasts, browser-managed bring-your-own-key support and a durable high-volume worker remain future possibilities rather than exposed features.
