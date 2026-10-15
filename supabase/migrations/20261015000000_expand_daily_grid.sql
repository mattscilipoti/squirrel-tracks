-- Purpose: expand the daily grid from 60 slots (09:00-midnight) to
-- 96 slots (midnight-midnight), with each slot representing 15 minutes.
-- Shift existing interval indices by 36 to preserve each bubble's clock time
-- and task association; for example, 09:00 moves from index 0 to index 36.
-- Temporarily remove and restore uniqueness to avoid collisions during the shift.
-- All changes run in one transaction. Run only once, with app tabs closed;
-- reload the app afterward. Re-running would shift the saved times again.
-- Executed at (datetime and timezone): Thu Oct 15 19:10:29 UTC 2026

begin;

alter table public.intervals drop constraint intervals_interval_index_check;
alter table public.intervals add constraint intervals_interval_index_check
  check (interval_index >= 0 and interval_index < 96);

alter table public.intervals drop constraint intervals_session_id_interval_index_task_id_key;
update public.intervals set interval_index = interval_index + 36;
alter table public.intervals add constraint intervals_session_id_interval_index_task_id_key
  unique (session_id, interval_index, task_id);

commit;
