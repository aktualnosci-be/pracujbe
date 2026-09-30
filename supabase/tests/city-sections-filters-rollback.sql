-- =============================================================================
-- SRCH1076-R — rollback migracji 0183 (części gmin w filtrach, #1076). Uruchamiany przez
-- scripts/test-rls.sh po rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji
-- i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

begin;
insert into public.companies(id, name, status)
  values ('f9500000-0000-0000-0000-000000031000', 'SRCH1076-R Firma', 'verified');
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,published_at) values
  ('f9500000-0000-0000-0000-000000031001','f9500000-0000-0000-0000-000000031000','sr1076r-a','Rollback SRCH1076R','warehouse','permanent','Leuven','Flandria','active','pl', now()),
  ('f9500000-0000-0000-0000-000000031002','f9500000-0000-0000-0000-000000031000','sr1076r-b','Rollback SRCH1076R','warehouse','permanent','Heverlee','Flandria','active','pl', now());
-- Przed rollbackiem: gmina obejmuje część, facet grupuje pod gminą.
select pg_temp.assert(
  public.get_public_jobs_count('pl', 'srch1076r', p_locations => array['Leuven']) = 2
  and public.get_public_jobs_count('pl', 'srch1076r', 'Leuven') = 2
  and (select array_agg(key || ':' || total order by key)
         from public.get_public_job_filter_facets('pl', 'srch1076r') where dimension = 'location') = array['Leuven:2'],
  'SRCH1076-R0 stan przed rollbackiem');

-- Rollback w odwrotnej kolejności: 0194 (filtry listy ofert — numer tymczasowy) redefiniuje
-- facety i listę ofert z nowymi parametrami, więc najpierw jej rollback, potem 0183.
-- Odroczone triggery (tłumaczenia, zaufanie treści) po wstawieniu ofert blokują ALTER TABLE.
set constraints all immediate;
-- 0960 (#1215) zależy od 0194 (indeksy na job_salary_sort_key z 0194) — najpierw jej rollback.
\ir ../rollback/0960_public_jobs_custom_plan.down.sql
\ir ../rollback/0194_job_filters_language_worktime_radius.down.sql
\ir ../rollback/0183_city_sections_in_filters.down.sql

-- Po rollbacku (0153/0167): sama gmina, facet po nazwie miejscowości oferty.
select pg_temp.assert(
  public.get_public_jobs_count('pl', 'srch1076r', p_locations => array['Leuven']) = 1
  and public.get_public_jobs_count('pl', 'srch1076r', 'Leuven') = 1
  and (select array_agg(key || ':' || total order by key)
         from public.get_public_job_filter_facets('pl', 'srch1076r') where dimension = 'location') = array['Heverlee:1', 'Leuven:1']
  and to_regclass('public.locations_parent_active_idx') is null
  and to_regprocedure('public.get_public_jobs(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,integer,integer,text,boolean)') is not null,
  'SRCH1076-R rollback przywraca filtr i facety z 0153/0167, listy ofert bez zmian');
rollback;
select pg_temp.assert(
  public.get_public_jobs_count('pl', null, p_locations => array['Leuven']) >= 0
  and to_regclass('public.locations_parent_active_idx') is not null,
  'SRCH1076-R2 rollback testu cofnięty');
\echo 'SRCH1076-R rollback 0183: PASS'
