-- Purpose: publish changes to the ETT tables through Supabase Realtime so open
-- web apps can detect edits made in other tabs or devices.
-- Subscribers only receive changes their RLS select policies allow; the app
-- treats each event as a signal to re-read the day, so no replica identity
-- changes are needed.
-- Executed at (datetime and timezone): Mon Oct 19 02:38:59 UTC 2026

begin;

do $$
declare
  t text;
begin
  foreach t in array array['sessions', 'tasks', 'session_tasks', 'intervals'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ── Track migration ──────────────────────────────────────────────────

insert into public.schema_migrations (version, name)
  values ('20261020000000', 'enable_realtime');

commit;
