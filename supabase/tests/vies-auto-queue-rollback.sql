-- =============================================================================
-- VQ976-R — rollback migracji 0191 (kolejka automatycznego sprawdzenia VIES, #706/#879).
-- Uruchamiany przez scripts/test-rls.sh po rls.sql, na tej samej bazie. Rollback wykonuje się
-- w transakcji i jest cofany, więc baza po teście nadal ma stan po 0191.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(to_regclass('public.company_vies_auto_queue') is not null
  and to_regprocedure('public.claim_company_vies_auto_checks(integer, uuid, integer)') is not null,
  'VQ976-R0 baza w stanie po 0191');
select count(*) as vq_checks from public.company_vies_checks \gset

begin;
\ir ../rollback/0191_company_vies_auto_queue.down.sql

select pg_temp.assert(
  to_regclass('public.company_vies_auto_queue') is null
  and to_regprocedure('public.claim_company_vies_auto_checks(integer, uuid, integer)') is null
  and to_regprocedure('public.finish_company_vies_auto_check(uuid, text, text)') is null
  and to_regprocedure('public.company_vies_number(text, text)') is null
  and not exists (select 1 from pg_trigger where tgname in ('trg_companies_vies_auto_enqueue', 'trg_company_vies_checks_dequeue')),
  'VQ976-R1 kolejka, triggery i funkcje usunięte');
select pg_temp.assert(
  to_regprocedure('public.record_company_vies_check_auto(uuid, text, text, text, date)') is not null
  and (select count(*) from public.company_vies_checks) = :vq_checks,
  'VQ976-R2 funkcja zapisu z 0164 wraca, wyniki zostają');

-- Definicja z 0164 działa bez helpera z 0191 (nie nadpisuje wyniku innego numeru).
insert into public.companies(id, name, status, vat_number)
  values ('00000000-0000-0000-0000-000000000a9a', 'Firma VQR', 'unverified', 'BE0417497106');
insert into public.company_vies_checks(company_id, vat_number, result)
  values ('00000000-0000-0000-0000-000000000a9a', '0403170701', 'valid');
set role service_role;
select public.record_company_vies_check_auto('00000000-0000-0000-0000-000000000a9a', '0417497106', 'valid') as vqr \gset
reset role;
select pg_temp.assert(:'vqr' = 'f', 'VQ976-R3 zachowanie 0164 (bez zastąpienia wyniku innego numeru)');
rollback;

select pg_temp.assert(to_regclass('public.company_vies_auto_queue') is not null,
  'VQ976-R4 po cofnięciu transakcji stan po 0191');
