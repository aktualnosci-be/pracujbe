-- =============================================================================
-- WP724-R — rollback migracji 0983 (#724). Uruchamiany przez scripts/test-rls.sh po
-- rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

begin;
\ir ../rollback/0983_web_push_subscriptions.down.sql
select pg_temp.assert(to_regclass('public.push_subscriptions') is null
  and to_regclass('public.push_deliveries') is null
  and to_regprocedure('public.register_push_subscription(text, text, text, text)') is null
  and to_regprocedure('public.claim_push_deliveries(integer, integer)') is null
  and not exists (select 1 from pg_trigger where tgname = 'trg_notifications_push_enqueue')
  and not exists (select 1 from public.notification_preferences where push_enabled),
  'WP724-R rollback usuwa rejestr urządzeń, kolejkę, trigger i zeruje push_enabled');
-- Powiadomienie alertu po rollbacku powstaje bez kanału push (trigger nie istnieje).
rollback;
select pg_temp.assert(to_regclass('public.push_subscriptions') is not null
  and exists (select 1 from pg_trigger where tgname = 'trg_notifications_push_enqueue'),
  'WP724-R2 rollback testu cofnięty');
\echo 'WP724-R rollback 0983: PASS'
