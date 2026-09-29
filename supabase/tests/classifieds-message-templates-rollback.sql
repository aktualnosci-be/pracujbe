-- =============================================================================
-- CLTPL-R — rollback migracji 0979 (#1211). Uruchamiany przez scripts/test-rls.sh
-- po rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

begin;
\ir ../rollback/0979_classifieds_message_templates_off.down.sql
select pg_temp.assert(
  not exists (select 1 from pg_trigger t
               where t.tgname = 'trg_aa_recruitment_mode'
                 and t.tgrelid in ('public.company_message_templates'::regclass,
                                   'public.company_message_template_variants'::regclass))
  and to_regprocedure('public.enforce_recruitment_message_template()') is null
  and to_regprocedure('public.save_company_message_template_impl(uuid, uuid, text, jsonb, timestamptz)') is null
  and to_regprocedure('public.delete_company_message_template_impl(uuid, uuid)') is null
  and position('TEMPLATE_LIMIT' in pg_get_functiondef(
        'public.save_company_message_template(uuid, uuid, text, jsonb, timestamptz)'::regprocedure)) > 0
  and position('assert_recruitment_enabled' in pg_get_functiondef(
        'public.save_company_message_template(uuid, uuid, text, jsonb, timestamptz)'::regprocedure)) = 0
  and position('assert_recruitment_enabled' in pg_get_functiondef(
        'public.delete_company_message_template(uuid, uuid)'::regprocedure)) = 0
  and has_function_privilege('authenticated',
        'public.save_company_message_template(uuid, uuid, text, jsonb, timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.delete_company_message_template(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.delete_company_message_template(uuid, uuid)', 'execute'),
  'CLTPL-R rollback przywraca stan sprzed 0979 (0170)');
rollback;
select pg_temp.assert(to_regprocedure('public.enforce_recruitment_message_template()') is not null
  and to_regprocedure('public.save_company_message_template_impl(uuid, uuid, text, jsonb, timestamptz)') is not null,
  'CLTPL-R2 rollback testu cofnięty');
\echo 'CLTPL-R rollback 0979: PASS'
