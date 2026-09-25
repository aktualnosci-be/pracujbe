-- =============================================================================
-- LOC194-R — rollback migracji 0108 (#194). Uruchamiany przez scripts/test-rls.sh po
-- rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select md5(string_agg(concat_ws('|', slug, name, latitude, longitude, sort_order), ',' order by slug))
  as locseed from public.locations
 where slug in ('brussels', 'antwerp', 'ghent', 'leuven', 'mechelen', 'hasselt',
                'liege', 'charleroi', 'bruges', 'kortrijk') \gset

begin;
\ir ../rollback/0108_locations_be_municipalities.down.sql
select pg_temp.assert(to_regclass('public.location_aliases') is null
  and not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'locations' and column_name in ('kind', 'refnis'))
  and (select count(*) from public.locations where is_demo = false) = 10
  and (select md5(string_agg(concat_ws('|', slug, name, latitude, longitude, sort_order), ',' order by slug))
         from public.locations
        where slug in ('brussels', 'antwerp', 'ghent', 'leuven', 'mechelen', 'hasselt',
                       'liege', 'charleroi', 'bruges', 'kortrijk')) = :'locseed',
  'LOC194-R rollback usuwa tylko dane i obiekty 0108');
rollback;
select pg_temp.assert(to_regclass('public.location_aliases') is not null
  and (select count(*) from public.locations) > 500,
  'LOC194-R2 rollback testu cofnięty');
\echo 'LOC194-R rollback 0108: PASS'
