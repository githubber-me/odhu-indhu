# Odhu Indhu

Varun’s private SSC CGL companion. Next.js on Vercel, PostgreSQL persistence, passphrase authentication, immutable study entries, IST streaks, and topic quizzes with delayed access.

## One-time setup

1. Create a Neon Postgres database, either in the [Neon console](https://console.neon.tech) or Vercel → Storage → Create Database → Neon. Pick a region close to the Vercel application region. Copy the pooled connection string with its SSL parameters into `.env.local` as `DATABASE_URL`. Keep the credentials private; do not paste them into chat.
2. Run `npm run auth:setup` in your terminal. Choose a passphrase of at least 12 characters. The command hides input and prints a bcrypt hash, `AUTH_SECRET`, and `CRON_SECRET`. Follow its separate instructions for `.env.local` versus Vercel: Next.js dotenv expands dollar signs, so the local bcrypt hash must escape them. The passphrase itself is never saved.
3. Keep `SARVAM_API_KEY` and `PARALLEL_API_KEY` in `.env.local`. `SARVAM_MODEL` defaults to `sarvam-105b` on the standard v1 endpoint, which passed a live JSON check with the configured key. GLM-5.2 on v2 was rejected because this key lacks beta access; set `SARVAM_MODEL=glm5.2` only after enabling that access. No provider credentials are sent to the client.
4. Run `npm run db:migrate`. This creates the application tables and the database rule preventing edits to sealed entries. Running it again is safe. Use a dedicated application database.
5. Run `npm run dev` and open [localhost:3000](http://localhost:3000). Sign in with your passphrase.

The app stays closed if the database URL, valid password hash, or signing secret is absent. It does not fall back to browser storage or an unauthenticated mode. Earlier browser entries are left untouched, and Settings can download them as JSON; they are not silently imported as backdated streak credit.

## Vercel deployment

Import this repository into Vercel as a Next.js project. Set `DATABASE_URL`, `APP_PASSWORD_HASH`, `AUTH_SECRET`, `CRON_SECRET`, `SARVAM_API_KEY`, `PARALLEL_API_KEY`, and optionally `SARVAM_MODEL` in the project's environment settings, then deploy. Set the production runtime region near the database. Use a separate database for previews.

`vercel.json` includes a daily recovery sweep compatible with Hobby. Submission and the authenticated app also trigger background processing. Each worker invocation handles one topic with a database lease; additional topics progress while the app is open or through the recovery sweep. With many topics and the browser closed, preparation can take longer than the unlock date. For guaranteed high-volume readiness, use a more frequent authenticated cron on Vercel Pro or a durable queue before opening public registration. The unlock date itself never depends on cron timing.

## Implemented behavior

- Durations are validated server-side; the server assigns the IST study date.
- Multiple sessions totaling 60 minutes qualify a day. Streaks do not depend on AI success.
- Sessions are idempotent and immutable in PostgreSQL.
- Login uses bcrypt, opaque HTTP-only sessions persisted as HMAC hashes, server-side expiration/revocation, and shared database rate limits.
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

Current connection status: Sarvam standard JSON output and Parallel search passed small live checks without exposing keys. `DATABASE_URL`, `APP_PASSWORD_HASH`, and `AUTH_SECRET` were absent. Live login/database and complete question generation must be smoke-tested after setup. No cloud database was provisioned or application deployed by this change. Recheck providers with `node scripts/check-providers.mjs` (two small billable requests).

## Implementation map

- `lib/domain.ts`: dates, streaks, validation, answer projection, CSV serialization.
- `lib/db.ts`, `db/001_initial.sql`: database connection and repeatable migration.
- `lib/auth.ts`: cookie sessions, revocation, origin and rate-limit checks.
- `lib/pipeline.ts`: bounded topic generation and critique with persistent retries.
- `app/api/[...path]/route.ts`: protected API and export endpoints.
- `app/page.tsx`: ledger, login, history, quiz and review screens.

The earlier `docs/IMPLEMENTATION_PLAN.md` is design history. This README and the implemented code describe the current architecture; direct parameterized SQL replaces the planned ORM for this small private application. Weekly random blasts are a future feature supported by the stored question/attempt records, not currently exposed in the UI.
