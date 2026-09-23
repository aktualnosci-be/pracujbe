-- =============================================================================
-- supabase/tests/role-guard.sql — model ról, na którym stoją testy RLS (#23, #25).
--
-- Uruchamiane przez scripts/test-rls.sh po produkcyjnym bootstrapie i migracjach,
-- PRZED rls.sql. Sprawdza katalog i dowodzi kontrolami ujemnymi, że strażnik
-- pg_temp.assert_client_role() wykrywa każde obejście RLS. Bez tego zielony rls.sql
-- nie byłby dowodem: superuser lub właściciel tabeli przeszedłby wszystkie asercje „allow".
-- =============================================================================
\set ON_ERROR_STOP on
\ir role-assert.sql

create function pg_temp.guard_must_fail(p_setup text, p_name text) returns void
language plpgsql as $$
begin
  begin
    execute p_setup;
    perform pg_temp.assert_client_role();
  exception when others then
    if sqlerrm like 'ROLE GUARD:%' then
      return;
    end if;
    raise exception 'KONTROLA UJEMNA % : nieoczekiwany błąd: %', p_name, sqlerrm;
  end;
  raise exception 'KONTROLA UJEMNA % : strażnik nie wykrył obejścia RLS', p_name;
end $$;

-- 1. Katalog: role klienta i runtime bez przywilejów omijających RLS, bez logowania.
do $$
begin
  if exists (
    select 1 from pg_roles
    where rolname in ('anon', 'authenticated', 'pracujbe_app')
      and (rolsuper or rolbypassrls or rolcanlogin or rolcreaterole or rolcreatedb)
  ) then
    raise exception 'ROLE GUARD: anon/authenticated/pracujbe_app mają zbyt szerokie atrybuty';
  end if;
  if (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'pracujbe_app')) <> 3 then
    raise exception 'ROLE GUARD: brak ról bootstrapu (anon/authenticated/pracujbe_app)';
  end if;
end $$;

-- 2. Katalog: każda tabela w public/auth ma włączone RLS, a właścicielem nie jest rola runtime.
do $$
declare
  v_bad text;
begin
  select string_agg(n.nspname || '.' || c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'auth') and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'ROLE GUARD: tabele bez RLS: %', v_bad;
  end if;

  select string_agg(n.nspname || '.' || c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_roles r on r.oid = c.relowner
  where n.nspname in ('public', 'auth')
    and r.rolname in ('anon', 'authenticated', 'pracujbe_app', 'service_role');
  if v_bad is not null then
    raise exception 'ROLE GUARD: obiekty należące do roli runtime: %', v_bad;
  end if;
end $$;

-- 3. Kontrola dodatnia: rola klienta przechodzi strażnika.
set role authenticated;
select pg_temp.assert_client_role();
reset role;
set role anon;
select pg_temp.assert_client_role();
reset role;

-- 4. Kontrole ujemne: każde znane obejście RLS musi zostać wykryte.
--    Zmiany katalogu wykonujemy w transakcji i wycofujemy.
select pg_temp.guard_must_fail('select 1', 'superuser bez SET ROLE');

select pg_temp.guard_must_fail('set local role service_role', 'rola BYPASSRLS');

begin;
select pg_temp.guard_must_fail(
  'alter table public.profiles owner to authenticated; set local role authenticated',
  'klient jako właściciel tabeli');
rollback;

begin;
select pg_temp.guard_must_fail(
  'grant postgres to authenticated; set local role authenticated',
  'klient może przejąć superusera');
rollback;

begin;
select pg_temp.guard_must_fail(
  'set local row_security = off; set local role authenticated',
  'row_security wyłączone');
rollback;

-- 5. Kontrola ujemna na danych: bez roli klienta RLS nie filtruje, pod rolą klienta filtruje.
--    Dowodzi, że wynik asercji „allow" zależy od roli, a nie od samego zapytania.
begin;
insert into auth.users(id, email, name, raw_user_meta_data) values
  ('0e000000-0000-4000-8000-000000000001', 'guard-a@test.invalid', 'Guard A', '{"role":"candidate"}'),
  ('0e000000-0000-4000-8000-000000000002', 'guard-b@test.invalid', 'Guard B', '{"role":"candidate"}');
do $$
begin
  if (select count(*) from public.profiles) < 2 then
    raise exception 'ROLE GUARD: superuser powinien widzieć oba profile (RLS pominięte)';
  end if;
end $$;
set local role authenticated;
select set_config('app.current_uid', '0e000000-0000-4000-8000-000000000001', true);
select pg_temp.assert_client_role();
do $$
begin
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'ROLE GUARD: klient widzi cudze profile — RLS nie działa';
  end if;
end $$;
rollback;

\echo '=================== ROLE GUARD PASSED ==================='
