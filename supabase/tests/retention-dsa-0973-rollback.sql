-- =============================================================================
-- RD973-R — rollback migracji 0197 (numer tymczasowy: retencja CV/konta od terminu, brak
-- cofnięcia po anonimizacji). Uruchamiany przez scripts/test-rls.sh po rls.sql; rollback
-- w transakcji cofanej — baza zostaje w stanie po 0197. Dowód poinformowania z 0188 zostaje.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(
  position('CASE_REDACTED' in pg_get_functiondef('public.moderation_restore_core(uuid, text, boolean)'::regprocedure)) > 0
  and position('w.due_at - v_lead' in pg_get_functiondef('public.retention_purge_batch(integer)'::regprocedure)) = 0,
  'RD973-R0 baza w stanie po 0197');

begin;
\ir ../rollback/0197_retention_dsa_informed_restore.down.sql

select pg_temp.assert(
  position('CASE_REDACTED' in pg_get_functiondef('public.moderation_restore_core(uuid, text, boolean)'::regprocedure)) = 0
  and position('w.due_at - v_lead <= now()' in pg_get_functiondef('public.retention_purge_batch(integer)'::regprocedure)) > 0,
  'RD973-R1 rollback przywraca definicje sprzed 0197');
select pg_temp.assert(
  to_regclass('public.moderation_informed') is not null
  and position('moderation_informed' in pg_get_functiondef('public.moderation_informed_at(uuid)'::regprocedure)) > 0
  and position('moderation_informed' in pg_get_functiondef('public.moderation_restoration_informed_at(uuid)'::regprocedure)) > 0,
  'RD973-R2 rollback nie rusza dowodu poinformowania z 0188');
rollback;

select pg_temp.assert(
  position('CASE_REDACTED' in pg_get_functiondef('public.moderation_restore_core(uuid, text, boolean)'::regprocedure)) > 0,
  'RD973-R3 po cofnięciu transakcji stan po 0197');
