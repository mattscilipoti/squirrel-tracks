-- Purpose: let signed-in users permanently delete a task (its session_tasks links
-- and intervals cascade), and keep tasks.updated_at current when a task is edited.
-- Run before using "Delete task" in the web app. Existing updated_at values are
-- unchanged until the next edit.
-- Executed at (datetime and timezone): 2026/10/16

begin;

-- ── Allow deleting tasks ─────────────────────────────────────────────

grant delete on table public.tasks to authenticated;

drop policy if exists "ett_auth_tasks_delete" on public.tasks;
create policy "ett_auth_tasks_delete" on public.tasks
  for delete to authenticated using (true);

-- ── Maintain tasks.updated_at ────────────────────────────────────────

create or replace function public.ett_touch_task_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ett_touch_task_updated_at on public.tasks;
create trigger ett_touch_task_updated_at
  before update on public.tasks
  for each row execute function public.ett_touch_task_updated_at();

-- ── Track migration ──────────────────────────────────────────────────

insert into public.schema_migrations (version, name)
  values ('20261019000000', 'delete_tasks_updated_at');

notify pgrst, 'reload schema';

commit;
