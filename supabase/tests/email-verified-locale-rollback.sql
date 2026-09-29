-- =============================================================================
-- EMQ1038-R — rollback migracji 0962 (#1038, #1049). Uruchamiany przez scripts/test-rls.sh
-- po rls.sql, na tej samej bazie (dane EMQ1038 z rls.sql: EQ2 = zgoda marketingowa,
-- adres niepotwierdzony). Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on
\set EQ2 'e1038000-0000-0000-0000-0000000000a2'

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

-- Stan przed rollbackiem: niepotwierdzony adres nie dostaje marketingu.
select pg_temp.assert(public.email_allowed(:'EQ2', 'newsletter') is false
  and to_regprocedure('public.set_my_email_locale(text)') is not null,
  'EMQ1038-R0 stan wyjściowy: migracja 0962 zastosowana');

begin;
\ir ../rollback/0962_email_verified_marketing_locale.down.sql
select pg_temp.assert(
  to_regprocedure('public.set_my_email_locale(text)') is null
  and to_regprocedure('public.email_address_verified(uuid)') is null
  and position('email_address_verified' in pg_get_functiondef('public.email_allowed(uuid, text)'::regprocedure)) = 0
  and position('unverified' in pg_get_functiondef(
        'public.email_delivery_suppression_reason(uuid, text, text, uuid, text, uuid)'::regprocedure)) = 0
  and position('suppressed_recruitment_disabled' in pg_get_functiondef(
        'public.email_delivery_suppression_reason(uuid, text, text, uuid, text, uuid)'::regprocedure)) > 0
  and position('unverified' in pg_get_functiondef('public.enqueue_campaign_batch(uuid, integer)'::regprocedure)) = 0
  and position('unverified' in pg_get_constraintdef((select oid from pg_constraint
        where conname = 'email_campaign_recipients_reason'))) = 0,
  'EMQ1038-R rollback przywraca stan sprzed 0962 (0087/0101/0175)');
-- Po rollbacku sama zgoda znów wystarcza (dowód, że test wyżej odróżnia stany).
select pg_temp.assert(public.email_allowed(:'EQ2', 'newsletter') is true,
  'EMQ1038-R2 po rollbacku niepotwierdzony adres ze zgodą jest dozwolony (stan z 0087)');
rollback;
select pg_temp.assert(to_regprocedure('public.set_my_email_locale(text)') is not null
  and public.email_allowed(:'EQ2', 'newsletter') is false,
  'EMQ1038-R3 rollback testu cofnięty');
\echo 'EMQ1038-R rollback 0962: PASS'
