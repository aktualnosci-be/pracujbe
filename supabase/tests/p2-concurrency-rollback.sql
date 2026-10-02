-- =============================================================================
-- P2C994-R — rollback migracji 0210 (#906/#802/#793). Uruchamiany przez scripts/test-rls.sh
-- po rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

create function pg_temp.defs() returns text language sql as $$
  select pg_get_functiondef('public.enqueue_campaign_batch(uuid, integer)'::regprocedure)
    || pg_get_functiondef('public.sync_job_translation_source(uuid)'::regprocedure)
    || pg_get_functiondef('public.invite_company_member(uuid, text, text, text, text, text)'::regprocedure);
$$;

select pg_temp.assert(
  position('for no key update' in pg_temp.defs()) > 0 and position('for share of c' in pg_temp.defs()) > 0
  and position('v_sent' in pg_temp.defs()) > 0,
  'P2C994-R0 stan po 0210');

begin;
\ir ../rollback/0210_p2_concurrency_fixes.down.sql
select pg_temp.assert(
  position('for no key update' in pg_temp.defs()) = 0 and position('v_seen' in pg_temp.defs()) = 0
  and position('for share of c' in pg_temp.defs()) = 0 and position('v_sent' in pg_temp.defs()) = 0
  and position('if v_reserved = 0 then' in pg_temp.defs()) > 0
  and position('array[v_job.company_name]' in pg_temp.defs()) > 0
  and position('expires_at > now()) >= 50' in pg_temp.defs()) > 0
  and has_function_privilege('service_role', 'public.enqueue_campaign_batch(uuid, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.enqueue_campaign_batch(uuid, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.invite_company_member(uuid, text, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.invite_company_member(uuid, text, text, text, text, text)', 'execute'),
  'P2C994-R1 rollback przywraca definicje z 0186, 0190 i 0178 (z grantami)');
rollback;

select pg_temp.assert(position('v_sent' in pg_temp.defs()) > 0, 'P2C994-R2 po cofnięciu transakcji stan po 0210');
