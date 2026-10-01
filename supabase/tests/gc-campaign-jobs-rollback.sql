-- =============================================================================
-- GC746-R — rollback migracji 0954 (GC w partiach, oferty kampanii). Uruchamiany przez
-- scripts/test-rls.sh po rls.sql; rollback w transakcji cofanej, baza zostaje po 0954.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(
  to_regprocedure('public.rate_limit_gc(integer, integer)') is not null
  and to_regprocedure('public.processed_webhooks_gc(integer, integer)') is not null
  and to_regprocedure('public.email_campaign_unavailable_slugs(jsonb)') is not null
  and to_regclass('public.idx_rate_limits_updated_at') is not null
  and to_regclass('public.idx_processed_webhooks_terminal_updated') is not null,
  'GC746-R0 baza w stanie po 0954');

begin;
\ir ../rollback/0954_gc_batches_campaign_jobs.down.sql

select pg_temp.assert(
  to_regprocedure('public.rate_limit_gc(integer, integer)') is null
  and to_regprocedure('public.rate_limit_gc(integer)') is not null
  and to_regprocedure('public.processed_webhooks_gc(integer, integer)') is null
  and to_regprocedure('public.processed_webhooks_gc(integer)') is not null
  and position('seen_at' in pg_get_functiondef('public.processed_webhooks_gc(integer)'::regprocedure)) > 0
  and to_regprocedure('public.email_campaign_unavailable_slugs(jsonb)') is null
  and to_regclass('public.idx_rate_limits_updated_at') is null
  and to_regclass('public.idx_processed_webhooks_terminal_updated') is null,
  'GC746-R1 rollback przywraca GC z 0163/0195 i usuwa indeksy oraz funkcję ofert kampanii');
select pg_temp.assert(
  position('unavailable' in pg_get_functiondef('public.admin_create_email_campaign_revision(uuid, text, jsonb)'::regprocedure)) = 0
  and position('unavailable' in pg_get_functiondef('public.admin_activate_email_campaign(uuid, text)'::regprocedure)) = 0
  and position('unavailable' in pg_get_functiondef('public.process_email_campaigns(integer)'::regprocedure)) = 0
  and position('unavailable' in pg_get_functiondef('public.email_delivery_send_check(uuid, uuid)'::regprocedure)) = 0,
  'GC746-R1b edytor, aktywacja, harmonogram i send_check wracają do definicji sprzed 0954');
select pg_temp.assert(
  has_function_privilege('service_role', 'public.processed_webhooks_gc(integer)', 'execute')
  and not has_function_privilege('anon', 'public.rate_limit_gc(integer)', 'execute'),
  'GC746-R1c granty po rollbacku jak w 0163');
rollback;

select pg_temp.assert(
  to_regprocedure('public.rate_limit_gc(integer, integer)') is not null
  and to_regprocedure('public.rate_limit_gc(integer)') is null,
  'GC746-R2 po wycofaniu transakcji baza znów w stanie po 0954');
