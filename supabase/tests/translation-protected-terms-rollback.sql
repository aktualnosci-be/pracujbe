-- =============================================================================
-- TP740-R — rollback migracji 0977 (nazwy chronione w kolejce tłumaczeń, #740). Uruchamiany
-- przez scripts/test-rls.sh po rls.sql, na tej samej bazie. Rollback wykonuje się
-- w transakcji i jest cofany, więc baza po teście nadal ma stan po 0977.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

-- Punkt wyjścia: stan po 0977.
select pg_temp.assert(to_regprocedure('public.record_translation_source(text, uuid, text, jsonb, text, integer, text[])') is not null
  and exists (select 1 from information_schema.columns where table_schema = 'public'
               and table_name = 'translation_source_revisions' and column_name = 'protected_terms'),
  'TP740-R0 baza w stanie po 0977');

begin;
\ir ../rollback/0977_translation_protected_terms.down.sql

select pg_temp.assert(
  to_regprocedure('public.record_translation_source(text, uuid, text, jsonb, text, integer, text[])') is null
  and to_regprocedure('public.record_translation_source(text, uuid, text, jsonb, text, integer)') is not null
  and to_regprocedure('public.translation_protected_terms(text[])') is null
  and not exists (select 1 from information_schema.columns where table_schema = 'public'
                   and table_name = 'translation_source_revisions' and column_name = 'protected_terms')
  and not exists (select 1 from information_schema.routines r
                   join information_schema.parameters p on p.specific_name = r.specific_name
                  where r.routine_schema = 'public' and r.routine_name = 'claim_translation_jobs'
                    and p.parameter_name = 'protected_terms')
  and position('recruitment_enabled' in pg_get_functiondef('public.claim_translation_jobs(integer, integer)'::regprocedure)) > 0
  and position('company_name' in pg_get_functiondef('public.sync_job_translation_source(uuid)'::regprocedure)) = 0
  and public.translation_pipeline_version() = 'translation-v1+prompt-v1+glossary-v1'
  and not has_function_privilege('authenticated', 'public.record_translation_source(text, uuid, text, jsonb, text, integer)', 'execute'),
  'TP740-R1 rollback przywraca funkcje sprzed 0977 (claim z 0176, sync i wersja z 0146) i usuwa kolumnę');

-- TP740-R2: po rollbacku zmiana nazwy firmy nie tworzy rewizji (trigger z 0146), a kolejka działa.
update public.companies set name = 'Logistiek Noord Rollback' where id = 'f0740000-0000-0000-0000-0000000000c1';
set constraints all immediate;
select pg_temp.assert((select current_revision_no from public.translation_sources
                        where entity_id = 'f0740000-0000-0000-0000-0000000000a1') = 2,
  'TP740-R2 po rollbacku zmiana nazwy firmy nie synchronizuje ofert');
set local role service_role;
select pg_temp.assert(((public.record_translation_source('job', 'f0740000-0000-0000-0000-0000000000e2'::uuid, 'pl',
    '{"title":"Magazynier"}'::jsonb, 'tr-v1'))->>'status') = 'created',
  'TP740-R3 po rollbacku zapis źródła działa (sygnatura z 0145)');
reset role;
rollback;

select pg_temp.assert(to_regprocedure('public.record_translation_source(text, uuid, text, jsonb, text, integer, text[])') is not null
  and public.translation_pipeline_version() = 'translation-v2+prompt-v1+glossary-v1',
  'TP740-R4 po cofnięciu transakcji baza wraca do stanu po 0977');
