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
