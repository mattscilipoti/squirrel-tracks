-- Purpose: replace broad demo access with the operations used by the frontend.
-- Revoke table privileges from public, anon, and authenticated, then allow anon
-- to select/insert/update sessions and select/insert/delete tasks and intervals.
-- Replace legacy all-operation policies with operation-specific anon policies.
-- This limits operations, not row visibility: anonymous users can still access
-- all rows for the permitted operations. It does not provide per-user isolation.
-- Apply after creating the ETT tables. Run once; the new policy names must not
-- already exist when this script creates them.
-- Executed at (datetime and timezone): 2026-10-14

revoke all privileges on table public.sessions, public.tasks, public.intervals
  from public, anon, authenticated;

grant select, insert, update on table public.sessions to anon;
grant select, insert, delete on table public.tasks to anon;
grant select, insert, delete on table public.intervals to anon;

drop policy if exists "ett_demo_sessions_access" on public.sessions;
drop policy if exists "ett_demo_tasks_access" on public.tasks;
drop policy if exists "ett_demo_intervals_access" on public.intervals;
drop policy if exists "allow_all_sessions" on public.sessions;
drop policy if exists "allow_all_tasks" on public.tasks;
drop policy if exists "allow_all_intervals" on public.intervals;

create policy "ett_sessions_select" on public.sessions
  for select to anon using (true);
create policy "ett_sessions_insert" on public.sessions
  for insert to anon with check (true);
create policy "ett_sessions_update" on public.sessions
  for update to anon using (true) with check (true);

create policy "ett_tasks_select" on public.tasks
  for select to anon using (true);
create policy "ett_tasks_insert" on public.tasks
  for insert to anon with check (true);
create policy "ett_tasks_delete" on public.tasks
  for delete to anon using (true);

create policy "ett_intervals_select" on public.intervals
  for select to anon using (true);
create policy "ett_intervals_insert" on public.intervals
  for insert to anon with check (true);
create policy "ett_intervals_delete" on public.intervals
  for delete to anon using (true);
