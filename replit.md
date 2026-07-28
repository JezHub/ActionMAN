# Action Man — Instructions for AI Assistants (Replit Agent & others)

Read this before changing ANY code in this repository. AI assistants have
previously rewritten working files wholesale and re-introduced bugs that were
already fixed. Every rule below guards against a real production bug that has
already bitten the owner.

> ⚠️ **THIS HAS ALREADY HAPPENED.** On a previous platform, an AI session ran
> an unprompted "refactor: remove unused code and simplify dependencies" pass
> that deleted the guardrail file, reverted an entire bug-fix release, and
> added a mount-time "merge local + remote and write everything back" sync
> that resurrected deleted tasks. It all had to be reverted commit by commit.
>
> Therefore: **NEVER run a cleanup, refactor, simplification, or
> "remove unused code" pass on this repository — not even as a side effect of
> another task.** Code that looks unused or redundant here is load-bearing
> (see Invariants). Only change what the owner's request explicitly requires,
> and never delete this file.

## Prime directives

1. **Never regenerate a file from scratch.** Make the smallest targeted edit
   that accomplishes the request. If you believe a rewrite is required, stop
   and say so instead of doing it.
2. **Never hardcode a date anywhere** (see Invariant 1).
3. **Do not "simplify" the sync, ignore-filter, or service-worker logic.**
4. When you change `public/sw.js` or anything about caching, **bump
   `CACHE_NAME`** (v2 → v3 → …) or every installed device keeps the old cache.
5. Keep `npm run lint` (tsc --noEmit) clean.

## Architecture (30 seconds)

- **Frontend**: single-file React app `src/App.tsx` (Vite, Tailwind). PWA
  shell in `index.html` + `public/sw.js`.
