-- Purpose: create the ETT sessions, tasks, and intervals tables, relationships,
-- indexes, and the original 60-slot daily grid (09:00-midnight).
-- Enable row-level security and grant demo read/write access to anon and
-- authenticated roles. These permissive policies do not isolate users' data;
-- anyone with the public anon key can read and change all rows.
-- Apply before the permission-restriction and full-day-grid migrations.
-- Do not re-run after restricting permissions: this reinstates broad demo access.
-- Executed at (datetime and timezone): ________________________________

create table if not exists public.sessions (
  id bigint generated always as identity primary key,
  status text not null default 'active' check (status in ('active', 'completed')),
  start_time text,
  memo text,
  date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.sessions(id) on delete cascade,
  name text not null,
  duration_minutes integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.intervals (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.sessions(id) on delete cascade,
  task_id bigint not null references public.tasks(id) on delete cascade,
  interval_index integer not null check (interval_index >= 0 and interval_index < 60),
  created_at timestamptz not null default now(),
  unique (session_id, interval_index, task_id)
);

create index if not exists idx_sessions_created_at on public.sessions(created_at);
create index if not exists idx_tasks_session_id on public.tasks(session_id);
create index if not exists idx_intervals_session_id on public.intervals(session_id);

alter table public.sessions enable row level security;
alter table public.tasks enable row level security;
alter table public.intervals enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.sessions, public.tasks, public.intervals to anon, authenticated;

-- Temporary for this unauthenticated personal app: anyone with the public anon key
-- can read and change all rows. Replace these policies before using real/private data.
drop policy if exists "ett_demo_sessions_access" on public.sessions;
drop policy if exists "ett_demo_tasks_access" on public.tasks;
drop policy if exists "ett_demo_intervals_access" on public.intervals;

create policy "ett_demo_sessions_access" on public.sessions
  for all to anon, authenticated using (true) with check (true);
create policy "ett_demo_tasks_access" on public.tasks
  for all to anon, authenticated using (true) with check (true);
create policy "ett_demo_intervals_access" on public.intervals
  for all to anon, authenticated using (true) with check (true);
