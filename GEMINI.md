# Action Man — Instructions for AI Assistants (Gemini / AI Studio)

> **SUPERSEDED:** the app now lives on Replit — `replit.md` is the current
> authority (same rules, updated architecture). This file is kept for
> history; if the two ever disagree, `replit.md` wins.

Read this before changing ANY code in this repository. Previous sessions have
rewritten working files wholesale and re-introduced bugs that were already
fixed. The rules below exist because each one guards against a real production
bug that has already bitten the owner.

> ⚠️ **THIS HAS ALREADY HAPPENED ONCE.** A previous session ran an unprompted
> "refactor: remove unused code and simplify dependencies" pass (commit
> `59d14ba`) that deleted this file, reverted every fix listed below, and
> added a mount-time "merge local + remote and write everything back" sync
> that resurrected deleted tasks. It all had to be reverted.
>
> Therefore: **NEVER run a cleanup, refactor, simplification, or
> "remove unused code" pass on this repository — not even as a side effect
> of another task.** Code that looks unused or redundant here is load-bearing
> (see Invariants). Only change what the owner's request explicitly requires,
> and never delete this file.

## Prime directives

1. **Never regenerate a file from scratch.** Make the smallest targeted edit
   that accomplishes the request. If you believe a rewrite is required, stop
   and say so instead of doing it.
2. **Never touch `firebase-applet-config.json`**, the OAuth client ID in
   `src/App.tsx`, or `.env.example` unless explicitly asked.
3. **Never hardcode a date anywhere** (see Invariant 1).
4. **Do not "simplify" the sync, ignore-filter, or service-worker logic.**
   What looks redundant is deliberate (see Invariants below).
5. When you change `public/sw.js` or anything about caching, **bump
   `CACHE_NAME`** (v2 → v3 → …) or every installed device keeps the old cache.

## Architecture (30 seconds)

- **Frontend**: single-file React app `src/App.tsx` (Vite, Tailwind).
  PWA shell in `index.html` + `public/sw.js`.
- **Backend**: `server.ts` (Express). Four endpoints:
  `/api/organize-dump` (brain dump → tasks via Gemini),
  `/api/coach-today` (must-do/nice-to-do coaching),
  `/api/triage-emails` (Gmail scan → important-email cards),
  `/api/send-daily-summary` (sends the morning briefing via Gmail API).
- **Data**: Firestore (`src/lib/firebase.ts`) — collections `tasks` and
  `settings` (docs: `north_star`, `email_filters`, `briefing`).
  localStorage is only a cold-start bootstrap/mirror, never the source of truth.
- **Auth**: Google sign-in (Firebase popup / GIS token / redirect) providing a
  ~1h Gmail OAuth access token, cached in sessionStorage **with an expiry**.

## Invariants — do not undo these fixes

1. **Dates are always computed from the real clock.**
   - `src/App.tsx`: `todayDateObj = new Date()`, `todayStr` derived from it.
     (It used to be hardcoded `"2026-07-15"`, which silently broke every
     deadline countdown and all "by Friday" parsing.)
   - `server.ts`: `resolveDateContext()` builds the date/day-of-week/tomorrow
     strings injected into prompts. Never inline a literal date or weekday into
     a prompt.

2. **Email triage identifies emails by array `index`, never by raw Gmail ID.**
   The model reliably echoes a small integer but mangles long opaque IDs.
   `server.ts` sends `{index, from, subject, date, snippet}` to Gemini, then
   maps `index` back to the real message and returns `emailId` = the true
   Gmail ID. Out-of-range indices are dropped; results are deduped. Keep it
   this way.

3. **Ignore/mute filters are atomic and re-applied at render time.**
   - Writes go through `addEmailFilterEntries` / `removeEmailFilterEntries`
     in `src/lib/firebase.ts` using `arrayUnion`/`arrayRemove` with
     `{merge: true}`. Never replace the whole `email_filters` doc from
     component state — concurrent devices clobber each other.
   - `visibleTriagedEmails` in `src/App.tsx` re-filters the fetched triage
     list against the *current* ignore lists on every render. This is what
     makes Ignore instant and cross-device correct; the server-side filter is
     only an optimization. All UI/badges/briefing payloads must use
     `visibleTriagedEmails`, not `triagedEmails`.

4. **Firestore is the source of truth for tasks; snapshots REPLACE state.**
   `subscribeTasks` snapshots replace the local list. Do NOT re-introduce a
   union-merge that re-uploads "local-only" tasks: that resurrected tasks the
   user had deleted on another device. The only exception is the guarded
   one-time migration of pre-existing local tasks into an *empty* remote DB.
   Offline durability comes from `persistentLocalCache` +
   `persistentMultipleTabManager` in `src/lib/firebase.ts`.

5. **No `orderBy` on the tasks query.** Firestore silently drops documents
   missing the ordered field; legacy tasks without `createdAt` vanished.
   Sorting happens client-side.

6. **DB write errors must propagate.** `saveTaskToDb` / `deleteTaskFromDb` /
   `saveNorthStarToDb` rethrow after logging, and callers set
   `dbStatus("error")`. Do not swallow errors — that's how "tasks don't
   persist" went unnoticed while the UI showed "Cloud Live Sync".

7. **Every persisted `Task` field must round-trip.** `saveTaskToDb` and the
   `subscribeTasks` mapper must both include the full field set (including
   `completedAt` and `isForceCritical` — these were once dropped, so the
   "Flag Critical" state never survived a reload). If you add a field to
   `Task` in `src/types.ts`, add it to BOTH places.

8. **`seedInitialTasksIfEmpty` must never write the North Star when the doc
   already exists.** It used to blank the user's North Star on every load.

9. **Gmail triage window and caps** (`server.ts`): query excludes only
   `promotions/social/forums` — do NOT re-add `-from:noreply` or restrict to
   `category:primary` (that excluded exactly the bills/renewals the triage is
   for). Ignored message IDs are filtered *before* the detail-fetch cap so
   muted mail never eats analysis slots. Detail fetches: 8s timeout, one
   retry, dropped messages are logged.

10. **OAuth tokens are stored with expiry** via `storeGoogleToken` /
    `readStoredGoogleToken`. Never restore a token without checking expiry.

11. **Service worker**: navigations are network-first with cache fallback;
    static assets are stale-while-revalidate. Never serve `index.html`
    cache-first — that froze phones on old builds indefinitely.

12. **Morning briefing**: the sent-date and auto-send toggle sync through the
    `settings/briefing` doc so two devices don't both auto-send. The server
    excludes completed tasks from the briefing.

## Known follow-ups (intentionally NOT done — ask the owner first)

- `firestore.rules` is `allow read, write: if true` and collections are
  global (not per-user). Locking this down properly requires per-user
  document paths (`users/{uid}/…`) + rules that check `request.auth`, and a
  data migration. Do not flip the rules to require auth without doing the
  full migration — the background Firebase sign-in is best-effort and writes
  would start failing.
- No OAuth refresh flow: after ~1h the user must sign in again (the app now
  detects expiry and prompts cleanly rather than failing silently).
- The allow-list of emails lives in `src/App.tsx` (`allowedEmails`).

## Build & checks

- `npm run lint` → `tsc --noEmit` (must stay clean)
- `npm run dev` → tsx server with Vite middleware on :3000
- `npm run build && npm start` → production
- Requires `GEMINI_API_KEY` (injected by AI Studio secrets).
