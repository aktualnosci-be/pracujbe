-- =============================================================================
-- CL1128-R — rollback migracji 0171 (#1140, #1143). Uruchamiany przez scripts/test-rls.sh
-- po rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select count(*) as clr_apps from public.applications \gset

begin;
-- 0980 (#1135, #1137) stoi na 0171 — cofana pierwsza (odwrotna kolejność migracji).
\ir ../rollback/0980_classifieds_searchable_screening.down.sql
select pg_temp.assert(not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where t.tgname like 'trg_aa_recruitment_mode%'
       and c.relname in ('candidate_profiles', 'job_screening_questions', 'screening_question_reviews'))
  and position('recruitment_enabled' in pg_get_functiondef('public.set_candidate_searchable(boolean)'::regprocedure)) = 0
  and position('recruitment_' in pg_get_functiondef('public.set_job_screening_questions(uuid, jsonb)'::regprocedure)) = 0
  and position('recruitment_enabled' in pg_get_functiondef('public.get_public_job_screening_questions(uuid)'::regprocedure)) = 0
  and position('recruitment_enabled' in pg_get_functiondef('public.enforce_screening_review()'::regprocedure)) = 0
  and position('recruitment_enabled' in pg_get_functiondef('public.company_can_see_match_candidate(uuid)'::regprocedure)) = 0,
  'CL0980-R rollback 0980 usuwa strażniki i przywraca funkcje sprzed 0980');
\ir ../rollback/0171_portal_legal_mode.down.sql
select pg_temp.assert(to_regprocedure('public.recruitment_enabled()') is null
  and to_regprocedure('public.admin_set_portal_legal_mode(text, text, text)') is null
  and to_regclass('public.portal_legal_mode') is null
  and not exists (select 1 from pg_trigger where tgname like 'trg_aa_recruitment_mode%')
  and not exists (select 1 from pg_policies where policyname like '%_recruitment_mode')
  and position('recruitment_enabled' in pg_get_functiondef('public.is_conversation_member(uuid)'::regprocedure)) = 0
  and position('recruitment_enabled' in pg_get_functiondef('public.company_can_view_candidate(uuid)'::regprocedure)) = 0
  and position('recruitment_enabled' in pg_get_functiondef('public.get_job_match_profile(uuid)'::regprocedure)) = 0
  and not (public.ops_metrics() ? 'portalLegalMode')
  and (select count(*) from public.applications) = :clr_apps,
  'CL1128-R rollback usuwa tylko obiekty 0171 i przywraca helpery sprzed trybu');
rollback;
select pg_temp.assert(to_regprocedure('public.recruitment_enabled()') is not null
  and to_regclass('public.portal_legal_mode') is not null,
  'CL1128-R2 rollback testu cofnięty');
\echo 'CL0980-R + CL1128-R rollback 0980 i 0171: PASS'
