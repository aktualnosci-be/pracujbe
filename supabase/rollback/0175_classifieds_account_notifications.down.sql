-- =============================================================================
-- Rollback 0175 (#1142, #1145) — przywraca definicje sprzed trybu ogłoszeniowego konta
-- i komunikacji. Dane bez zmian (migracja ich nie dotyka).
-- Kolejność: przed rollbackiem 0171 (triggery korzystają z `enforce_recruitment_insert`).
-- =============================================================================

-- 1. Profil zawodowy: triggery trybu i treść `ensure_candidate_profile` z 0040.
do $$
declare t text;
begin
  foreach t in array array['candidate_profiles', 'candidate_skills', 'candidate_languages',
                           'candidate_certificates'] loop
    execute format('drop trigger if exists trg_aa_recruitment_mode on public.%I', t);
  end loop;
end $$;
drop trigger if exists trg_aa_recruitment_mode_update on public.candidate_profiles;
drop function if exists public.enforce_candidate_profile_update();

create or replace function public.ensure_candidate_profile()
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cp uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  -- P1-04: tylko konto kandydata może mieć/tworzyć profil kandydata (model ról).
  if public.current_profile_role() <> 'candidate' then
    raise exception 'PERMISSION_DENIED: profil kandydata tylko dla konta kandydata' using errcode = '42501';
  end if;
  insert into public.candidate_profiles(profile_id) values (auth.uid())
    on conflict (profile_id) do nothing;
  select id into v_cp from public.candidate_profiles where profile_id = auth.uid();
  return v_cp;
end $$;
revoke all on function public.ensure_candidate_profile() from public;

-- 2. Powiadomienia in-app.
drop trigger if exists trg_aa_recruitment_mode on public.notifications;
drop function if exists public.skip_recruitment_notification();
drop function if exists public.notification_is_recruitment(text, text);

-- 3. Kolejka e-mail: przyczyny wygaszenia z 0124.
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

drop function if exists public.email_recruitment_template(text);
