-- =============================================================================
-- AIX773-R — rollback migracji 0220 (#773). Uruchamiany przez scripts/test-rls.sh po rls.sql,
-- na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany, więc baza po teście
-- ma nadal definicje z 0220.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

create function pg_temp.aix_knows_explain() returns boolean language sql as $$
  select position('job_offer_explain' in pg_get_functiondef('public.ai_budget_reserve(text, text, bigint)'::regprocedure)) > 0
     and exists (select 1 from pg_constraint where conname = 'ai_usage_ledger_feature'
                   and pg_get_constraintdef(oid) like '%job_offer_explain%')
$$;
create function pg_temp.aix_privileges_ok() returns boolean language sql as $$
  select has_function_privilege('service_role', 'public.ai_budget_reserve(text, text, bigint)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.ai_budget_reserve(text, text, bigint)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.ai_budget_reserve(text, text, bigint)', 'EXECUTE')
$$;

select pg_temp.assert(pg_temp.aix_knows_explain() and pg_temp.aix_privileges_ok(),
  'AIX773-R0 przed rollbackiem: funkcja w CHECK i allow-liście, EXECUTE tylko service_role');

begin;
\ir ../rollback/0220_ai_job_explain.down.sql
select pg_temp.assert(not pg_temp.aix_knows_explain() and pg_temp.aix_privileges_ok()
  and position('candidate_profile_translation' in pg_get_functiondef('public.ai_budget_reserve(text, text, bigint)'::regprocedure)) > 0,
  'AIX773-R1 rollback przywraca listę z 0176 (bez job_offer_explain) i uprawnienia');
-- Kontrola ujemna: bez 0220 rezerwacja wyjaśnienia jest odrzucona (funkcja nie woła modelu).
savepoint aix_neg;
do $$
begin
  perform public.ai_budget_reserve('job_offer_explain', 'gpt-6-luna', 10);
  raise exception 'ASSERT FAILED: AIX773-R2 rezerwacja przeszła bez 0220';
exception when others then
  if sqlerrm not like 'VALIDATION_FAILED%' then raise; end if;
end $$;
rollback to savepoint aix_neg;
rollback;

-- Rollback z wierszem rejestru tej funkcji przerywa się (dane rozliczeń nie są kasowane po cichu).
begin;
insert into public.ai_usage_ledger (feature, model, reserved_micro_usd, usage_day)
values ('job_offer_explain', 'gpt-6-luna', 1, current_date);
savepoint aix_rows;
do $$
begin
  begin
    alter table public.ai_usage_ledger drop constraint if exists ai_usage_ledger_feature;
    alter table public.ai_usage_ledger add constraint ai_usage_ledger_feature
      check (feature in ('job_listing_import', 'content_translation', 'job_offer_assist', 'cv_profile_import', 'job_fraud_check', 'candidate_profile_translation'));
    raise exception 'ASSERT FAILED: AIX773-R3 CHECK z 0176 przyjęty mimo wiersza job_offer_explain';
  exception when check_violation then null;
  end;
end $$;
rollback to savepoint aix_rows;
rollback;

select pg_temp.assert(pg_temp.aix_knows_explain() and pg_temp.aix_privileges_ok(),
  'AIX773-R4 rollback testu cofnięty; 0220 na miejscu');
