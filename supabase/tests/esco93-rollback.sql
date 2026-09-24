-- =============================================================================
-- ESCO93-R — rollback migracji 0097 (#93). Uruchamiany przez scripts/test-rls.sh
-- po rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany,
-- więc baza po teście ma nadal schemat 0097.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select count(*) as e93manual from public.occupations where source = 'manual' \gset
select pg_temp.assert((select count(*) from public.occupations where source = 'esco') > 0,
  'ESCO93-R0 przed rollbackiem są wiersze ESCO (z rls.sql)');

begin;
\ir ../rollback/0097_esco_taxonomy.down.sql
select pg_temp.assert(to_regclass('public.esco_snapshots') is null
  and to_regclass('public.occupation_labels') is null
  and to_regclass('public.occupation_skills') is null
  and not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name in ('occupations', 'skills')
                    and column_name in ('esco_uri', 'source'))
  and (select count(*) from public.occupations) = :e93manual,
  'ESCO93-R rollback usuwa taksonomię ESCO, zostawia ręczne wiersze');
rollback;
select pg_temp.assert(to_regclass('public.esco_snapshots') is not null, 'ESCO93-R2 rollback testu cofnięty');

\echo '=================== ESCO93 ROLLBACK TEST PASSED ==================='
