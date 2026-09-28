-- =============================================================================
-- BT980-R — rollback migracji 0980 (usunięcie martwego schematu billingu, #51). Uruchamiany przez
-- scripts/test-rls.sh po rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest
-- cofany, więc baza po teście nadal ma stan po 0980 (bez tabel billingu).
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

-- Punkt wyjścia: stan po 0980.
select pg_temp.assert(to_regclass('public.subscriptions') is null
  and to_regclass('public.checkout_intents') is null
  and to_regprocedure('public.begin_checkout(uuid, text)') is null,
  'BT980-R0 baza w stanie po 0980');
select count(*) as bt_companies from public.companies \gset

begin;
\ir ../rollback/0980_drop_dead_billing_schema.down.sql

-- Schemat wrócił: tabele, kolumna, typy, RPC, polityki i triggery.
select pg_temp.assert(
  to_regclass('public.subscriptions') is not null and to_regclass('public.payments') is not null
  and to_regclass('public.invoices') is not null and to_regclass('public.discount_codes') is not null
  and to_regclass('public.checkout_intents') is not null and to_regclass('public.discount_redemptions') is not null
  and exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'companies' and column_name = 'provider_customer_id')
  and exists (select 1 from pg_type where typname = 'subscription_status')
  and to_regprocedure('public.reserve_discount(text, uuid)') is not null
  and to_regprocedure('public.finalize_discount(uuid, uuid, text)') is not null
  and to_regprocedure('public.release_stale_discount_reservations(integer)') is not null
  and to_regprocedure('public.begin_checkout(uuid, text)') is not null
  and to_regprocedure('public.complete_checkout(uuid, text)') is not null
  and to_regprocedure('public.release_checkout_intent(uuid)') is not null
  and to_regprocedure('public.release_stale_checkout_intents(integer)') is not null
  and exists (select 1 from pg_policies where policyname = 'subscriptions_select_admin')
  and exists (select 1 from pg_trigger where tgname = 'trg_set_updated_at'
               and tgrelid = 'public.subscriptions'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.checkout_intents'::regclass),
  'BT980-R1 rollback odtwarza tabele, kolumnę, typy, RPC, polityki i triggery');

-- company_plan znów czyta subskrypcje, begin_checkout i rabaty działają.
select pg_temp.assert(
  position('subscriptions' in pg_get_functiondef('public.company_plan(uuid)'::regprocedure)) > 0
  and position('staleCheckoutIntents' in pg_get_functiondef('public.ops_metrics()'::regprocedure)) > 0,
  'BT980-R2 rollback przywraca company_plan i ops_metrics sprzed 0980');

insert into public.companies (id, name, status)
  values ('b9800000-0000-0000-0000-0000000000c1', 'Firma BT980', 'verified');
insert into public.subscriptions (company_id, plan, status)
  values ('b9800000-0000-0000-0000-0000000000c1', 'standard', 'active');
select pg_temp.assert(public.company_plan('b9800000-0000-0000-0000-0000000000c1') = 'standard',
  'BT980-R3 company_plan zwraca plan z aktywnej subskrypcji');
insert into public.discount_codes (id, code, percent_off, max_redemptions)
  values ('b9800000-0000-0000-0000-0000000000d1', 'BT980', 10, 1);
select pg_temp.assert(
  (public.reserve_discount('BT980', 'b9800000-0000-0000-0000-0000000000c1') ->> 'percent_off') = '10',
  'BT980-R4 reserve_discount działa po rollbacku');
select pg_temp.assert(
  (public.ops_metrics() -> 'maintenance' ? 'staleCheckoutIntents'),
  'BT980-R5 ops_metrics ma liczniki checkoutu po rollbacku');
rollback;

-- Po cofnięciu transakcji test nie zostawił śladu.
select pg_temp.assert(to_regclass('public.subscriptions') is null
  and to_regprocedure('public.begin_checkout(uuid, text)') is null
  and not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'companies' and column_name = 'provider_customer_id')
  and (select count(*) from public.companies) = :bt_companies,
  'BT980-R6 rollback testu cofnięty (stan po 0980)');
\echo 'BT980-R rollback 0980: PASS'
