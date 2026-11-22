-- One-off export of everything the app stores, for the "Import" button in Advanced.
-- Run in the Supabase SQL editor, copy the single result cell, and save it as a
-- .json file (e.g. squirrel-export.json). Read-only: it changes nothing.
--
-- Output: [{ "date", "memo", "notes", "start_time",
--            "tasks": [{ "name", "intervals": [slot, ...] }] }, ...]

select coalesce(jsonb_agg(day order by day->>'date'), '[]'::jsonb) as export
from (
  select jsonb_build_object(
    'date', s.date,
    'memo', s.memo,
    'notes', s.notes,
    'start_time', s.start_time,
    'tasks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', t.name,
          'intervals', coalesce((
            select jsonb_agg(i.interval_index order by i.interval_index)
            from public.intervals i
            where i.session_id = s.id and i.task_id = t.id
          ), '[]'::jsonb)
        )
        order by t.id
      )
      from public.session_tasks st
      join public.tasks t on t.id = st.task_id
      where st.session_id = s.id
    ), '[]'::jsonb)
  ) as day
  from public.sessions s
  where s.date is not null
) days;

-- To see how much data there is first, run:
-- select (select count(*) from public.sessions) as days,
--        (select count(*) from public.tasks)    as tasks,
--        (select count(*) from public.intervals) as filled_bubbles;
