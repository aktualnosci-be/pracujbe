-- =============================================================================
-- DBP1245-R — rollback migracji 0206 (indeksy usuwania konta #1245, znaki sterujące #1244).
-- Uruchamiany przez scripts/test-rls.sh po rls.sql, na tej samej bazie. Rollback wykonuje się
-- w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

create function pg_temp.state_0206() returns boolean language sql as $$
  select (select count(*) from pg_indexes where indexname in (
      'idx_notifications_entity', 'idx_email_deliveries_entity', 'idx_saved_search_alerts_profile',
      'idx_jobs_created_by', 'idx_offers_sender', 'idx_application_status_history_changed_by',
      'idx_offer_status_history_changed_by', 'idx_conversations_created_by',
      'idx_contact_messages_sender', 'email_outbox_user_idx')) = 10
    and exists (select 1 from pg_constraint where conname = 'saved_searches_name_no_control')
    and exists (select 1 from pg_constraint where conname = 'companies_name_no_control')
    and pg_get_functiondef('public.save_saved_search(text,text,jsonb,text,text)'::regprocedure) like '%u001f%'
$$;

select pg_temp.assert(pg_temp.state_0206(), 'DBP1245-R0 stan przed rollbackiem');

begin;
\ir ../rollback/0206_db_perf_indexes_control_chars.down.sql
select pg_temp.assert(
  not exists (select 1 from pg_indexes where indexname in (
      'idx_notifications_entity', 'idx_email_deliveries_entity', 'idx_saved_search_alerts_profile',
      'idx_jobs_created_by', 'idx_offers_sender', 'idx_application_status_history_changed_by',
      'idx_offer_status_history_changed_by', 'idx_conversations_created_by',
      'idx_contact_messages_sender', 'email_outbox_user_idx'))
  and not exists (select 1 from pg_constraint where conname in
      ('saved_searches_name_no_control', 'companies_name_no_control'))
  and pg_get_functiondef('public.save_saved_search(text,text,jsonb,text,text)'::regprocedure) not like '%u001f%'
  and has_function_privilege('authenticated', 'public.save_saved_search(text,text,jsonb,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.save_saved_search(text,text,jsonb,text,text)', 'execute'),
  'DBP1245-R rollback usuwa indeksy i CHECK, przywraca save_saved_search z 0092 (z grantami)');
rollback;
select pg_temp.assert(pg_temp.state_0206(), 'DBP1245-R2 rollback testu cofnięty');
\echo 'DBP1245-R rollback 0206: PASS'
