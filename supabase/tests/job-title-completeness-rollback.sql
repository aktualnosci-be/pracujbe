-- =============================================================================
-- BZ1221-R — rollback migracji 0203 (#1221). Uruchamiany przez scripts/test-rls.sh po rls.sql,
-- na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany, więc baza po teście
-- ma nadal definicje z 0203.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

-- Liczba z trzech funkcji z heurystyką tytułu-zaślepki.
create function pg_temp.bz_heuristic_count() returns int language sql as $$
  select count(*)::int from unnest(array['public.publish_job(uuid, text)', 'public.set_job_status(uuid, text)',
                                          'public.update_published_job(uuid, jsonb, timestamptz)']) f
   where pg_get_functiondef(f::regprocedure) ~* 'ilike ''draft%'' or v_title ilike ''%placeholder%'''
$$;
create function pg_temp.bz_privileges_ok() returns boolean language sql as $$
  select bool_and(has_function_privilege('authenticated', f, 'execute')
                  and not has_function_privilege('anon', f, 'execute'))
    from unnest(array['public.publish_job(uuid, text)', 'public.set_job_status(uuid, text)',
                      'public.update_published_job(uuid, jsonb, timestamptz)']) f
$$;

select pg_temp.assert(pg_temp.bz_heuristic_count() = 0 and pg_temp.bz_privileges_ok(),
  'BZ1221-R0 przed rollbackiem: trzy funkcje bez heurystyki, EXECUTE tylko authenticated');

begin;
\ir ../rollback/0203_job_title_completeness.down.sql
select pg_temp.assert(pg_temp.bz_heuristic_count() = 3 and pg_temp.bz_privileges_ok(),
  'BZ1221-R rollback przywraca definicje 0200/0172/0202 (z heurystyką) i uprawnienia');
-- Pozostała logika poza tytułem bez zmian: kanał aplikowania (0172), termin ważności (0085),
-- zaufany kontekst edycji (0200) i odświeżenie published_at przy reopen (0202) — rollback nie
-- może cofnąć definicji do stanu sprzed 0200/0202.
select pg_temp.assert(
  pg_get_functiondef('public.publish_job(uuid, text)'::regprocedure) like '%JOB_APPLY_CHANNEL_REQUIRED%'
  and pg_get_functiondef('public.update_published_job(uuid, jsonb, timestamptz)'::regprocedure) like '%JOB_EDIT_CONFLICT%'
  and pg_get_functiondef('public.set_job_status(uuid, text)'::regprocedure) like '%JOB_EXPIRED%'
  and pg_get_functiondef('public.update_published_job(uuid, jsonb, timestamptz)'::regprocedure) like '%job_operation_context%'
  and pg_get_functiondef('public.update_published_job(uuid, jsonb, timestamptz)'::regprocedure) like '%job_edit_audit_snapshot%'
  and pg_get_functiondef('public.update_published_job(uuid, jsonb, timestamptz)'::regprocedure) not like '%pracujbe.job_edit%'
  and pg_get_functiondef('public.set_job_status(uuid, text)'::regprocedure) like '%when p_action = ''reopen'' then now()%',
  'BZ1221-R1 po rollbacku reszta reguł na miejscu (w tym 0200/0202)');
rollback;

select pg_temp.assert(pg_temp.bz_heuristic_count() = 0
  and pg_get_functiondef('public.publish_job(uuid, text)'::regprocedure) like '%JOB_APPLY_CHANNEL_REQUIRED%'
  and pg_get_functiondef('public.update_published_job(uuid, jsonb, timestamptz)'::regprocedure) like '%JOB_EDIT_CONFLICT%'
  and pg_get_functiondef('public.set_job_status(uuid, text)'::regprocedure) like '%JOB_EXPIRED%'
  and pg_get_functiondef('public.update_published_job(uuid, jsonb, timestamptz)'::regprocedure) like '%job_operation_context%'
  and pg_get_functiondef('public.set_job_status(uuid, text)'::regprocedure) like '%when p_action = ''reopen'' then now()%',
  'BZ1221-R2 rollback testu cofnięty; 0203 zachowuje pozostałe reguły');
