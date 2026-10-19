# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What's active

The live app is **`web-frontend/`** (vanilla JS, no build step) talking directly to
**Supabase** (PostgREST + GoTrue over plain `fetch`, no SDK). `backend/` (Rails) and
`ios-app/` are legacy/placeholder and not in the request path. Much of README.md's
roadmap and the other top-level `*.md` setup docs predate the Supabase switch;
`ARCHITECTURE.md` is the current source of truth.

## Commands

```bash
npm test                                   # node --test web-frontend/js/*.test.cjs
node --test web-frontend/js/app-grid.test.cjs                  # one file
node --test --test-name-pattern="rename" web-frontend/js/*.test.cjs  # one test by name
npm run lint                               # eslint web-frontend/js
npm run format / npm run format:check      # prettier on web-frontend
web-frontend/start-server.sh               # serve on :5000 (WEBrick via root Gemfile)
```

## Architecture

- Scripts load as classic `<script>` tags in order from `index.html`: the supabase-js
  CDN build (Realtime only), `config.js`, `supabase-client.js`, `realtime-client.js`,
  `remote-changes.js`, `time-calculations.js`, `app-grid.js`. They share top-level
  globals; when adding a cross-file global, also declare it in `eslint.config.mjs`.
- Live updates: `RealtimeWatcher` only signals "something changed"; `app-grid.js`
  re-reads the day and `RemoteChanges.diff` builds the notice. See `ARCHITECTURE.md`.
- `app-grid.js` (`GridTaskTracker`) owns essentially all UI and state: a 96-slot
  (24h × 15 min) bubble grid per day, task catalog, date navigation, reminder bell,
  and sync. `app.js` and `api-client.js` are unused legacy files.
- **Local-first**: every edit writes localStorage immediately (with per-day snapshots);
  Supabase sync is async and auth-gated. Without a valid `js/config.js` the app runs
  local-only with no sign-in.
- Tasks are reusable across days: `tasks` has no session FK; the `session_tasks`
  junction links tasks to days; `intervals` holds filled bubbles (index 0–95). Task
  names are unique case-insensitively after trimming.
- Tests are Node `.test.cjs` files that read the browser scripts with `fs` and run
  them in a `vm` context with hand-built DOM/localStorage fakes (see `fixture()` in
  `app-grid.test.cjs`); no npm runtime deps, no jsdom.

## Database migrations

`supabase/migrations/*.sql` are applied **manually** in the Supabase SQL editor. Each
new migration must end by inserting its row into `public.schema_migrations`, and the
applied-status table in `ARCHITECTURE.md` should be updated. Frontend and schema
changes must ship together — the README warns against running old frontends on new
schemas. RLS currently allows any authenticated user to see all rows (single-user).

## User-facing docs

README.md documents toolbar actions and reminder behavior in detail; update it when
changing user-visible behavior of the grid, Advanced actions, or reminder.

## Working style

- Prefer the minimal change that solves the problem; don't refactor adjacent code unasked.
- Read only the files needed; avoid broad exploratory searches when the location is known.
- Don't spawn subagents unless asked.
- Skip re-verification reads after edits; run tests only when behavior changed.
- Keep replies short: result first, no recaps of what's visible in the diff.

## Style

Prettier: double quotes, semicolons, trailing commas, width 90. ESLint targets
ES2022 scripts (not modules) for browser files.
