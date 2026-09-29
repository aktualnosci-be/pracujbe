-- =============================================================================
-- DC1070-R — rollback migracji 0184 (#1070, #1065). Uruchamiany przez scripts/test-rls.sh
-- po rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany,
-- więc baza po teście ma nadal schemat 0184.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(to_regprocedure('public.save_job_draft(uuid, jsonb, timestamptz)') is not null
  and to_regprocedure('public.ops_schema_state()') is not null
  and to_regprocedure('public.save_job_draft(uuid, jsonb)') is null,
  'DC1070-R0 przed rollbackiem: jedna trójargumentowa save_job_draft i ops_schema_state');

begin;
\ir ../rollback/0184_job_draft_cas_schema_state.down.sql
select pg_temp.assert(to_regprocedure('public.ops_schema_state()') is null
  and to_regprocedure('public.save_job_draft(uuid, jsonb, timestamptz)') is null
  and to_regprocedure('public.save_job_draft(uuid, jsonb)') is not null
  and pg_get_function_result('public.save_job_draft(uuid, jsonb)'::regprocedure) = 'void'
  and has_function_privilege('authenticated', 'public.save_job_draft(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.save_job_draft(uuid, jsonb)', 'execute'),
  'DC1070-R rollback przywraca dwuargumentową save_job_draft (void) i usuwa ops_schema_state');
-- Kontrola ujemna: po rollbacku zapis ze starą wersją nie ma już jak zostać wykryty
-- (funkcja nie przyjmuje tokenu, więc wywołanie z tokenem nie istnieje).
select pg_temp.assert(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_job_draft'
     and 'p_expected_updated_at' = any(p.proargnames)),
  'DC1070-R2 po rollbacku brak parametru p_expected_updated_at (kontrola ujemna)');
rollback;
select pg_temp.assert(to_regprocedure('public.save_job_draft(uuid, jsonb, timestamptz)') is not null
  and to_regprocedure('public.ops_schema_state()') is not null,
  'DC1070-R3 rollback testu cofnięty');
