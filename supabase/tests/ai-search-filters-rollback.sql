-- =============================================================================
-- AIS711-R — rollback migracji 0222 (#711). Uruchamiany przez scripts/test-rls.sh po rls.sql,
-- na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany, więc baza po teście
-- ma nadal definicje z 0222.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

create function pg_temp.ais_has_feature() returns boolean language sql as $$
  select pg_get_functiondef('public.ai_budget_reserve(text, text, bigint)'::regprocedure) like '%''job_search_filters''%'
     and pg_get_constraintdef((select oid from pg_constraint where conname = 'ai_usage_ledger_feature')) like '%job_search_filters%'
$$;
create function pg_temp.ais_privileges_ok() returns boolean language sql as $$
  select has_function_privilege('service_role', 'public.ai_budget_reserve(text, text, bigint)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.ai_budget_reserve(text, text, bigint)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.ai_budget_reserve(text, text, bigint)', 'EXECUTE')
$$;

select pg_temp.assert(pg_temp.ais_has_feature() and pg_temp.ais_privileges_ok(),
  'AIS711-R0 przed rollbackiem: job_search_filters w CHECK-u i w ai_budget_reserve');

begin;
-- Wiersz rejestru nowej funkcji — rollback musi go usunąć, inaczej CHECK z 0176 nie wróci.
insert into public.ai_usage_ledger (feature, model, reserved_micro_usd, usage_day)
values ('job_search_filters', 'gpt-6-luna', 10, public.ai_budget_day());
\ir ../rollback/0222_ai_budget_job_search_filters.down.sql
select pg_temp.assert(not pg_temp.ais_has_feature() and pg_temp.ais_privileges_ok(),
  'AIS711-R1 rollback przywraca listę funkcji z 0176 i uprawnienia');
select pg_temp.assert(
  pg_get_functiondef('public.ai_budget_reserve(text, text, bigint)'::regprocedure) like '%''candidate_profile_translation''%'
  and pg_get_functiondef('public.ai_budget_reserve(text, text, bigint)'::regprocedure) like '%AI_BUDGET_EXCEEDED%'
  and pg_get_functiondef('public.ai_budget_reserve(text, text, bigint)'::regprocedure) like '%''job_offer_explain''%'
  and pg_get_constraintdef((select oid from pg_constraint where conname = 'ai_usage_ledger_feature')) like '%job_offer_explain%'
  and not exists (select 1 from public.ai_usage_ledger where feature = 'job_search_filters'),
  'AIS711-R2 po rollbacku reszta reguł budżetu (także job_offer_explain, #773) na miejscu, wiersze nowej funkcji usunięte');
rollback;

select pg_temp.assert(pg_temp.ais_has_feature() and pg_temp.ais_privileges_ok(),
  'AIS711-R3 rollback testu cofnięty; 0222 obowiązuje');
