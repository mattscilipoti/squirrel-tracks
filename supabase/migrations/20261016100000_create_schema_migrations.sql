-- Purpose: create a schema_migrations table to track which migrations have
-- been applied. Backfill all previously executed migrations. Future migrations
-- INSERT into this table as their final step; the INSERT will fail if this
-- migration has not been run first.
-- Run this once before any new migrations.
-- Executed at (datetime and timezone): Fri 16 Oct 2026 10:34:19 PM EDT

begin;

create table if not exists public.schema_migrations (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now()
);

-- Backfill already-applied migrations.
insert into public.schema_migrations (version, name) values
  ('20261014000000', 'create_ett_tables'),
  ('20261014000001', 'restrict_anon_permissions'),
  ('20261015000000', 'expand_daily_grid'),
  ('20261015000001', 'allow_task_name_updates'),
  ('20261016000000', 'reusable_tasks'),
  ('20261016000001', 'prevent_duplicate_task_names'),
  ('20261016100000', 'create_schema_migrations');

commit;
