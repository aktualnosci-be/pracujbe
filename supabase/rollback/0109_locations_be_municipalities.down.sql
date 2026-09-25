-- =============================================================================
-- Rollback 0109 — słownik miejscowości z aliasami (#194). Uruchamiać ręcznie jako migrator,
-- w jednej transakcji (psql -1 -f …), i dopiero wtedy usunąć wpis z app_migrations.history.
-- Plik celowo BEZ BEGIN/COMMIT (supabase/tests/locations-rollback.sql wykonuje go
-- w transakcji i cofa).
--
-- Usuwa aliasy i miejscowości dodane przez 0109 (z kodem NIS albo rodzaju innego niż
-- `municipality`), poza 10 miastami z 0010; te wracają do stanu sprzed 0109. Żadna tabela
-- nie ma klucza obcego do `locations` poza `location_aliases`. Matching po wycofaniu korzysta
-- z listy w kodzie — wycofanie łączyć z wycofaniem kodu z tego samego PR (loader czyta
-- `location_aliases`; bez tabeli dopasowanie zwraca błąd odczytu zamiast procentu).
-- =============================================================================

drop table if exists public.location_aliases;

delete from public.locations
 where slug <> all (array['brussels', 'antwerp', 'ghent', 'leuven', 'mechelen', 'hasselt',
                          'liege', 'charleroi', 'bruges', 'kortrijk'])
   and is_demo = false
   and (refnis is not null or kind <> 'municipality');

drop index if exists public.locations_refnis_key;
alter table public.locations drop column if exists refnis, drop column if exists kind;
