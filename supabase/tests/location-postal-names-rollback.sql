-- =============================================================================
-- PC1119-R — rollback migracji 0212 (miasto z dopiskiem, nazwy miejscowości w języku widoku,
-- #1119) i ponowne nałożenie migracji (backfill). Uruchamiany przez scripts/test-rls.sh po
-- rls.sql, na tej samej bazie. Całość w transakcji, cofana.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

begin;
insert into public.companies(id, name, status)
  values ('f9500000-0000-0000-0000-000000099100', 'PC1119-R Firma', 'verified');
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,published_at) values
  ('f9500000-0000-0000-0000-000000099101','f9500000-0000-0000-0000-000000099100','pc1119r-a','Rollback PC1119R','warehouse','permanent','Bruxelles 1000','Bruxelles','active','pl', now());
-- Odroczone triggery ofert (kolejka tłumaczeń) przed ALTER TABLE w migracji/rollbacku.
set constraints all immediate;
select pg_temp.assert(
  public.get_public_jobs_count('pl', 'pc1119r', p_locations => array['Bruksela']) = 1
  and to_regclass('public.location_names') is not null,
  'PC1119-R0 stan przed rollbackiem');

\ir ../rollback/0212_location_postal_codes_names.down.sql

-- Po rollbacku: stan 0153/0183 — miasto z kodem pocztowym bez miejscowości, bez tabeli nazw.
select pg_temp.assert(
  (select location_id from public.jobs where slug = 'pc1119r-a') is null
  and public.get_public_jobs_count('pl', 'pc1119r', p_locations => array['Bruksela']) = 0
  and public.get_public_jobs_count('pl', null, p_locations => array['Leuven']) >= 0
  and to_regclass('public.location_names') is null
  and to_regprocedure('public.location_display_name(text,text)') is null
  and to_regprocedure('public.location_lookup_key(text)') is null
  and to_regprocedure('public.resolve_location_id(text)') is not null,
  'PC1119-R1 rollback przywraca resolve_location_id/location_filter_ids z 0153/0183');

-- Ponowne nałożenie migracji: backfill dowiązuje ofertę bez podbicia updated_at (token CAS #325).
alter table public.jobs disable trigger trg_set_updated_at;
alter table public.jobs disable trigger trg_strict_job_version;
update public.jobs set updated_at = '2026-01-01T00:00:00Z' where slug = 'pc1119r-a';
alter table public.jobs enable trigger trg_set_updated_at;
alter table public.jobs enable trigger trg_strict_job_version;
set constraints all immediate;
select pg_temp.assert((select updated_at from public.jobs where slug = 'pc1119r-a') = '2026-01-01T00:00:00Z',
  'PC1119-R2a znacznik updated_at ustawiony');
\ir ../migrations/0212_location_postal_codes_names.sql
select pg_temp.assert(
  (select l.slug from public.jobs j join public.locations l on l.id = j.location_id where j.slug = 'pc1119r-a') = 'brussels'
  and (select updated_at from public.jobs where slug = 'pc1119r-a') = '2026-01-01T00:00:00Z'
  and public.get_public_jobs_count('pl', 'pc1119r', p_locations => array['Bruksela']) = 1
  and public.location_display_name('Aalst', 'fr') = 'Alost',
  'PC1119-R2 backfill 0212: oferta z kodem pocztowym dowiązana, updated_at bez zmian');
rollback;
select pg_temp.assert(
  to_regclass('public.location_names') is not null
  and (select count(*) from public.jobs where slug = 'pc1119r-a') = 0,
  'PC1119-R3 rollback testu cofnięty');
\echo 'PC1119-R rollback 0212: PASS'
