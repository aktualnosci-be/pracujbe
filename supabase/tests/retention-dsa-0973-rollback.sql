-- =============================================================================
-- RD973-R — rollback migracji 0973 (numer tymczasowy: retencja CV/konta od terminu, utrwalona
-- chwila poinformowania DSA, brak cofnięcia po anonimizacji). Uruchamiany przez
-- scripts/test-rls.sh po rls.sql; rollback w transakcji cofanej — baza zostaje w stanie po 0973.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(
  exists (select 1 from information_schema.columns where table_schema = 'public'
           and table_name = 'moderation_decisions' and column_name = 'informed_at')
  and exists (select 1 from pg_trigger where tgname = 'trg_moderation_record_informed_email')
  and position('CASE_REDACTED' in pg_get_functiondef('public.moderation_restore_core(uuid, text, boolean)'::regprocedure)) > 0
  and position('w.due_at - v_lead' in pg_get_functiondef('public.retention_purge_batch(integer)'::regprocedure)) = 0,
  'RD973-R0 baza w stanie po 0973');

begin;
\ir ../rollback/0973_retention_dsa_informed_restore.down.sql

select pg_temp.assert(
  not exists (select 1 from information_schema.columns where table_schema = 'public'
               and table_name in ('moderation_decisions', 'moderation_restorations') and column_name = 'informed_at')
  and not exists (select 1 from pg_trigger where tgname in
                   ('trg_moderation_record_informed_email', 'trg_moderation_record_informed_notification'))
  and to_regprocedure('public.moderation_record_informed_email()') is null
  and to_regprocedure('public.moderation_record_informed_notification()') is null,
  'RD973-R1 rollback usuwa kolumny, triggery i funkcje utrwalające chwilę poinformowania');
select pg_temp.assert(
  position('CASE_REDACTED' in pg_get_functiondef('public.moderation_restore_core(uuid, text, boolean)'::regprocedure)) = 0
  and position('w.due_at - v_lead <= now()' in pg_get_functiondef('public.retention_purge_batch(integer)'::regprocedure)) > 0
  and position('informed_at' in pg_get_functiondef('public.moderation_append_only()'::regprocedure)) = 0
  and position('least(d.informed_at' in pg_get_functiondef('public.moderation_informed_at(uuid)'::regprocedure)) = 0
  and position('mr.informed_at' in pg_get_functiondef('public.moderation_restoration_informed_at(uuid)'::regprocedure)) = 0,
  'RD973-R2 rollback przywraca definicje sprzed 0973');
-- Funkcje po rollbacku działają (bez odwołań do usuniętych kolumn).
select pg_temp.assert(public.moderation_informed_at(gen_random_uuid()) is null
  and public.moderation_restoration_informed_at(gen_random_uuid()) is null,
  'RD973-R3 funkcje terminów po rollbacku wykonują się');
rollback;

select pg_temp.assert(
  exists (select 1 from information_schema.columns where table_schema = 'public'
           and table_name = 'moderation_decisions' and column_name = 'informed_at'),
  'RD973-R4 po cofnięciu transakcji stan po 0973');
