-- =============================================================================
-- 0069 — języki serwisu jako dane, nie kopie listy (#29).
--
-- Dotąd lista ('pl','nl','fr','en') była powielona w 12 CHECK-ach kolumn i w 8
-- funkcjach. Dodanie RO/UK wymagałoby zmiany każdej kopii, a pominięta kopia po
-- cichu odrzucałaby nowy język (albo cofała go do 'pl'). Teraz:
--
-- 1. public.supported_locales — słownik języków (odczyt publiczny, zapis tylko
--    migracją; klient nie ma DML).
-- 2. public.is_supported_locale(text) — STRICT: NULL daje NULL, dokładnie jak
--    wcześniejsze `x in (...)` / `x not in (...)`, więc logika warunków w funkcjach
--    się nie zmienia (także dla NULL).
-- 3. CHECK-i kolumn locale zastąpione kluczami obcymi do supported_locales(code)
--    (NULL nadal dozwolony tam, gdzie był). Istniejące wiersze spełniały CHECK,
--    więc spełniają FK.
-- 4. W funkcjach public/auth wyrażenie `<operand> [not] in ('pl','nl','fr','en')`
--    zamieniamy na `[not] public.is_supported_locale(<operand>)` (CREATE OR REPLACE
--    z definicji z katalogu — właściciel, uprawnienia, SECURITY DEFINER i
--    search_path zostają). Na końcu asercja: żadna funkcja ani CHECK nie zawiera
--    już listy.
--
-- Nowy język = INSERT do supported_locales (osobna migracja) + tłumaczenia UI.
--
-- Rollback: nowa migracja odwracająca — ALTER TABLE ... DROP CONSTRAINT <fk> i
-- ADD CONSTRAINT <kolumna>_check CHECK (<kolumna> in ('pl','nl','fr','en')) dla
-- kolumn z listy NOTICE; w funkcjach odwrotna zamiana (lub definicje z migracji
-- 0012/0046/0047/0048/0054/0059/0063/0065/0066); DROP FUNCTION is_supported_locale,
-- DROP TABLE supported_locales. Migracja nie zmienia danych.
-- =============================================================================

create table public.supported_locales (
  code       text primary key check (code ~ '^[a-z]{2}$'),
  created_at timestamptz not null default now()
);
comment on table public.supported_locales is
  'Języki serwisu (#29). Jedyne źródło listy w bazie; zmiana tylko migracją.';

insert into public.supported_locales(code) values ('pl'), ('nl'), ('fr'), ('en');

alter table public.supported_locales enable row level security;
create policy supported_locales_select_all on public.supported_locales
  for select to anon, authenticated using (true);
revoke all on public.supported_locales from anon, authenticated;
grant select on public.supported_locales to anon, authenticated;

-- SECURITY INVOKER: słownik jest publiczny do odczytu, a funkcje, które ją wołają,
-- są definerami migratora. Bez PUBLIC EXECUTE (jak pozostałe funkcje domeny, 0058).
create function public.is_supported_locale(p_code text) returns boolean
language sql stable strict security invoker
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.supported_locales where code = p_code);
$$;
comment on function public.is_supported_locale(text) is
  'Czy kod jest językiem serwisu (#29). STRICT: NULL → NULL, jak `x in (...)`.';
revoke execute on function public.is_supported_locale(text) from public;
grant execute on function public.is_supported_locale(text) to anon, authenticated, service_role;
grant select on public.supported_locales to service_role;

-- 3. CHECK-i kolumn → klucze obce.
do $$
declare
  c record;
  v_column text;
  v_done text[] := '{}';
begin
  for c in
    select con.oid, con.conrelid, con.conname, con.conkey
    from pg_constraint con
    join pg_class t on t.oid = con.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where con.contype = 'c'
      and n.nspname in ('public', 'auth')
      and cardinality(con.conkey) = 1
      and pg_get_constraintdef(con.oid) ~
        '^CHECK \(\(\w+ = ANY \(ARRAY\[''pl''::text, ''nl''::text, ''fr''::text, ''en''::text\]\)\)\)$'
    order by con.conrelid::regclass::text, con.conname
  loop
    select attname into v_column from pg_attribute
    where attrelid = c.conrelid and attnum = c.conkey[1];

    execute format('alter table %s drop constraint %I', c.conrelid::regclass, c.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references public.supported_locales(code)',
      c.conrelid::regclass, c.conname || '_fk', v_column);
    v_done := v_done || (c.conrelid::regclass::text || '.' || v_column);
  end loop;

  if cardinality(v_done) = 0 then
    raise exception '0069: nie znaleziono CHECK-ów locale do zamiany';
  end if;
  raise notice '0069: CHECK → FK supported_locales (% kolumn): %',
    cardinality(v_done), array_to_string(v_done, ', ');
end $$;

-- 4. Funkcje: `<operand> [not] in ('pl','nl','fr','en')` → is_supported_locale().
do $$
declare
  f record;
  v_def text;
  v_list constant text := '\(\s*''pl''\s*,\s*''nl''\s*,\s*''fr''\s*,\s*''en''\s*\)';
  -- Operand: identyfikator (także kwalifikowany) albo coalesce(<identyfikator>, '').
  v_operand constant text := '(coalesce\(\s*[A-Za-z_][A-Za-z0-9_.]*\s*,\s*''''\s*\)|[A-Za-z_][A-Za-z0-9_.]*)';
  v_done text[] := '{}';
begin
  for f in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'auth')
      and p.prokind = 'f'
      and p.prosrc ~ ('''pl''\s*,\s*''nl''\s*,\s*''fr''\s*,\s*''en''')
  loop
    v_def := pg_get_functiondef(f.oid);
    v_def := regexp_replace(v_def, v_operand || '\s+not\s+in\s*' || v_list,
                            'not public.is_supported_locale(\1)', 'gi');
    v_def := regexp_replace(v_def, v_operand || '\s+in\s*' || v_list,
                            'public.is_supported_locale(\1)', 'gi');
    execute v_def;
    v_done := v_done || f.oid::regprocedure::text;
  end loop;
  raise notice '0069: funkcje przepięte na is_supported_locale (%): %',
    cardinality(v_done), array_to_string(v_done, ', ');
end $$;

-- Asercja: w bazie nie zostaje żadna kopia listy języków.
do $$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'auth')
    and p.prosrc ~ ('''pl''\s*,\s*''nl''\s*,\s*''fr''\s*,\s*''en''');
  if v_bad is not null then
    raise exception '0069: funkcje nadal zawierają listę języków: %', v_bad;
  end if;

  select string_agg(con.conrelid::regclass::text || '.' || con.conname, ', ') into v_bad
  from pg_constraint con
  where con.contype = 'c' and pg_get_constraintdef(con.oid) ~ '''nl''::text';
  if v_bad is not null then
    raise exception '0069: CHECK-i nadal zawierają listę języków: %', v_bad;
  end if;
end $$;
