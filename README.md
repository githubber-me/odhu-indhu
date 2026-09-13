# Odhu Indhu

Varun’s private SSC CGL companion. Next.js on Vercel, Neon Postgres and Neon Auth, immutable study entries, IST streaks, and delayed topic quizzes.

## One-time setup

1. Create a Neon Postgres database with Auth enabled through the Vercel integration. Use a region close to the application, expose it as `DATABASE_URL`, and copy `DATABASE_URL` plus `NEON_AUTH_BASE_URL` into `.env.local`. Keep their values private.
2. Generate `CRON_SECRET` with `openssl rand -hex 32`, keep it in `.env.local`, and add the same value to Vercel. The application derives a domain-separated Neon Auth cookie-signing key from it. You may instead set a dedicated `NEON_AUTH_COOKIE_SECRET` of at least 32 characters.
3. Keep `SARVAM_API_KEY` and `PARALLEL_API_KEY` in `.env.local`. `SARVAM_MODEL` defaults to `sarvam-105b`; set `SARVAM_MODEL=glm5.2` only after enabling Sarvam beta access.
4. Run `npm run db:migrate`. The repeatable migration creates the application tables and prevents edits to sealed study entries.
5. In Neon Auth, enable Google and Magic Link and leave email/password credentials disabled. Run `npm run dev`, open [localhost:3000](http://localhost:3000), and sign in with either option.

The app stays closed if database, Neon Auth, or cookie-signing configuration is absent. It never falls back to an unauthenticated mode.

## Vercel deployment

Set `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `CRON_SECRET`, `SARVAM_API_KEY`, `PARALLEL_API_KEY`, and optionally `SARVAM_MODEL` in Vercel. Neon’s integration supplies branch-specific database and Auth URLs for previews. Run the migration against production before signing in, configure the allowed domains, and enable only Google and Magic Link in Neon Auth.

`vercel.json` includes a daily recovery sweep compatible with Hobby. Submission and the authenticated app also trigger background processing. Each worker invocation handles one topic with a database lease; additional topics progress while the app is open or through the recovery sweep. With many topics and the browser closed, preparation can take longer than the unlock date. For guaranteed high-volume readiness, use a more frequent authenticated cron on Vercel Pro or a durable queue before opening public registration. The unlock date itself never depends on cron timing.

## Implemented behavior

- Durations are validated server-side; the server assigns the IST study date.
- Multiple sessions totaling 60 minutes qualify a day. Streaks do not depend on AI success.
- Sessions are idempotent and immutable in PostgreSQL.
- Every study session, topic set, and quiz attempt carries a stable internal user ID. The first authenticated Neon user claims the seeded `varun` record, preserving any pre-authentication history; later users receive isolated accounts.
- Neon Auth owns Google OAuth, passwordless Magic Link, session cookies, and email delivery. Password credentials are disabled. The application stores only the Neon subject-to-internal-user mapping needed for its own data.
- AI routes require login and origin checks. Cron requires its own bearer secret.
- Topics are extracted privately; Parallel supplies evidence, Sarvam generates MCQs and independently critiques correctness and ambiguity. Accepted questions accumulate toward ten per topic. Partial results retain only accepted questions.
- Quiz questions remain on the server until their IST unlock date. Answers and explanations are omitted until submission, which freezes the answer set transactionally.
- Review explains every option, shows sources and records the score. Revisit creates a new attempt.
- CSV exports escape fields and neutralize spreadsheet formula prefixes. Question exports include only topics with a submitted attempt; direct database access remains available to the owner for full administrative exports.
- No model calls happen during quiz taking or scoring.

Automatic review reduces errors but does not certify zero-error questions. Numerical answers currently receive a second model solution/critique; deterministic mathematical template checking and independently sourced gold-question evaluation remain recommended before treating the bank as authoritative exam material.

## Development and verification

```sh
npm install
npm test
npm run build
npm run test:browser
```

Unit tests cover IST boundaries, streak gaps, unlock dates, request validation, answer redaction, and CSV safety. Database tests use an isolated PostgreSQL-compatible PGlite engine to validate the actual migration, constraints, deduplication, and persistence. Browser tests exercise desktop/mobile interaction with mocked API responses and the real unconfigured-access boundary. They do not claim a live Neon or provider integration test.

The browser configuration uses the installed macOS Chrome executable. Set a different executable or install Playwright Chromium when running on another machine.

Sarvam standard JSON output and Parallel search passed small live checks without exposing keys. Recheck providers with `node scripts/check-providers.mjs` (two small billable requests).

## Implementation map

- `lib/domain.ts`: dates, streaks, validation, answer projection, CSV serialization.
- `lib/db.ts`, `db/001_initial.sql`: database connection and repeatable migration.
- `lib/auth.ts`: Neon Auth, internal user mapping, origin checks, rate limits, and cron authorization.
- `lib/pipeline.ts`: bounded topic generation and critique with persistent retries.
- `app/api/[...path]/route.ts`: protected API and export endpoints.
- `app/auth/[path]/page.tsx`: Neon Auth’s Google and passwordless Magic Link screens.
- `app/page.tsx`: ledger, history, quiz, and review screens.

The earlier `docs/IMPLEMENTATION_PLAN.md` is design history. This README and the implemented code describe the current architecture; direct parameterized SQL replaces the planned ORM for this small private application. Weekly random blasts are a future feature supported by the stored question/attempt records, not currently exposed in the UI.
