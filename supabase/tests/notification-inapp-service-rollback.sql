-- =============================================================================
-- NT1120-R — rollback migracji 0221 (#1120). Uruchamiany przez scripts/test-rls.sh po rls.sql,
-- na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

begin;
\ir ../rollback/0221_notification_inapp_service_messages.down.sql
select pg_temp.assert(
  to_regprocedure('public.notification_inapp_required(text, jsonb)') is null
  and to_regprocedure('public.filter_notification_by_preference()') is not null
  and exists (select 1 from pg_trigger where tgname = 'trg_filter_notification_by_preference'
               and tgrelid = 'public.notifications'::regclass and not tgisinternal),
  'NT1120-R rollback usuwa tylko wyjątek 0221 (filtr preferencji i trigger zostają)');
rollback;

select pg_temp.assert(
  to_regprocedure('public.notification_inapp_required(text, jsonb)') is not null,
  'NT1120-R po cofnięciu transakcji 0221 nadal obowiązuje');
\echo 'NT1120-R rollback 0221 OK'
