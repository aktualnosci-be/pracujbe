-- =============================================================================
-- 0175 — konto bez profilu zawodowego i komunikacja bez zdarzeń rekrutacyjnych
-- (#1142, #1145; epik #1128).
--
-- Decyzja produktowa: portal ogłoszeniowy. W trybie `CLASSIFIEDS_ONLY` (0171,
-- `recruitment_enabled()` = false) konto kandydata służy do zapisanych ofert, zapisanych
-- wyszukiwań i ustawień; powiadomienia i e-maile dotyczą tylko ogłoszeń. Tabele i funkcje
-- zostają (bez DROP) — są tylko wyłączone; tryb `RECRUITMENT` przywraca pełne działanie.
--
-- 1. Profil zawodowy (#1142):
--    * `ensure_candidate_profile()` (0040) + strażnik trybu. Każde RPC profilu zawodowego
--      woła go na początku — `save_candidate_onboarding_step3/5` (0082),
--      `set_candidate_skills/languages/certificates` (0028/0079/0168), `finish_onboarding`
--      (0029), `set_candidate_searchable` (0100), `apply_candidate_cv_proposals` (0115) —
--      więc wszystkie dostają `RECRUITMENT_DISABLED` bez przepisywania ich treści
--      (strażnik nie znika, gdy późniejsza migracja podmieni treść RPC).
--    * BEFORE INSERT na `candidate_profiles`, `candidate_skills`, `candidate_languages`,
--      `candidate_certificates` (funkcja `enforce_recruitment_insert()` z 0171) — każda
--      ścieżka, także service_role; wyjątek seedu/testów superusera jak w 0171.
--    * BEFORE UPDATE na `candidate_profiles` dla ról klienta (authenticated/anon —
--      bezpośredni zapis kroków kreatora pod RLS): zmiana jakiejkolwiek kolumny poza
--      wyłączeniem widoczności (is_searchable true → false, searchable_changed_at),
--      updated_at i deleted_at → `RECRUITMENT_DISABLED`. Ścieżki serwerowe (retencja,
--      próg wieku, usunięcie konta) działają bez zmian.
-- 2. Powiadomienia in-app (#1145): BEFORE INSERT na `notifications` — w trybie ogłoszeniowym
--    pomija (return null, bez błędu, żeby transakcja źródłowa — np. edycja oferty z 0144 —
--    nie padła) typy `application_*`, `offer_*`, `message_received`, encje `application`,
--    `offer`, `conversation`, `job_terms` oraz `job_match` spoza alertu zapisanego
--    wyszukiwania (`entity_type <> 'saved_search'`).
-- 3. Kolejka e-mail (#1145): `email_recruitment_template(text)` — jedna lista szablonów
--    procesu rekrutacyjnego (lustro TS: `src/lib/email/recruitment-templates.ts`, test
--    zgodności). `email_delivery_suppression_reason` (0124) dostaje pierwszą przyczynę
--    `suppressed_feature_disabled`; korzystają z niej `claim_email_batch` (0124) i
--    `email_delivery_send_check` (0131), więc wygaszane są także wiersze już w kolejce.
--
-- Rollback: supabase/rollback/0175_classifieds_account_notifications.down.sql.
-- =============================================================================

-- --- 1. Profil zawodowy ----------------------------------------------------------------------
-- 0040 + strażnik trybu (jedyna zmiana: pierwsze sprawdzenie).
create or replace function public.ensure_candidate_profile()
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cp uuid;
begin
  -- #1142: tryb ogłoszeniowy — konto nie buduje profilu zawodowego.
  if not public.recruitment_write_allowed() then
    raise exception 'RECRUITMENT_DISABLED' using errcode = '42501';
  end if;
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

do $$
declare t text;
begin
  foreach t in array array['candidate_profiles', 'candidate_skills', 'candidate_languages',
                           'candidate_certificates'] loop
    execute format('drop trigger if exists trg_aa_recruitment_mode on public.%I', t);
    execute format('create trigger trg_aa_recruitment_mode before insert on public.%I
                    for each row execute function public.enforce_recruitment_insert()', t);
  end loop;
end $$;

create or replace function public.enforce_candidate_profile_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_kept constant text[] := array['is_searchable', 'searchable_changed_at', 'updated_at', 'deleted_at'];
begin
  -- SECURITY INVOKER (jak guard 0029): trigger widzi REALNĄ rolę. Gejtujemy tylko klienta
  -- (bezpośredni zapis kroków kreatora pod RLS); RPC profilu blokuje `ensure_candidate_profile`,
  -- a ścieżki serwerowe (retencja, próg wieku, usunięcie konta) działają bez zmian.
  if current_user not in ('authenticated', 'anon') or public.recruitment_enabled() then
    return new;
  end if;
  if (to_jsonb(new) - v_kept) is distinct from (to_jsonb(old) - v_kept)
     or (new.is_searchable and not old.is_searchable) then
    raise exception 'RECRUITMENT_DISABLED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.enforce_candidate_profile_update() from public;
drop trigger if exists trg_aa_recruitment_mode_update on public.candidate_profiles;
create trigger trg_aa_recruitment_mode_update before update on public.candidate_profiles
  for each row execute function public.enforce_candidate_profile_update();

-- --- 2. Powiadomienia in-app -----------------------------------------------------------------
create or replace function public.notification_is_recruitment(
  p_type text,
  p_entity_type text
) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_type in ('application_received', 'application_status_changed', 'offer_received',
                    'offer_status_changed', 'message_received')
      or coalesce(p_entity_type, '') in ('application', 'offer', 'conversation', 'job_terms')
      or (p_type = 'job_match' and p_entity_type is distinct from 'saved_search');
$$;
revoke all on function public.notification_is_recruitment(text, text) from public, anon, authenticated;
grant execute on function public.notification_is_recruitment(text, text) to service_role;

create or replace function public.skip_recruitment_notification()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.recruitment_write_allowed()
     and public.notification_is_recruitment(new.type::text, new.entity_type) then
    return null;  -- pominięcie bez błędu (transakcja źródłowa trwa dalej)
  end if;
  return new;
end $$;
revoke all on function public.skip_recruitment_notification() from public, anon, authenticated;
-- `trg_aa_*`: przed filtrem preferencji (0035) — BEFORE-triggery idą alfabetycznie.
drop trigger if exists trg_aa_recruitment_mode on public.notifications;
create trigger trg_aa_recruitment_mode before insert on public.notifications
  for each row execute function public.skip_recruitment_notification();

-- --- 3. Kolejka e-mail -----------------------------------------------------------------------
-- Lustro TS: src/lib/email/recruitment-templates.ts (RECRUITMENT_EMAIL_TEMPLATES).
create or replace function public.email_recruitment_template(p_template text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_template, '') = any (array[
    'newApplication', 'applicationViewed', 'statusChanged', 'jobOffer', 'offerAccepted',
    'offerDeclined', 'newMessage', 'guestApplicationConfirm', 'guestApplicationSent',
    'guestStatusChanged'
  ]);
$$;
revoke all on function public.email_recruitment_template(text) from public, anon, authenticated;
grant execute on function public.email_recruitment_template(text) to service_role;

-- 0124 + pierwsza przyczyna `suppressed_feature_disabled` (reszta bez zmian).
create or replace function public.email_delivery_suppression_reason(
  p_profile_id uuid,
  p_template text,
  p_to_email text,
  p_campaign_id uuid,
  p_entity_type text,
  p_entity_id uuid
) returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    -- #1145: tryb ogłoszeniowy — e-maile procesu rekrutacyjnego nie wychodzą.
    when not public.recruitment_enabled() and public.email_recruitment_template(p_template)
      then 'suppressed_feature_disabled'
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
