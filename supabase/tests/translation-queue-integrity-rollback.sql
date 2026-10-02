-- =============================================================================
-- TQ952-R — rollback migracji 0223 (integralność kolejki tłumaczeń, #644/#754/#755).
-- Uruchamiany przez scripts/test-rls.sh po rls.sql, na tej samej bazie. Rollback wykonuje się
-- w transakcji i jest cofany, więc baza po teście nadal ma stan po 0223.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(to_regprocedure('public.translation_entity_exists(text, uuid)') is not null
  and position('lease_expires_at <= clock_timestamp()' in pg_get_functiondef('public.complete_translation_job(uuid, uuid, jsonb, text, integer, integer)'::regprocedure)) > 0,
  'TQ952-R0 baza w stanie po 0223');

begin;
\ir ../rollback/0223_translation_queue_integrity.down.sql

select pg_temp.assert(
  to_regprocedure('public.translation_entity_exists(text, uuid)') is null
  and position('clock_timestamp()' in pg_get_functiondef('public.complete_translation_job(uuid, uuid, jsonb, text, integer, integer)'::regprocedure)) = 0
  and position('clock_timestamp()' in pg_get_functiondef('public.fail_translation_job(uuid, uuid, text, boolean, integer)'::regprocedure)) = 0
  and position('clock_timestamp()' in pg_get_functiondef('public.defer_translation_job(uuid, uuid, text, integer)'::regprocedure)) = 0
  and position('translation_entity' in pg_get_functiondef('public.record_translation_source(text, uuid, text, jsonb, text, integer, text[])'::regprocedure)) = 0
  and position('protected_terms' in pg_get_functiondef('public.record_translation_source(text, uuid, text, jsonb, text, integer, text[])'::regprocedure)) > 0
  and position('author' in pg_get_functiondef('public.save_manual_translation(text, uuid, text, jsonb, uuid)'::regprocedure)) > 0
  and position('VALIDATION_FAILED: author' in pg_get_functiondef('public.save_manual_translation(text, uuid, text, jsonb, uuid)'::regprocedure)) = 0
  and not has_function_privilege('authenticated', 'public.record_translation_source(text, uuid, text, jsonb, text, integer, text[])', 'execute')
  and has_function_privilege('service_role', 'public.complete_translation_job(uuid, uuid, jsonb, text, integer, integer)', 'execute'),
  'TQ952-R1 rollback przywraca definicje z 0190/0145 i usuwa helper');

set local role service_role;
select pg_temp.assert(((public.record_translation_source('job', 'f0223000-0000-0000-0000-0000000000fe'::uuid, 'pl',
    '{"title":"Magazynier"}'::jsonb, 'tr-v1'))->>'status') = 'created',
  'TQ952-R2 po rollbacku zapis źródła działa (bez kontroli encji)');
reset role;
rollback;

select pg_temp.assert(to_regprocedure('public.translation_entity_exists(text, uuid)') is not null
  and not exists (select 1 from public.translation_sources where entity_id = 'f0223000-0000-0000-0000-0000000000fe'),
  'TQ952-R3 po cofnięciu transakcji baza wraca do stanu po 0223');
