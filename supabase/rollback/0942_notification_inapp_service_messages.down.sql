-- Rollback 0942 (#1120): przywraca filtr preferencji in-app z 0035 (ukrywa każde powiadomienie; search_path z pg_temp jak po 0067).
create or replace function public.filter_notification_by_preference()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_enabled boolean;
begin
  select in_app_enabled into v_enabled
  from public.notification_preferences
  where profile_id = new.profile_id;

  if v_enabled is false then
    return null;
  end if;
  return new;
end $$;

drop function if exists public.notification_inapp_required(text, jsonb);
