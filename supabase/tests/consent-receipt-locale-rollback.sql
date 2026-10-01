-- =============================================================================
-- CVL672-R — rollback migracji 0971 (język receiptu zgody cookies, #672). Uruchamiany przez
-- scripts/test-rls.sh po rls.sql; rollback w transakcji cofanej, baza zostaje po 0971.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(
  to_regprocedure('public.record_consent(jsonb, text, text, text, text, text, text)') is not null
  and to_regprocedure('public.record_consent(jsonb, text, text, text, text, text)') is null,
  'CVL672-R0 baza w stanie po 0971 (jedno przeciążenie z p_locale)');

begin;
\ir ../rollback/0971_consent_receipt_locale.down.sql

select pg_temp.assert(
  to_regprocedure('public.record_consent(jsonb, text, text, text, text, text, text)') is null
  and to_regprocedure('public.record_consent(jsonb, text, text, text, text, text)') is not null
  and position('p_locale' in pg_get_functiondef('public.record_consent(jsonb, text, text, text, text, text)'::regprocedure)) = 0,
  'CVL672-R1 rollback przywraca record_consent z 0142 (6 argumentów, bez p_locale)');

-- Funkcja po rollbacku nadal wykonywalna przez anon (log zgód działa).
set local role anon;
select public.record_consent('{"analytics":true}'::jsonb, 'cookie_banner', 'vis-cvl-r2', null, null, null);
reset role;
select pg_temp.assert(
  (select count(*) from public.consents where visitor_id = 'vis-cvl-r2') = 3,
  'CVL672-R2 record_consent po rollbacku wykonywalne przez anon');
rollback;

select pg_temp.assert(
  to_regprocedure('public.record_consent(jsonb, text, text, text, text, text, text)') is not null,
  'CVL672-R3 po teście baza wraca do stanu po 0971');

\echo '--- CVL672-R rollback 0971 OK ---'
