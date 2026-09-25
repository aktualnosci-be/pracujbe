-- =============================================================================
-- 0122_guest_status_notify.sql — #98 („Otwarte”): e-mail do gościa o zmianie statusu.
--
-- Aplikacja bez konta (0095) ma `candidate_id = NULL`, więc transition_application nie
-- miało komu wysłać powiadomienia. Od teraz gość dostaje e-mail `guestStatusChanged`.
--
-- 1. enqueue_guest_status_email(application, type, key, payload) — kolejkuje e-mail na
--    adres gościa tylko, gdy:
--      * aplikacja istnieje, nie jest usunięta (`deleted_at`), nadal nie ma konta
--        (`candidate_id is null`) i ma adres gościa;
--      * zgłoszenie gościa (`guest_application_requests`) istnieje, jest `confirmed` i wskazuje
--        tę aplikację (wyłącznie potwierdzone zgłoszenia; gdy ślad zgłoszenia usunie retencja
--        #486/#522, e-maila nie ma);
--      * adres nie ma aktywnej blokady (#44, `email_address_suppressed`); claim_email_batch
--        sprawdza blokadę ponownie przed wysyłką.
--    Język = `guest_application_requests.locale`, czyli język zapisany z formularza gościa.
--    Gość nie ma profilu (preferred/account/signup_locale), więc to jest jawnie zapisany
--    język ODBIORCY — zgodne z Invariantem #1 (nigdy język firmy/sesji/serwera; wartość
--    spoza obsługiwanych → 'en').
--    Wiersz kolejki: `entity_type = 'application'`, `entity_id = aplikacja` — retencja
--    zamkniętych aplikacji (0105, `closed_application`) usuwa go razem z aplikacją.
-- 2. transition_application (0095) — dla aplikacji gościa woła helper z kluczem
--    `appstatus-<aplikacja>-<id wiersza historii>` (ten sam format co u kandydata, 0073):
--    retry bez zmiany stanu nie tworzy drugiego e-maila, powrót do statusu = nowy wiersz
--    historii = nowy e-mail. Payload: imię i nazwisko gościa (powitanie), nazwa firmy,
--    tytuł oferty, status — żadnych innych danych firmy. Bez linku z tokenem: linki gościa
--    (potwierdzenie/przejęcie) się nie zmieniają.
--
-- Rollback: odtworzyć transition_application z 0095 i
--   drop function if exists public.enqueue_guest_status_email(uuid, text, text, jsonb);
--   (wiersze `guestStatusChanged` w email_deliveries mogą zostać — worker je wyśle albo
--   retencja usunie z aplikacją).
-- =============================================================================

-- --- 1. Kolejka e-mail o statusie na adres gościa ------------------------------------------
create or replace function public.enqueue_guest_status_email(
  p_application_id uuid,
  p_type text,
  p_idempotency_key text,
  p_payload jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email public.citext; v_locale text;
begin
  if p_type is distinct from 'guestStatusChanged' then
    raise exception 'VALIDATION_FAILED: nieznany typ e-maila gościa' using errcode = '42501';
  end if;

  select a.guest_email, g.locale into v_email, v_locale
    from public.applications a
    join public.guest_application_requests g
      on g.id = a.guest_request_id and g.application_id = a.id and g.status = 'confirmed'
   where a.id = p_application_id
     and a.candidate_id is null
     and a.deleted_at is null
     and a.guest_email is not null;
  if v_email is null then return; end if;

  if public.email_address_suppressed(v_email::text) then return; end if;

  insert into public.email_deliveries
    (profile_id, to_email, template, locale, subject, status, entity_type, entity_id,
     idempotency_key, payload, queued_at, next_attempt_at, attempts)
  values
    (null, v_email, p_type,
     case when public.is_supported_locale(v_locale) then v_locale else 'en' end,
     p_type, 'queued', 'application', p_application_id,
     p_idempotency_key, coalesce(p_payload, '{}'::jsonb), now(), now(), 0)
  on conflict (idempotency_key) where idempotency_key is not null
    do nothing;
end $$;
revoke all on function public.enqueue_guest_status_email(uuid, text, text, jsonb)
  from public, anon, authenticated;

-- --- 2. transition_application (0095) — e-mail do gościa -------------------------------------
create or replace function public.transition_application(
  p_application_id uuid,
  p_target text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_job uuid; v_candidate uuid; v_from public.application_status;
        v_to public.application_status; v_job_title text; v_company_name text; v_allowed boolean;
        v_history uuid; v_guest_name text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  if p_target is null or p_target not in ('viewed','shortlisted','interview','offer_sent','rejected','hired') then
    raise exception 'VALIDATION_FAILED: niedozwolony status docelowy' using errcode = '42501';
  end if;
  v_to := p_target::public.application_status;

  select a.job_id, a.candidate_id, a.status, j.title, c.name, a.guest_name
    into v_job, v_candidate, v_from, v_job_title, v_company_name, v_guest_name
    from public.applications a
    join public.jobs j on j.id = a.job_id
    join public.companies c on c.id = j.company_id
    where a.id = p_application_id
    for update of a;

  if v_job is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_job_manager(v_job) then
    raise exception 'PERMISSION_DENIED: zmiana statusu wymaga roli recruiter+' using errcode = '42501';
  end if;
  if v_from = v_to then return; end if; -- idempotencja (retry nie tworzy przejścia ani e-maila)

  v_allowed := case v_from
    when 'draft'       then v_to in ('viewed','shortlisted','interview','offer_sent','rejected')
    when 'submitted'   then v_to in ('viewed','shortlisted','interview','offer_sent','rejected')
    when 'viewed'      then v_to in ('shortlisted','interview','offer_sent','rejected','hired')
    when 'shortlisted' then v_to in ('interview','offer_sent','rejected','hired')
    when 'interview'   then v_to in ('shortlisted','offer_sent','rejected','hired')
    when 'offer_sent'  then v_to in ('hired','rejected')
    else false
  end;
  if not v_allowed then
    raise exception 'VALIDATION_FAILED: niedozwolone przejście statusu % -> %', v_from, v_to
      using errcode = '42501';
  end if;

  update public.applications set status = v_to, updated_at = now()
    where id = p_application_id and status = v_from;
  if not found then
    raise exception 'VALIDATION_FAILED: stan aplikacji zmienił się równolegle' using errcode = '42501';
  end if;

  select h.id into v_history
    from public.application_status_history h
    where h.application_id = p_application_id and h.from_status = v_from and h.to_status = v_to
    order by h.created_at desc, h.id desc
    limit 1;
  if v_history is null then
    raise exception 'INTERNAL: brak wpisu historii statusu' using errcode = 'P0001';
  end if;

  -- #98: aplikacja gościa (bez konta) — bez powiadomienia in-app (brak profilu), e-mail na
  -- adres gościa w języku jego formularza (warunki w enqueue_guest_status_email).
  if v_candidate is null then
    perform public.enqueue_guest_status_email(p_application_id, 'guestStatusChanged',
                                 'appstatus-' || p_application_id::text || '-' || v_history::text,
                                 jsonb_build_object('recipientName', coalesce(v_guest_name, ''),
                                                    'companyName', coalesce(v_company_name, ''),
                                                    'jobTitle', coalesce(v_job_title, ''),
                                                    'status', v_to::text));
    return;
  end if;

  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    values (v_candidate, 'application_status_changed', 'application_status_changed', 'application', p_application_id);

  if v_to = 'viewed' then
    perform public.enqueue_email(v_candidate, 'applicationViewed', 'application', p_application_id,
                                 'appstatus-' || p_application_id::text || '-' || v_history::text,
                                 jsonb_build_object('companyName', coalesce(v_company_name, ''),
                                                    'jobTitle', coalesce(v_job_title, '')));
  else
    perform public.enqueue_email(v_candidate, 'statusChanged', 'application', p_application_id,
                                 'appstatus-' || p_application_id::text || '-' || v_history::text,
                                 jsonb_build_object('companyName', coalesce(v_company_name, ''),
                                                    'jobTitle', coalesce(v_job_title, ''),
                                                    'status', v_to::text));
  end if;
end $$;
