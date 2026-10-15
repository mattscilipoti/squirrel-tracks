-- Purpose: allow renaming existing tasks without replacing their IDs or bubbles.
-- Grant anon permission to update only the name column, plus an UPDATE RLS policy.
-- Existing demo access remains anonymous and is not isolated per user.
-- Apply after the earlier ETT migrations; no task or interval data is changed.
-- Executed at (datetime and timezone): Thu Oct 15 22:18:10 UTC 2026

begin;

grant update (name) on table public.tasks to anon;

drop policy if exists "ett_tasks_update_name" on public.tasks;
create policy "ett_tasks_update_name" on public.tasks
  for update to anon using (true) with check (true);

commit;
