-- ============================================================================
-- Play4Stakes Phase 2 — 0005_cron.sql   (run after 0004)
-- Resolves deadlines server-side every 15s, so no-shows/expiries/timeouts settle
-- even when nobody has a tab open. This is what makes stranded stakes impossible.
--
-- PREREQ: enable the pg_cron extension first —
--   Supabase Dashboard → Database → Extensions → search "pg_cron" → Enable.
-- (Or the create extension line below, if your project allows it from SQL.)
-- ============================================================================

create extension if not exists pg_cron;

-- Remove a prior copy if you re-run this file.
select cron.unschedule('p4s-adjudicate')
  where exists (select 1 from cron.job where jobname = 'p4s-adjudicate');

-- pg_cron 1.5+ (Supabase) supports sub-minute interval syntax.
select cron.schedule('p4s-adjudicate', '15 seconds', 'select adjudicate_all()');

-- Verify:  select * from cron.job;
-- History: select * from cron.job_run_details order by start_time desc limit 20;
