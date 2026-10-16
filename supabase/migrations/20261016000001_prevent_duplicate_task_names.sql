-- Purpose: prevent new reusable tasks with duplicate names without merging
-- any duplicate rows that already exist; duplicate cleanup remains an admin task.
-- Names are compared case-insensitively after trimming surrounding whitespace.
-- Users should select an existing task to reuse it across another day.
-- Apply after 20261016000000_reusable_tasks.sql.
-- Executed at (datetime and timezone): Fri Oct 16 04:47:47 UTC 2026

begin;

create or replace function public.reject_duplicate_task_names()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  if new.name = '' then
    raise exception 'Task name cannot be empty.' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(lower(new.name), 0));
  if exists (
    select 1 from public.tasks
    where lower(btrim(name)) = lower(new.name)
      and id is distinct from new.id
  ) then
    raise exception 'Task name already exists; reuse the existing task instead.'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists ett_reject_duplicate_task_names on public.tasks;
create trigger ett_reject_duplicate_task_names
  before insert or update of name on public.tasks
  for each row execute function public.reject_duplicate_task_names();

commit;
