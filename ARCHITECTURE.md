# Architecture

Squirrel Tracks is a time-tracking web app based on David Seah's Emergent Task
Timing. The vanilla JS frontend stores state locally and can optionally sync to
Supabase via REST — no framework, no build step, no backend server in the request
path.

## Data flow

```
Browser (vanilla JS)
  → localStorage (immediate, offline-first)
  → authenticated Supabase PostgREST API (when configured and online)
  → PostgreSQL (RLS enforced, authenticated role)
```

Without a valid `js/config.js`, the app remains local-only and does not require
sign-in. The file contains the public Supabase URL and publishable key. When
configured, the key is sent in `apikey`; only the user's access token is sent in
`Authorization: Bearer`. Auth uses Supabase GoTrue REST API (email/password),
stores project-scoped sessions in localStorage, and refreshes tokens before
expiry. If local and cloud state differ on connection, the user chooses whether
to upload, load, merge, or cancel.

## Web frontend (`web-frontend/`)

No build step. Serve with any static HTTP server (`python3 -m http.server 5000`).

| File                      | Purpose                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `index.html`              | Entry point, optional login and sync-conflict dialogs, boot sequence          |
| `js/config.js`            | Public Supabase project URL and publishable key; optional for local-only mode |
| `js/supabase-client.js`   | Custom Supabase REST client + `SupabaseAuth` class                            |
| `js/app-grid.js`          | `GridTaskTracker` — main app: grid, tasks, sync, UI                           |
| `js/time-calculations.js` | Date/time utilities, interval math, activity summaries                        |
| `js/app.js`               | Legacy (unused, predates app-grid.js)                                         |
| `js/api-client.js`        | Legacy Rails API client (unused)                                              |
| `css/style.css`           | All styles — modals, grid, header, responsive breakpoints                     |

### Key classes

- **`SupabaseAuth`** (`supabase-client.js`) — sign-in, sign-up, token refresh,
  session persistence scoped by project URL in localStorage
- **`SupabaseClient`** (`supabase-client.js`) — REST wrapper for PostgREST;
  CRUD for sessions, tasks, intervals, session_tasks; sends publishable key as
  `apikey` and a user JWT as the optional Bearer token
- **`GridTaskTracker`** (`app-grid.js`) — owns all UI state; 96-slot grid
  (24h x 15min); local-first writes to localStorage, auth-gated Supabase sync,
  date navigation, task catalog, reminder timer

### Tests

```bash
node --test web-frontend/js/*.test.cjs
```

Node 18+, no npm dependencies. Covers time calculations, grid logic, session
rollover, reusable task behavior.

## Database (Supabase / PostgreSQL)

### Tables

| Table               | Key columns                                | Notes                                     |
| ------------------- | ------------------------------------------ | ----------------------------------------- |
| `sessions`          | id, status, date, memo, notes              | One per day                               |
| `tasks`             | id, name                                   | Reusable across days (no session FK)      |
| `session_tasks`     | session_id, task_id                        | Junction: which tasks appear on which day |
| `intervals`         | session_id, task_id, interval_index (0-95) | Filled bubbles                            |
| `schema_migrations` | version, name, applied_at                  | Migration tracking                        |

### Views

- `task_totals` — all-time interval count per task
- `task_day_totals` — per-session interval count per task

Both are `security_invoker = true` so RLS applies.

### Auth / RLS

All access requires the `authenticated` role (Supabase email/password sign-in).
Anonymous access is revoked. RLS policies are permissive (`using (true)`) — any
authenticated user sees all rows. Suitable for single-user; add `user_id`
columns for multi-user isolation later.

## Migrations (`supabase/migrations/`)

Applied manually via Supabase SQL editor. Each migration inserts into
`schema_migrations` to track execution. Query applied state with:

```sql
SELECT * FROM schema_migrations ORDER BY version;
```

| Version        | Name                         | Status  |
| -------------- | ---------------------------- | ------- |
| 20261014000000 | create_ett_tables            | applied |
| 20261014000001 | restrict_anon_permissions    | applied |
| 20261015000000 | expand_daily_grid            | applied |
| 20261015000001 | allow_task_name_updates      | applied |
| 20261016000000 | reusable_tasks               | applied |
| 20261016000001 | prevent_duplicate_task_names | applied |
| 20261016100000 | create_schema_migrations     | applied |
| 20261016100001 | auth_rls                     | applied |
| 20261016100002 | revoke_anon_access           | applied |

## Backend (`backend/`)

Rails 7+ API-only app. **Not in the active request path** — the frontend
switched to Supabase directly. Kept for reference. Has RSpec tests, CI via
GitHub Actions (brakeman, bundler-audit, rubocop).

## Other directories

| Path             | Contents                                                  |
| ---------------- | --------------------------------------------------------- |
| `ios-app/`       | Placeholder SwiftUI + Realm iOS app (CocoaPods, Fastlane) |
| `bundle/`        | Packaging artifacts                                       |
| `assets/`        | Static assets                                             |
| `.devcontainer/` | VS Code dev container config                              |

## Conventions

- **No build step** — vanilla JS, vanilla CSS, no npm
- **No SDK** — custom REST client over Supabase PostgREST + GoTrue APIs
- **Local-first** — writes hit localStorage immediately; network sync is async
- **Manual migrations** — paste SQL in Supabase dashboard; self-tracking via `schema_migrations` table
