-- =============================================================================
-- PS969-R — rollback migracji 0215 (pauza alertów, obserwowanie firmy, szablon
-- `followedCompanyJobs`, wygaszanie digestów przy pauzie). Uruchamiany przez scripts/test-rls.sh
-- po rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

-- Punkt wyjścia: stan po 0215.
select pg_temp.assert(
  to_regclass('public.saved_search_alert_pauses') is not null
  and to_regprocedure('public.follow_company(uuid, text)') is not null
  and public.email_send_pool('followedCompanyJobs') = 'marketing'
  and position('suppressed_alert_paused' in pg_get_functiondef(
        'public.email_delivery_suppression_reason(uuid, text, text, uuid, text, uuid)'::regprocedure)) > 0,
  'PS969-R0 baza w stanie po 0215');
select id as ps_r_profile from public.profiles where role = 'candidate' limit 1 \gset
select count(*) as ps_r_searches from public.saved_searches where company_id is null \gset

begin;
-- Niewysłany digest obserwowanej firmy w kolejce w chwili rollbacku.
select public.enqueue_email(:'ps_r_profile', 'followedCompanyJobs', 'saved_search', gen_random_uuid(), 'ps969-r-1',
  '{"companyName":"Firma","count":1}'::jsonb);
select pg_temp.assert(exists (select 1 from public.email_deliveries where idempotency_key = 'ps969-r-1'),
  'PS969-R1a digest obserwowanej firmy zakolejkowany przed rollbackiem');
\ir ../rollback/0215_saved_search_pause_company_follow.down.sql
select pg_temp.assert(
  to_regclass('public.saved_search_alert_pauses') is null
  and to_regprocedure('public.set_saved_search_alerts_pause(date)') is null
  and to_regprocedure('public.follow_company(uuid, text)') is null
  and to_regprocedure('public.unfollow_company(uuid)') is null
  and to_regprocedure('public.get_my_followed_companies()') is null
  and not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'saved_searches' and column_name = 'company_id')
  and position('v_search.company_id' in pg_get_functiondef('public.process_saved_search_alerts(integer)'::regprocedure)) = 0
  and position('paused_until' in pg_get_functiondef('public.process_saved_search_alerts(integer)'::regprocedure)) = 0
  and (select count(*) from public.saved_searches) = :ps_r_searches,
  'PS969-R1 rollback usuwa pauzę i obserwacje, worker z 0138, zwykłe wyszukiwania zostają');
select pg_temp.assert(
  public.email_preference_category('followedCompanyJobs') is null
  and public.email_preference_category('jobMatch') = 'job_matches'
  and public.email_send_pool('followedCompanyJobs') = 'transactional'
  and public.email_send_pool('jobMatch') = 'marketing'
  and not exists (select 1 from public.email_deliveries where template = 'followedCompanyJobs' and status::text = 'queued'),
  'PS969-R2 rollback: szablon obserwacji poza kategoriami i pulami, niewysłane digesty usunięte');
select pg_temp.assert(
  position('suppressed_alert_paused' in pg_get_functiondef(
        'public.email_delivery_suppression_reason(uuid, text, text, uuid, text, uuid)'::regprocedure)) = 0
  and position('suppressed_feature_disabled' in pg_get_functiondef(
        'public.email_delivery_suppression_reason(uuid, text, text, uuid, text, uuid)'::regprocedure)) > 0
  and position('suppressed_alert_disabled' in pg_get_functiondef(
        'public.email_delivery_suppression_reason(uuid, text, text, uuid, text, uuid)'::regprocedure)) > 0
  and position('suppressed_unverified_address' in pg_get_functiondef(
        'public.email_delivery_suppression_reason(uuid, text, text, uuid, text, uuid)'::regprocedure)) > 0,
  'PS969-R3 rollback przywraca kolejkę z 0186 (bez pauzy, z trybem ogłoszeniowym, alertem i #1038)');
rollback;
select pg_temp.assert(
  to_regclass('public.saved_search_alert_pauses') is not null
  and to_regprocedure('public.follow_company(uuid, text)') is not null
  and public.email_send_pool('followedCompanyJobs') = 'marketing',
  'PS969-R4 rollback testu cofnięty');
\echo 'PS969-R rollback 0215: PASS'
