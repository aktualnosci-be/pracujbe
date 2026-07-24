-- =============================================================================
-- 0035_notification_inapp_optout.sql
-- Remediacja audytu 2026-07-24 — SEC-16 (P2): `in_app_enabled` było zapisywane, ale RPC
--   wstawiały powiadomienia in-app bez sprawdzenia preferencji — użytkownik wyłączał
--   powiadomienia, a system i tak je tworzył.
--
-- Naprawa CENTRALNA (bez przepisywania każdego RPC): trigger BEFORE INSERT na notifications,
-- który pomija wstawienie, gdy odbiorca ma in_app_enabled=false. Brak wiersza preferencji =
-- domyślnie włączone (kolumna default true). Analogicznie do opt-outu e-mail w enqueue_email.
-- =============================================================================

create or replace function public.filter_notification_by_preference()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_enabled boolean;
begin
  select in_app_enabled into v_enabled
  from public.notification_preferences
  where profile_id = new.profile_id;

  -- Wyłączone in-app → pomijamy insert (BEFORE INSERT return null). Brak wiersza / true → wstawiamy.
  if v_enabled is false then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists trg_filter_notification_by_preference on public.notifications;
create trigger trg_filter_notification_by_preference
  before insert on public.notifications
  for each row execute function public.filter_notification_by_preference();
