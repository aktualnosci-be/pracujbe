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
-- Migracje zależne od 0171 wycofujemy najpierw (odwrotna kolejność numerów: 0190 → 0177 → 0176 → 0175 → 0174 → 0173 → 0171).
-- 0190 (#740) nadpisuje claim_translation_jobs z 0176 (nowa kolumna wyniku) — cofana przed 0176.
\ir ../rollback/0190_translation_protected_terms.down.sql
-- 0177 (usunięcie schematu billingu) stoi na 0171 (ops_metrics) — cofana po 0190.
\ir ../rollback/0177_drop_dead_billing_schema.down.sql
-- 0176 (#1152, #1153) stoi na 0175 — cofana jako pierwsza.
\ir ../rollback/0176_classifieds_ai_billing.down.sql
select pg_temp.assert(not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where t.tgname like 'trg_aa_recruitment_mode%' and c.relname like 'translation\_%')
  and to_regprocedure('public.enforce_translation_entity_mode()') is null
  and position('recruitment_enabled' in pg_get_functiondef('public.claim_translation_jobs(integer, integer)'::regprocedure)) = 0
  and position('candidate_profile_translation' in pg_get_functiondef('public.ai_budget_reserve(text, text, bigint)'::regprocedure)) = 0
  and not exists (select 1 from pg_constraint where conname = 'plan_entitlements_no_candidate_access'),
  'CL0176-R rollback 0176 usuwa strażnik kolejki tłumaczeń, CHECK planów i przywraca funkcje sprzed 0176');
-- CLAIB-4 (kontrola ujemna): definicje sprzed 0176 przyjmują profil kandydata i wydają jego zadania
-- w trybie ogłoszeniowym (w rls.sql: CLAIB-1..3 — z 0176 odrzucone/pominięte). Tryb przełączany
-- w tej samej transakcji, więc cofa go końcowy rollback.
set local role service_role;
select public.admin_set_portal_legal_mode('CLASSIFIEDS_ONLY', 'rollback test CLAIB-4', 'RECRUITMENT');
select pg_temp.assert(((public.record_translation_source('candidate_profile', 'c1a10176-0000-0000-0000-0000000000e1'::uuid, 'pl',
    '{"title":"Magazynier","description":"Szukam pracy."}'::jsonb, 'tr-v1'))->>'status') = 'created',
  'CLAIB-4 kontrola ujemna: bez 0176 profil kandydata trafia do kolejki w trybie ogłoszeniowym');
-- Claim bierze najwyżej 100 zadań wg next_attempt_at: zadania z wcześniejszych sekcji (oferty) odsuwamy
-- w tej cofanej transakcji, żeby kontrola nie zależała od liczby ofert w rls.sql.
reset role;
update public.translation_jobs set next_attempt_at = now() + interval '1 day'
 where entity_type <> 'candidate_profile' and status in ('queued', 'retry');
set local role service_role;
select pg_temp.assert(exists (select 1 from public.claim_translation_jobs(100, 300) where entity_type = 'candidate_profile'),
  'CLAIB-4b kontrola ujemna: bez 0176 claim wydaje zadania profilu');
select public.admin_set_portal_legal_mode('RECRUITMENT', 'rollback test CLAIB-4: powrót', 'CLASSIFIEDS_ONLY');
reset role;
-- 0175 (#1142/#1145) korzysta z helperów 0171 i stoi na 0174.
\ir ../rollback/0175_classifieds_account_notifications.down.sql
\ir ../rollback/0174_classifieds_messaging_cv_off.down.sql
-- 0173 (#1135, #1137) stoi na 0171 — cofana po 0174.
\ir ../rollback/0173_classifieds_searchable_screening.down.sql
select pg_temp.assert(not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where t.tgname like 'trg_aa_recruitment_mode%'
       and c.relname in ('candidate_profiles', 'job_screening_questions', 'screening_question_reviews'))
  and position('recruitment_enabled' in pg_get_functiondef('public.set_candidate_searchable(boolean)'::regprocedure)) = 0
  and position('recruitment_' in pg_get_functiondef('public.set_job_screening_questions(uuid, jsonb)'::regprocedure)) = 0
  and position('recruitment_enabled' in pg_get_functiondef('public.get_public_job_screening_questions(uuid)'::regprocedure)) = 0
  and position('recruitment_enabled' in pg_get_functiondef('public.enforce_screening_review()'::regprocedure)) = 0
  and position('recruitment_enabled' in pg_get_functiondef('public.company_can_see_match_candidate(uuid)'::regprocedure)) = 0,
  'CL0173-R rollback 0173 usuwa strażniki i przywraca funkcje sprzed 0173');
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
\echo 'CL0173-R + CL1128-R rollback 0173 i 0171: PASS'
