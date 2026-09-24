-- =============================================================================
-- 0081_admin_transitions.sql
-- RPC panelu administratora: macierz przejść, kontrola nieaktualnego widoku (#420).
--
-- 1. admin_set_company_status(p_company_id, p_status, p_expected_status):
--    * macierz przejść (ta sama co w UI, CompanyStatusActions):
--        unverified/pending → verified | rejected
--        verified           → suspended
--        rejected           → verified
--        suspended          → verified
--      inne (także „na ten sam status” i → unverified/pending) → INVALID_TRANSITION;
--    * FOR UPDATE + p_expected_status: gdy bieżący status różni się od widzianego przez
--      admina (inny admin zdążył go zmienić) → STALE_STATE (nic się nie zmienia);
--    * firma usunięta miękko (deleted_at) → NOT_FOUND;
--    * verified_at/verified_by ustawiane tylko przy faktycznym przejściu do verified
--      (ponowna weryfikacja nie nadpisuje daty — przejście verified → verified jest niedozwolone).
-- 2. admin_resolve_report(p_report_id, p_status, p_expected_status):
--        open      → reviewing | resolved | dismissed
--        reviewing → resolved | dismissed
--        resolved/dismissed → reviewing (ponowne otwarcie)
--      FOR UPDATE + STALE_STATE jak wyżej; ponowne otwarcie CZYŚCI resolved_by/resolved_at
--      (historia decyzji zostaje w audit_logs).
--
-- p_expected_status jest opcjonalny (default null = bez kontroli CAS) dla wywołań
-- serwerowych/skryptów; UI zawsze go przekazuje. Stare sygnatury (uuid, text) usunięte —
-- nowa z wartością domyślną obsługuje te same wywołania dwuargumentowe.
--
-- Rollback: drop function admin_set_company_status(uuid, text, text),
-- admin_resolve_report(uuid, text, text); odtworzyć wersje z 0019_admin.sql.
-- =============================================================================

drop function if exists public.admin_set_company_status(uuid, text);
drop function if exists public.admin_resolve_report(uuid, text);

create or replace function public.admin_set_company_status(
  p_company_id uuid,
  p_status text,
  p_expected_status text default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_to public.company_status;
  v_expected public.company_status;
  v_from public.company_status;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;

  begin
    v_to := p_status::public.company_status;
    v_expected := p_expected_status::public.company_status;
  exception when invalid_text_representation then
    raise exception 'VALIDATION_FAILED: nieznany status firmy' using errcode = '22023';
  end;

  select status into v_from
    from public.companies
    where id = p_company_id and deleted_at is null
    for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  if v_expected is not null and v_expected is distinct from v_from then
    raise exception 'STALE_STATE: status firmy zmienił się (% zamiast %)', v_from, v_expected;
  end if;

  if not (
    (v_from in ('unverified', 'pending') and v_to in ('verified', 'rejected'))
    or (v_from = 'verified' and v_to = 'suspended')
    or (v_from in ('rejected', 'suspended') and v_to = 'verified')
  ) then
    raise exception 'INVALID_TRANSITION: % -> %', v_from, v_to using errcode = '22023';
  end if;

  update public.companies
    set status = v_to,
        verified_at = case when v_to = 'verified' then now() else verified_at end,
        verified_by = case when v_to = 'verified' then auth.uid() else verified_by end,
        updated_at = now()
    where id = p_company_id;
end $$;
revoke all on function public.admin_set_company_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_company_status(uuid, text, text) to authenticated;

create or replace function public.admin_resolve_report(
  p_report_id uuid,
  p_status text,
  p_expected_status text default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_to public.report_status;
  v_expected public.report_status;
  v_from public.report_status;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;

  begin
    v_to := p_status::public.report_status;
    v_expected := p_expected_status::public.report_status;
  exception when invalid_text_representation then
    raise exception 'VALIDATION_FAILED: nieznany status zgłoszenia' using errcode = '22023';
  end;

  select status into v_from from public.reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  if v_expected is not null and v_expected is distinct from v_from then
    raise exception 'STALE_STATE: status zgłoszenia zmienił się (% zamiast %)', v_from, v_expected;
  end if;

  if not (
    (v_from = 'open' and v_to in ('reviewing', 'resolved', 'dismissed'))
    or (v_from = 'reviewing' and v_to in ('resolved', 'dismissed'))
    or (v_from in ('resolved', 'dismissed') and v_to = 'reviewing')
  ) then
    raise exception 'INVALID_TRANSITION: % -> %', v_from, v_to using errcode = '22023';
  end if;

  update public.reports
    set status = v_to,
        resolved_by = case when v_to in ('resolved', 'dismissed') then auth.uid() else null end,
        resolved_at = case when v_to in ('resolved', 'dismissed') then now() else null end,
        updated_at = now()
    where id = p_report_id;

  -- Przed → po (jak triggery audytu 0017), czytelne w dzienniku zdarzeń panelu (#417).
  perform public.write_audit('report.resolved', 'report', p_report_id,
                             jsonb_build_object('status', v_from::text),
                             jsonb_build_object('status', v_to::text));
end $$;
revoke all on function public.admin_resolve_report(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_report(uuid, text, text) to authenticated;
