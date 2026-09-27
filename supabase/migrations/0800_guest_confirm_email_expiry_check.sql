-- =============================================================================
-- 0800 (numer tymczasowy — nadany ostatecznie przez integratora) — #822: kolejka nie
-- wysyła wygasłego linku potwierdzenia aplikacji gościa.
--
-- Problem: `confirm_guest_application` odrzuca link po `confirm_expires_at` (48 h od
-- ostatniego wysłania — 0095), ale `email_delivery_suppression_reason`/`claim_email_batch`/
-- `email_delivery_send_check` (0124/0129/0131) nie znały tej kolumny. Zaległy wiersz
-- `guestApplicationConfirm` (worker padł/cron się spóźnił) mógł więc zostać wysłany PO
-- upływie 48 h — odbiorca dostawał CTA prowadzące od razu do wyniku `expired`, bez żadnej
-- możliwości dokończenia aplikacji z tego e-maila.
--
-- Naprawa: nowy warunek w `email_delivery_suppression_reason` — dla
-- `template = 'guestApplicationConfirm'` (`entity_type = 'guest_application_request'`)
-- sprawdza, czy powiązane zgłoszenie WCIĄŻ jest `pending` i `confirm_expires_at` jeszcze nie
-- minął. Funkcja jest już wołana w DWÓCH miejscach cyklu życia wiersza: `claim_email_batch`
-- (zaraz po `queued`) i `email_delivery_send_check` (tuż przed wywołaniem dostawcy, #621) —
-- jedna zmiana zamyka lukę w obu punktach bez zmian w `src/lib/email/outbox.ts`. Wiersz
-- niedozwolony jest wygaszany jak każda inna przyczyna (status `failed`, `suppressed_at`,
-- `error_message = 'suppressed_guest_confirm_expired'`) — ślad zostaje, retencja #486/GA98-12
-- usuwa go razem ze zgłoszeniem. Status inny niż `pending` (już `confirmed`/`duplicate`)
-- też wygasza wysyłkę — ponowne potwierdzenie niczego by nie zmieniło (`confirm_guest_application`
-- zwraca `already_confirmed`/`duplicate`), więc nie ma sensu wysyłać spóźnionego linku.
-- Zgłoszenie USUNIĘTE (retencja/purge) → `not exists` → też wygaszone (nie ma czego wysyłać).
--
-- Świadomie NIE dotyczy `guestApplicationSent` (link przejęcia, 30 dni, #914 — osobne
-- zgłoszenie o ODZYSKANIU wygasłego linku przejęcia, inny zakres) ani innych szablonów.
--
-- Rollback: przywrócić `email_delivery_suppression_reason` z 0124 (bez tego warunku).
-- =============================================================================

create or replace function public.email_delivery_suppression_reason(
  p_profile_id uuid,
  p_template text,
  p_to_email text,
  p_campaign_id uuid,
  p_entity_type text,
  p_entity_id uuid
) returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when public.email_address_suppressed(p_to_email) then 'suppressed_address'
    when public.email_allowed(p_profile_id, p_template) is not true then 'suppressed_opt_out'
    -- 0122 (#503): odbiorca firmowy musi nadal być aktywnym recruiter+ w chwili claimu/wysyłki.
    when public.email_recipient_authorized(p_template, p_entity_type, p_entity_id, p_profile_id)
           is not true then 'suppressed_recipient_unauthorized'
    when p_template = 'jobMatch' and p_entity_type = 'saved_search' and not exists (
           select 1 from public.saved_searches s
            where s.id = p_entity_id
              and s.profile_id is not distinct from p_profile_id
              and s.alerts_enabled) then 'suppressed_alert_disabled'
    -- #822: link potwierdzenia aplikacji gościa wygasa po 48 h (0095); nie wysyłaj wiersza,
    -- którego zgłoszenie już nie jest `pending` w tym oknie (wygasłe, rozstrzygnięte albo
    -- usunięte retencją) — odbiorca dostałby CTA prowadzące wprost do `expired`.
    when p_template = 'guestApplicationConfirm' and p_entity_type = 'guest_application_request'
         and not exists (
           select 1 from public.guest_application_requests r
            where r.id = p_entity_id
              and r.status = 'pending'
              and r.confirm_expires_at > now()) then 'suppressed_guest_confirm_expired'
    when p_campaign_id is not null and not exists (
           select 1 from public.email_campaigns c
            where c.id = p_campaign_id and c.status in ('active', 'completed'))
      then 'suppressed_campaign_inactive'
    else null
  end;
$$;
revoke all on function public.email_delivery_suppression_reason(uuid, text, text, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.email_delivery_suppression_reason(uuid, text, text, uuid, text, uuid)
  to service_role;
