-- =============================================================================
-- 0067 — obrona w głąb dla funkcji SECURITY DEFINER (#25).
--
-- Gdy pg_temp nie jest jawnie w search_path, PostgreSQL przeszukuje schemat
-- tymczasowy sesji PRZED pozostałymi dla nazw relacji. Funkcja SECURITY DEFINER
-- (właściciel: migrator) z `search_path = public` mogłaby więc odczytać tabelę
-- tymczasową utworzoną przez wywołującego zamiast public.<tabela>, jeżeli użyje
-- niekwalifikowanej nazwy. Zalecenie dokumentacji PostgreSQL: pg_temp na końcu.
--
-- 1. Każdej funkcji SECURITY DEFINER w public/auth dopisujemy pg_temp jako ostatni
--    element jej dotychczasowego search_path (kolejność pozostałych bez zmian).
-- 2. Role aplikacji nie potrzebują tabel tymczasowych: odbieramy TEMPORARY od PUBLIC
--    na bieżącej bazie. Migrator (właściciel bazy) zachowuje to prawo.
--
-- Rollback: `ALTER FUNCTION ... SET search_path = <poprzednia wartość>` oraz
-- `GRANT TEMPORARY ON DATABASE <baza> TO PUBLIC`. Migracja nie zmienia danych.
-- =============================================================================

do $$
declare
  fn record;
  v_path text;
  v_parts text[];
begin
  for fn in
    select p.oid::regprocedure as signature, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname in ('public', 'auth')
  loop
    select substr(cfg, length('search_path=') + 1) into v_path
    from unnest(coalesce(fn.proconfig, '{}'::text[])) as cfg
    where cfg like 'search_path=%';

    if v_path is null then
      raise exception 'Funkcja SECURITY DEFINER % nie ma ustawionego search_path', fn.signature;
    end if;

    select coalesce(array_agg(part order by ord), '{}'::text[]) into v_parts
    from unnest(string_to_array(v_path, ',')) with ordinality as t(raw, ord),
         lateral (select btrim(raw) as part) s
    where part <> '' and part <> 'pg_temp';

    execute format('alter function %s set search_path = %s',
                   fn.signature, array_to_string(v_parts || 'pg_temp'::text, ', '));
  end loop;
end $$;

do $$
begin
  execute format('revoke temporary on database %I from public', current_database());
end $$;
