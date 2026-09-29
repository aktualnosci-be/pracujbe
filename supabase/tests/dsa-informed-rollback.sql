-- =============================================================================
-- DSA960-R — rollback migracji 0188 (paczka M-1). Uruchamiany przez scripts/test-rls.sh
-- po rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

-- Stan przed: migracja 0188 obowiązuje.
select pg_temp.assert(
  to_regclass('public.moderation_informed') is not null
  and position('moderation_informed' in pg_get_functiondef('public.moderation_informed_at(uuid)'::regprocedure)) > 0
  and position('report-email' in pg_get_functiondef(
        'public.submit_content_report(uuid, uuid, text, text, uuid, text, text, text, text, text, text, boolean)'::regprocedure)) > 0
  and exists (select 1 from pg_trigger where tgname = 'trg_email_deliveries_scrub_access_code')
  and position('''verified'', ''rejected'', ''suspended''' in pg_get_functiondef(
        'public.admin_set_company_status(uuid, text, text, text)'::regprocedure)) > 0,
  'DSA960-R0 przed rollbackiem obowiązuje migracja 0188');

begin;
\ir ../rollback/0188_dsa_informed_limits.down.sql
select pg_temp.assert(
  to_regclass('public.moderation_informed') is null
  and to_regprocedure('public.moderation_record_informed(text, uuid, text, timestamptz, uuid)') is null
  and to_regprocedure('public.moderation_subject_deliveries(text, uuid)') is null
  and not exists (select 1 from pg_trigger where tgname in (
        'trg_email_deliveries_scrub_access_code', 'trg_email_deliveries_track_moderation_informed',
        'trg_moderation_decisions_informed_no_recipient', 'trg_moderation_restorations_informed_no_recipient'))
  and to_regclass('public.reports_dsa_open_uq') is null,
  'DSA960-R1 rollback usuwa tabelę, triggery, funkcje pomocnicze i indeks');
select pg_temp.assert(
  -- terminy wracają do wyprowadzania z poczty i powiadomień (0104/0109)
  position('email_deliveries' in pg_get_functiondef('public.moderation_informed_at(uuid)'::regprocedure)) > 0
  and position('notifications' in pg_get_functiondef('public.moderation_informed_at(uuid)'::regprocedure)) > 0
  and position('email_deliveries' in pg_get_functiondef('public.moderation_restoration_informed_at(uuid)'::regprocedure)) > 0
  and position('informedByFallback' in pg_get_functiondef('public.dsa_retention_report()'::regprocedure)) = 0
  and position('moderation_informed' in pg_get_functiondef('public.get_company_moderation_decisions(uuid)'::regprocedure)) = 0
  -- zgłoszenie bez blokady per adres, macierz firmy jak w 0084
  and position('report-email' in pg_get_functiondef(
        'public.submit_content_report(uuid, uuid, text, text, uuid, text, text, text, text, text, text, boolean)'::regprocedure)) = 0
  and position('''verified'', ''rejected'', ''suspended''' in pg_get_functiondef(
        'public.admin_set_company_status(uuid, text, text, text)'::regprocedure)) = 0,
  'DSA960-R2 rollback przywraca definicje z 0084/0094/0104/0109');
-- Kontrola ujemna zachowania: po rollbacku zawieszenie firmy pending znów jest niedozwolone.
insert into public.companies(id, name, status) values ('e9960000-0000-0000-0000-0000000000f9', 'Rollback D960', 'pending');
set local role authenticated;
set local app.current_uid = '77777777-7777-7777-7777-777777777777';
do $$
begin
  begin
    perform public.admin_set_company_status('e9960000-0000-0000-0000-0000000000f9'::uuid, 'suspended', 'pending', 'Powód zawieszenia testowy.');
    raise exception 'ASSERT FAILED: DSA960-R4 po rollbacku pending -> suspended powinno być odrzucone';
  exception when others then
    if sqlerrm not like '%INVALID_TRANSITION%' then raise; end if;
  end;
end $$;
reset role;
rollback;
select pg_temp.assert(
  to_regclass('public.moderation_informed') is not null
  and exists (select 1 from pg_trigger where tgname = 'trg_email_deliveries_scrub_access_code')
  and position('report-email' in pg_get_functiondef(
        'public.submit_content_report(uuid, uuid, text, text, uuid, text, text, text, text, text, text, boolean)'::regprocedure)) > 0,
  'DSA960-R3 po cofnięciu transakcji migracja 0188 zostaje');
\echo '=================== 0188 ROLLBACK OK ==================='
