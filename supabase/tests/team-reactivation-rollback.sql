-- =============================================================================
-- TMR867-R — rollback migracji 0953 (przywrócenie członka przez zaproszenie, #867).
-- Uruchamiany przez scripts/test-rls.sh po rls.sql; rollback w transakcji cofanej, baza
-- zostaje po 0953.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(
  to_regprocedure('public.company_role_manageable_by(uuid, uuid, public.company_member_role)') is not null
  and exists (select 1 from pg_trigger where tgname = 'trg_company_invitations_reactivation_guard')
  and position('REACTIVATION_NOT_ALLOWED' in pg_get_functiondef('public.respond_to_company_invitation(uuid, boolean)'::regprocedure)) > 0,
  'TMR867-R0 baza w stanie po 0953');

begin;
\ir ../rollback/0953_team_member_reactivation_hierarchy.down.sql

select pg_temp.assert(
  to_regprocedure('public.company_role_manageable_by(uuid, uuid, public.company_member_role)') is null
  and to_regprocedure('public.guard_invitation_reactivation()') is null
  and to_regprocedure('public.invitation_reactivation_denied(uuid, public.citext, public.company_member_role, uuid)') is null
  and not exists (select 1 from pg_trigger where tgname = 'trg_company_invitations_reactivation_guard'),
  'TMR867-R1 rollback usuwa strażnika i funkcje pomocnicze');
select pg_temp.assert(
  position('REACTIVATION_NOT_ALLOWED' in pg_get_functiondef('public.respond_to_company_invitation(uuid, boolean)'::regprocedure)) = 0
  and position('company_members' in pg_get_functiondef('public.respond_to_company_invitation(uuid, boolean)'::regprocedure)) > 0
  and has_function_privilege('authenticated', 'public.respond_to_company_invitation(uuid, boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.respond_to_company_invitation(uuid, boolean)', 'EXECUTE'),
  'TMR867-R2 respond_to_company_invitation wraca do definicji z 0086 z tymi samymi uprawnieniami');
rollback;

select pg_temp.assert(
  exists (select 1 from pg_trigger where tgname = 'trg_company_invitations_reactivation_guard'),
  'TMR867-R3 po teście baza wraca do stanu po 0953');

\echo '--- TMR867-R rollback 0953 OK ---'
