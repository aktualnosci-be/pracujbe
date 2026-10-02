-- =============================================================================
-- 0221_notification_inapp_service_messages.sql (numer tymczasowy — ostateczny nada integrator)
-- #1120 (audyt 2026-09-28, NOTIF-04): preferencja „Powiadomienia w aplikacji” (0035) ukrywała
--   KAŻDE powiadomienie, także decyzje administratora, które nie mają żadnego e-maila:
--   zatwierdzenie/odrzucenie strony WWW i logo firmy (0156), opisu firmy (0198/0201) i treści
--   oferty (0167). Kto wyłączył powiadomienia w panelu, licząc na e-mail, nie dowiadywał się
--   o tych decyzjach żadnym kanałem.
--
-- Naprawa: wiadomości serwisowe tylko w panelu (lista w `notification_inapp_required`, lustro
--   `src/lib/notifications/service-messages.ts`, test zgodności) omijają tę preferencję —
--   jak e-maile konta, których nie wyłącza się w ustawieniach. Pozostałe powiadomienia bez
--   zmian (wyłączenie działa). Ustawienia opisują, których komunikatów to nie dotyczy.
--   Powiadomienia procesu rekrutacyjnego nadal pomija trigger trybu (0175, `trg_aa_…` przed tym).
--
-- Rollback: supabase/rollback/0221_notification_inapp_service_messages.down.sql.
-- =============================================================================

create or replace function public.notification_inapp_required(p_type text, p_data jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_type = 'system'
     and coalesce(p_data ->> 'kind', '') in ('company_links', 'company_description', 'job_content_review');
$$;
revoke all on function public.notification_inapp_required(text, jsonb) from public, anon, authenticated;
grant execute on function public.notification_inapp_required(text, jsonb) to service_role;

create or replace function public.filter_notification_by_preference()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_enabled boolean;
begin
  -- #1120: decyzje bez odpowiednika e-mail zawsze trafiają do panelu.
  if public.notification_inapp_required(new.type::text, new.data) then
    return new;
  end if;

  select in_app_enabled into v_enabled
  from public.notification_preferences
  where profile_id = new.profile_id;

  -- Wyłączone in-app → pomijamy insert (BEFORE INSERT return null). Brak wiersza / true → wstawiamy.
  if v_enabled is false then
    return null;
  end if;
  return new;
end $$;