- **Backend**: `server.ts` (Express) + `server/` modules:
  - `server/storage.ts` — PostgreSQL (Replit database via `DATABASE_URL`)
    with a JSON-file fallback for dev. Tables `tasks` and `settings`, JSONB
    payloads, rows keyed by `user_email`.
  - `server/auth.ts` — `requireUser` middleware: verifies the Google OAuth
    access token against `oauth2/v3/userinfo` (5-min TTL cache) and enforces
    the `ALLOWED_EMAILS` allowlist. This is the security boundary; the
    client-side allowlist check is UX only.
  - `server/dataRoutes.ts` — `/api/data/*` JSON API (state, task upsert/
    delete/bulk, settings, atomic email-filter add/remove, clear).
  - AI routes: `/api/organize-dump`, `/api/coach-today` (both auth-required),
    `/api/triage-emails`, `/api/send-daily-summary` (Gmail REST with the
    user's bearer token). Gemini via `GEMINI_API_KEY`.
- **Client data layer**: `src/lib/api.ts` — one shared polling loop (~20s
  while visible, refresh on focus and after every write) feeding the
  `subscribe*` callbacks; all mutations rethrow on failure.
- **Auth**: single Google Identity Services token-client sign-in
  (`handleGISLogin` in App.tsx). Tokens cached in sessionStorage with a
  55-minute expiry; 401 anywhere → clean re-auth prompt.

## Invariants — do not undo these fixes

1. **Dates are always computed from the real clock.** `todayDateObj = new
   Date()` in App.tsx; `resolveDateContext()` in server.ts builds all prompt
   date context. Never inline a literal date or weekday into a prompt.
2. **Email triage identifies emails by array `index`, never by raw Gmail
   ID.** Models mangle long opaque IDs; the server maps `index` back to the
   real message and returns `emailId` = the true Gmail ID.
3. **Ignore/mute filters are atomic and re-applied at render time.** Writes
   go through `/api/data/email-filters` (transactional read-modify-write on
   the server; `addEmailFilterEntries`/`removeEmailFilterEntries` client
   helpers). `visibleTriagedEmails` in App.tsx re-filters the fetched triage
   list against the CURRENT ignore lists on every render — all UI/badges/
   briefing payloads must use it, never raw `triagedEmails`.
4. **Server state REPLACES local state; never union-merge.** The old
   union-merge re-uploaded stale localStorage copies and resurrected deleted
   tasks. The only exception is the guarded one-time migration
   (`bulkUploadTasks` with the server-side `onlyIfEmpty` check) when the
   remote DB is empty and `has_synced_with_pg` has never been set.
5. **Write/poll race rule** (`src/lib/api.ts`): poll responses that started
   before the newest completed mutation, or while writes are in flight, are
   DROPPED; every mutation triggers a fresh poll on settle. The UI must never
   see a snapshot older than its own last write.
6. **DB write errors must propagate.** Mutation helpers rethrow; callers set
   `dbStatus("error")`. Never swallow errors — silent failure is how "tasks
   don't persist" went unnoticed for weeks.
7. **Every persisted `Task` field must round-trip.** Task upserts send the
   whole object; if you add a field to `Task` in `src/types.ts` it flows
   through automatically — do not introduce field-by-field mapping.
8. **Never blank the North Star.** Seed writes use `?ifAbsent=1`; the
   "Re-Sync" button only CONFIRMS the write queue (`flushPendingWrites`) —
   it must never batch-write local copies back to the server.
9. **Gmail triage window and caps** (server.ts): the query excludes only
   `promotions/social/forums` — do NOT re-add `-from:noreply` or restrict to
   `category:primary` (that excluded exactly the bills/renewals the triage
   exists to surface). Ignored message IDs are filtered BEFORE the
   detail-fetch cap; detail fetches get an 8s timeout and one retry.
10. **OAuth tokens are stored with expiry** via `storeGoogleToken` /
    `readStoredGoogleToken`. Never restore a token without checking expiry.
11. **Service worker**: navigations are network-first with cache fallback;
    static assets are stale-while-revalidate. Never serve `index.html`
    cache-first — that froze phones on old builds indefinitely.
12. **Morning briefing**: the sent-date and auto-send toggle sync through the
    `briefing` settings row so two devices don't both auto-send; the server
    excludes completed tasks from the briefing.

## Accepted trade-offs (do not "fix" these)

- No offline write queue (Firestore's persistence is gone): offline writes
  fail visibly with the red DB status; the localStorage mirror keeps data
  visible locally and polling re-syncs when back online.
- Autoscale cold starts after idle: the client already shows a "server is
  starting up" message and refetches on tab focus.
- `server.log` is per-instance/ephemeral on Autoscale; use Replit deployment
  logs for production.

## Background agents (The Fonz layer)

Scheduled Claude Routines act as the app's background intelligence (morning
brief, weekly review, weekend scout, habit nudge) — prompts and setup live in
`agents/ROUTINES.md`. Contract:

- Agents authenticate with the `AGENT_API_TOKEN` secret (≥32 chars, compared
  constant-time in `server/auth.ts`) and act as `AGENT_ACTS_AS_EMAIL` (default:
  first allowlisted email). Never weaken this to a shorter token or a
  non-constant-time comparison.
- Agents write `POST /api/data/agent-reports` ({kind, title, content,
  reportDate?, data.suggestedTasks?}); the dashboard shows the latest UNREAD
  report per kind and lets Jeremy add suggested tasks with one tap. Reports
  are pruned to the newest 30 per kind on insert.
- Agents PROPOSE, Jeremy disposes: prompts must keep Gmail strictly read-only
  (no send/archive/label/delete) and never mutate the calendar. Suggested
  tasks go in `data.suggestedTasks`, not directly into the tasks table,
  unless a prompt explicitly says otherwise.

## Environment

- `GEMINI_API_KEY` (Secrets), `DATABASE_URL` (attach Replit PostgreSQL),
  optional `ALLOWED_EMAILS`, `APP_URL`, `AGENT_API_TOKEN` +
  `AGENT_ACTS_AS_EMAIL` (background-agent auth, see agents/ROUTINES.md). `DEV_AUTH_BYPASS_EMAIL` is
  development-only and ignored in production — never set it on a deployment.
- `npm run dev` (workspace), `npm run build` + `npm run start` (deployment).

## Carrying data over from the old app (one-time)

Two paths, in order of preference:

1. **Firestore script** — `npx tsx scripts/migrate-firestore.ts` in the Replit
   shell. Caveat: probing showed the committed Firebase project has NO
   Firestore database, so this only works if the real injected config is
   recovered first (see the script header for `FIRESTORE_PROJECT_ID` /
   `FIRESTORE_DB_ID` env overrides).
2. **localStorage hand-off** (works regardless — the browser mirror is a full
   copy of the task list; if Firestore never worked, it is the ONLY copy):
   1. Open the OLD app in the browser that has the tasks → devtools console →
      run: `copy(localStorage.getItem("brain_dump_tasks"))` (now on clipboard).
   2. Open the NEW Replit app, sign in, devtools console → run:
      `localStorage.setItem("brain_dump_tasks", <paste the copied string>)`
   3. Reload the page. The app detects local tasks + an empty server DB and
      bulk-uploads them automatically (`bulkUploadTasks`, race-safe).
   Optionally repeat for `brain_dump_north_star`, `ignored_senders`,
   `ignored_domains`, `ignored_emails`.
