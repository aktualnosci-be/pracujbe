-- =============================================================================
-- CT1093-R — rollback migracji 0205 (potwierdzenie kontaktu w języku odbiorcy, #1093).
-- Uruchamiany przez scripts/test-rls.sh po rls.sql, na tej samej bazie. Rollback wykonuje się
-- w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(
  position('v_mail_locale' in pg_get_functiondef(
    'public.submit_contact_message(uuid,uuid,text,text,text,text,text)'::regprocedure)) > 0,
  'CT1093-R0 stan przed rollbackiem: definicja z 0205');

begin;
\ir ../rollback/0205_contact_recipient_locale.down.sql
select pg_temp.assert(
  position('v_mail_locale' in pg_get_functiondef(
    'public.submit_contact_message(uuid,uuid,text,text,text,text,text)'::regprocedure)) = 0
  and has_function_privilege('service_role',
    'public.submit_contact_message(uuid,uuid,text,text,text,text,text)', 'execute')
  and not has_function_privilege('anon',
    'public.submit_contact_message(uuid,uuid,text,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated',
    'public.submit_contact_message(uuid,uuid,text,text,text,text,text)', 'execute'),
  'CT1093-R rollback przywraca definicję z 0125 z grantami');
rollback;
select pg_temp.assert(
  position('v_mail_locale' in pg_get_functiondef(
    'public.submit_contact_message(uuid,uuid,text,text,text,text,text)'::regprocedure)) > 0,
  'CT1093-R2 rollback testu cofnięty');
\echo 'CT1093-R rollback 0205: PASS'
