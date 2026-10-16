-- Purpose: reuse a stable task ID across days and report all-days task time.
-- Preserve every existing task ID, name, day association, and recorded bubble.
-- Equal task names remain distinct; duplicate management is not performed here.
-- Removing a session_tasks link removes only that day's bubbles, not the task.
-- Apply after all earlier migrations with app tabs closed, then reload the app.
-- Existing anonymous access remains shared and is not isolated per user.
-- Executed at (datetime and timezone): Fri Oct 16 04:46:44 UTC 2026

begin;

create table public.session_tasks (
  session_id bigint not null references public.sessions(id) on delete cascade,
  task_id bigint not null references public.tasks(id) on delete cascade,
  primary key (session_id, task_id)
);

insert into public.session_tasks (session_id, task_id)
select session_id, id from public.tasks
union
select session_id, task_id from public.intervals;

alter table public.intervals add constraint intervals_session_task_fkey
  foreign key (session_id, task_id)
  references public.session_tasks(session_id, task_id) on delete cascade;

alter table public.tasks drop column session_id;

create index idx_session_tasks_task_id on public.session_tasks(task_id);
create index idx_intervals_task_id on public.intervals(task_id);

alter table public.session_tasks enable row level security;
grant select, insert, delete on public.session_tasks to anon;
create policy ett_session_tasks_select on public.session_tasks
  for select to anon using (true);
create policy ett_session_tasks_insert on public.session_tasks
  for insert to anon with check (true);
create policy ett_session_tasks_delete on public.session_tasks
  for delete to anon using (true);

revoke delete on public.tasks from anon;

create view public.task_totals with (security_invoker = true) as
select tasks.id, tasks.name, count(intervals.id)::bigint as interval_count
from public.tasks
left join public.intervals on intervals.task_id = tasks.id
group by tasks.id, tasks.name;

grant select on public.task_totals to anon;

create view public.task_day_totals with (security_invoker = true) as
select session_tasks.session_id, session_tasks.task_id,
  count(intervals.id)::bigint as interval_count
from public.session_tasks
left join public.intervals on intervals.session_id = session_tasks.session_id
  and intervals.task_id = session_tasks.task_id
group by session_tasks.session_id, session_tasks.task_id;

grant select on public.task_day_totals to anon;

notify pgrst, 'reload schema';

commit;
