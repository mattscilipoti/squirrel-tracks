-- Purpose: add authenticated-role access alongside existing anon access.
-- This is step 1 of 2 for requiring sign-in. Anon access is left intact
-- so the app continues working while you test authenticated sign-in.
-- Apply after all earlier migrations.
-- Requires: Supabase Auth enabled with at least one sign-up method (email).
-- Executed at (datetime and timezone): Fri 16 Oct 2026 11:15:52 PM EDT

begin;

-- ── Table grants for authenticated ──────────────────────────────────

grant select, insert, update on table public.sessions to authenticated;
grant select, insert on table public.tasks to authenticated;
grant update (name) on table public.tasks to authenticated;
grant select, insert, delete on table public.intervals to authenticated;
grant select, insert, delete on table public.session_tasks to authenticated;

-- ── View grants for authenticated ───────────────────────────────────

grant select on public.task_totals to authenticated;
grant select on public.task_day_totals to authenticated;

-- ── RLS policies for authenticated (coexist with anon policies) ─────

-- Sessions
create policy "ett_auth_sessions_select" on public.sessions
  for select to authenticated using (true);
create policy "ett_auth_sessions_insert" on public.sessions
  for insert to authenticated with check (true);
create policy "ett_auth_sessions_update" on public.sessions
  for update to authenticated using (true) with check (true);

-- Tasks
create policy "ett_auth_tasks_select" on public.tasks
  for select to authenticated using (true);
create policy "ett_auth_tasks_insert" on public.tasks
  for insert to authenticated with check (true);
create policy "ett_auth_tasks_update" on public.tasks
  for update to authenticated using (true) with check (true);

-- Intervals
create policy "ett_auth_intervals_select" on public.intervals
  for select to authenticated using (true);
create policy "ett_auth_intervals_insert" on public.intervals
  for insert to authenticated with check (true);
create policy "ett_auth_intervals_delete" on public.intervals
  for delete to authenticated using (true);

-- Session Tasks
create policy "ett_auth_session_tasks_select" on public.session_tasks
  for select to authenticated using (true);
create policy "ett_auth_session_tasks_insert" on public.session_tasks
  for insert to authenticated with check (true);
create policy "ett_auth_session_tasks_delete" on public.session_tasks
  for delete to authenticated using (true);

-- ── Track migration ──────────────────────────────────────────────────

insert into public.schema_migrations (version, name)
  values ('20261016100001', 'auth_rls');

notify pgrst, 'reload schema';

commit;
