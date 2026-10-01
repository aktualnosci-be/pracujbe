-- =============================================================================
-- EW788-R — rollback migracji 0195 (#788/#790). Uruchamiany przez scripts/test-rls.sh po
-- rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

begin;
\ir ../rollback/0195_email_webhook_pending_events.down.sql
select pg_temp.assert(to_regclass('public.email_pending_events') is null
  and to_regprocedure('public.release_webhook(text)') is null
  and to_regprocedure('public.apply_pending_email_events()') is null
  and to_regprocedure('public.record_email_event(text, text, text, timestamptz, text, text)') is not null
  and pg_get_functiondef('public.record_email_event(text, text, text, timestamptz, text, text)'::regprocedure)
      not like '%email_pending_events%',
  'EW788-R rollback usuwa kolejkę i przywraca record_email_event z 0098');
rollback;
select pg_temp.assert(to_regclass('public.email_pending_events') is not null,
  'EW788-R2 rollback testu cofnięty');
\echo 'EW788-R rollback 0195: PASS'
