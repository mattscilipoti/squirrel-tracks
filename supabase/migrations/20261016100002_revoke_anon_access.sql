-- Purpose: revoke anonymous access now that authenticated sign-in is verified.
-- This is step 2 of 2. Only run after confirming sign-in works with the
-- authenticated role (migration 20261016100001).
-- After this, the anon API key alone cannot read or write any ETT data.
-- Executed at (datetime and timezone): 2026/10/16

begin;

-- ── Revoke anon table privileges ────────────────────────────────────

revoke all privileges on table public.sessions from anon;
revoke all privileges on table public.tasks from anon;
revoke all privileges on table public.intervals from anon;
revoke all privileges on table public.session_tasks from anon;

-- ── Revoke anon view privileges ─────────────────────────────────────

revoke select on public.task_totals from anon;
revoke select on public.task_day_totals from anon;

-- ── Drop anon RLS policies ──────────────────────────────────────────

-- Sessions
drop policy if exists "ett_sessions_select" on public.sessions;
drop policy if exists "ett_sessions_insert" on public.sessions;
drop policy if exists "ett_sessions_update" on public.sessions;

-- Tasks
drop policy if exists "ett_tasks_select" on public.tasks;
drop policy if exists "ett_tasks_insert" on public.tasks;
drop policy if exists "ett_tasks_delete" on public.tasks;
drop policy if exists "ett_tasks_update_name" on public.tasks;

-- Intervals
drop policy if exists "ett_intervals_select" on public.intervals;
drop policy if exists "ett_intervals_insert" on public.intervals;
drop policy if exists "ett_intervals_delete" on public.intervals;

-- Session Tasks
drop policy if exists "ett_session_tasks_select" on public.session_tasks;
drop policy if exists "ett_session_tasks_insert" on public.session_tasks;
drop policy if exists "ett_session_tasks_delete" on public.session_tasks;

-- ── Track migration ──────────────────────────────────────────────────

insert into public.schema_migrations (version, name)
  values ('20261016100002', 'revoke_anon_access');

notify pgrst, 'reload schema';

commit;
