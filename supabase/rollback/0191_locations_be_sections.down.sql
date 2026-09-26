-- =============================================================================
-- Rollback 0191 — części gmin w słowniku miejscowości. Uruchamiać ręcznie jako migrator,
-- w jednej transakcji (psql -1 -f …), i dopiero wtedy usunąć wpis z app_migrations.history.
-- Plik celowo BEZ BEGIN/COMMIT (supabase/tests/locations-sections-rollback.sql wykonuje go
-- w transakcji i cofa). Numer tymczasowy — zmienia się razem z migracją.
--
-- Usuwa części gmin (kind = 'section'; aliasy znikają kaskadowo), kolumnę
-- `parent_location_id` ze strażnikiem i przywraca CHECK rodzaju z 0112. Gminy i aliasy
-- z 0112 zostają bez zmian. Kod matchingu nie zależy od części gmin (czyta aliasy) —
-- po wycofaniu nazwa części gminy jest po prostu miejscowością nieznaną.
-- =============================================================================

delete from public.locations where kind = 'section';

drop trigger if exists locations_section_parent_guard on public.locations;
drop function if exists public.locations_section_parent_guard();
drop index if exists public.locations_parent_idx;
alter table public.locations
  drop constraint if exists locations_section_parent_check,
  drop column if exists parent_location_id,
  drop constraint if exists locations_kind_check;
alter table public.locations
  add constraint locations_kind_check check (kind in ('municipality', 'former_municipality', 'locality'));
