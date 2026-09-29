-- =============================================================================
-- OM1227-R — rollback migracji 0193 (czujki poczty i requeue, #1227/#1214). Uruchamiany przez
-- scripts/test-rls.sh po rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji
-- i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(
  (public.ops_metrics() -> 'email') ? 'configBlocked'
  and to_regprocedure('public.requeue_failed_email_deliveries(integer,boolean,text[],text[])') is not null,
  'OM1227-R0 stan przed rollbackiem');

begin;
\ir ../rollback/0193_email_ops_config_requeue.down.sql
select pg_temp.assert(
  not ((public.ops_metrics() -> 'email') ? 'configBlocked')
  and not ((public.ops_metrics() -> 'email') ? 'suppressedLast24h')
  and (public.ops_metrics() -> 'email') ? 'failedLast24h'
  and (public.ops_metrics() ? 'portalLegalMode')
  and to_regprocedure('public.requeue_failed_email_deliveries(integer,boolean,text[],text[])') is null
  and has_function_privilege('pracujbe_ops', 'public.ops_metrics()', 'execute')
  and not has_function_privilege('authenticated', 'public.ops_metrics()', 'execute'),
  'OM1227-R rollback przywraca ops_metrics z 0177 (z grantami) i usuwa requeue');
rollback;
select pg_temp.assert(
  (public.ops_metrics() -> 'email') ? 'configBlocked'
  and to_regprocedure('public.requeue_failed_email_deliveries(integer,boolean,text[],text[])') is not null,
  'OM1227-R2 rollback testu cofnięty');
\echo 'OM1227-R rollback 0193: PASS'
