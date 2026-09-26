-- =============================================================================
-- 0208 — wynik zgłoszenia wiadomości/rozmowy dla zgłaszającego (Etap 5, „Wiadomości:
-- zgłoszenia”, otwarte z 0116: powiadomienie zgłaszającego o wyniku).
--
-- NUMER TYMCZASOWY — ostateczny nada integrator (kolejka migracji).
--
-- Gdy administrator rozstrzyga zgłoszenie `reports.kind = 'message_report'` przez
-- `admin_resolve_report` (0081) na `resolved` albo `dismissed`, w tej samej transakcji:
--   1. zgłaszający dostaje powiadomienie in-app (`system`, `data.kind = 'message_report'`,
--      `data.outcome`, `data.targetType`, `data.reportId`; encja = rozmowa → link do wątku),
--   2. e-mail `messageReportResolved` / `messageReportDismissed` przez `enqueue_email` — język
--      wyznacza `resolve_recipient_locale` ODBIORCY (Invariant #1), nie sesja administratora.
-- Tylko wynik: bez dowodu (`target_snapshot`), opisu, kategorii i danych drugiej strony.
-- Payload: `panel` (strona zgłaszającego z dowodu zbudowanego w bazie), `targetType`,
-- `conversationId` (CTA do wątku) — worker przepuszcza tylko pola z `payload-fields.ts`.
--
-- Idempotencja: klucz e-maila = `message-report-outcome-<id zgłoszenia>-<status>`; powiadomienie
-- in-app tylko, gdy nie ma już powiadomienia z tym samym zgłoszeniem i wynikiem. Ponowne
-- otwarcie i to samo rozstrzygnięcie = brak drugiego listu i drugiego powiadomienia; zmiana
-- wyniku (resolved ↔ dismissed) = nowa informacja. Zgłaszający bez konta (FK → null) albo
-- z usuniętym profilem — nic nie wychodzi. Druga strona rozmowy nie dostaje niczego.
-- Inne rodzaje zgłoszeń (`quality`, `dsa_notice`) bez zmian.
--
-- Rollback: odtworzyć `admin_resolve_report(uuid, text, text)` z 0081_admin_transitions.sql;
-- drop function public.notify_message_report_outcome(uuid). Wiersze kolejki i powiadomień
-- zostają (ślad wysyłki).
-- =============================================================================

create or replace function public.notify_message_report_outcome(p_report_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_report   record;
  v_outcome  text;
  v_panel    text;
begin
  select r.id, r.kind, r.status::text as status, r.reporter_id, r.conversation_id,
         r.target_type::text as target_type,
         r.target_snapshot -> 'conversation' ->> 'reporterSide' as reporter_side
    into v_report
    from public.reports r
   where r.id = p_report_id;
  if not found or v_report.kind is distinct from 'message_report' then return; end if;
  if v_report.status not in ('resolved', 'dismissed') then return; end if;
  if v_report.reporter_id is null or not exists (
       select 1 from public.profiles p where p.id = v_report.reporter_id and p.deleted_at is null) then
    return;
  end if;

  v_outcome := v_report.status;
  v_panel := case when v_report.reporter_side = 'company' then 'employer' else 'candidate' end;

  if not exists (
       select 1 from public.notifications n
        where n.profile_id = v_report.reporter_id
          and n.data ->> 'kind' = 'message_report'
          and n.data ->> 'reportId' = v_report.id::text
          and n.data ->> 'outcome' = v_outcome) then
    insert into public.notifications (profile_id, type, title, entity_type, entity_id, data)
      values (v_report.reporter_id, 'system'::public.notification_type, 'message_report_outcome',
              'conversation', v_report.conversation_id,
              jsonb_build_object('kind', 'message_report', 'outcome', v_outcome,
                                 'targetType', v_report.target_type, 'reportId', v_report.id));
  end if;

  perform public.enqueue_email(v_report.reporter_id,
    case when v_outcome = 'resolved' then 'messageReportResolved' else 'messageReportDismissed' end,
    'report', v_report.id,
    'message-report-outcome-' || v_report.id::text || '-' || v_outcome,
    jsonb_build_object(
      'panel', v_panel,
      'targetType', v_report.target_type,
      'conversationId', v_report.conversation_id));
end $$;
revoke all on function public.notify_message_report_outcome(uuid) from public, anon, authenticated;

-- admin_resolve_report = wersja z 0081 + powiadomienie zgłaszającego (tylko message_report).
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

  -- 0208: zgłaszający wiadomość/rozmowę dowiaduje się o wyniku (in-app + e-mail w swoim języku).
  if v_to in ('resolved', 'dismissed') then
    perform public.notify_message_report_outcome(p_report_id);
  end if;
end $$;
revoke all on function public.admin_resolve_report(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_report(uuid, text, text) to authenticated;
