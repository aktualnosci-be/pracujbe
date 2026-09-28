-- =============================================================================
-- CA1142-R — rollback migracji 0970 (#1142, #1145). Uruchamiany przez scripts/test-rls.sh
-- po rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

begin;
\ir ../rollback/0970_classifieds_account_notifications.down.sql
select pg_temp.assert(
  to_regprocedure('public.email_recruitment_template(text)') is null
  and to_regprocedure('public.notification_is_recruitment(text, text)') is null
  and to_regprocedure('public.enforce_candidate_profile_update()') is null
  and not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                   where t.tgname like 'trg_aa_recruitment_mode%'
                     and c.relname in ('candidate_profiles', 'candidate_skills', 'candidate_languages',
                                       'candidate_certificates', 'notifications'))
  -- triggery 0171 zostają
  and exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
               where t.tgname = 'trg_aa_recruitment_mode' and c.relname = 'applications')
  and position('recruitment' in pg_get_functiondef('public.ensure_candidate_profile()'::regprocedure)) = 0
  and position('suppressed_feature_disabled' in pg_get_functiondef(
        'public.email_delivery_suppression_reason(uuid, text, text, uuid, text, uuid)'::regprocedure)) = 0,
  'CA1142-R rollback usuwa tylko obiekty 0970 i przywraca definicje z 0040/0124');
rollback;
select pg_temp.assert(to_regprocedure('public.email_recruitment_template(text)') is not null,
  'CA1142-R po cofnięciu transakcji migracja 0970 zostaje');
\echo '=================== 0970 ROLLBACK OK ==================='
