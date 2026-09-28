-- =============================================================================
-- 0960 (numer TYMCZASOWY — ostateczny nada integrator) — tryb ogłoszeniowy: wiadomości
-- i CV (#1134, #1138; epik #1128). Uzupełnia 0171 (`portal_legal_mode`,
-- `recruitment_enabled()`, `recruitment_write_allowed()`), bez powtarzania jej strażników.
--
-- Decyzja produktowa: portal ogłoszeniowy. Kontakt kandydata z ogłoszeniodawcą odbywa się
-- kanałem z ogłoszenia, poza portalem; portal nie przyjmuje CV i ich nie analizuje.
--
-- Co JUŻ blokuje 0171 (tu bez zmian): BEFORE INSERT na `conversations`/`messages`/
-- `message_attachments` (każde RPC rozmów, także SECURITY DEFINER z innych ścieżek), strona
-- firmowa bez dostępu do rozmów (`is_conversation_member`), `can_attach_in_conversation` = false.
--
-- Nowe w tej migracji:
-- 1. Kolejka e-mail: `email_delivery_suppression_reason` (ostatnio 0124) wygasza list
--    `newMessage` w trybie ogłoszeniowym (`suppressed_recruitment_disabled`) — także wiersze,
--    które trafiły do kolejki przed zmianą trybu. Działa w `claim_email_batch` i
--    `email_delivery_send_check` (obie wołają tę funkcję), bez zmiany ich treści.
-- 2. Pliki CV: BEFORE INSERT/UPDATE na `files` odrzuca NOWY plik CV kandydata
--    (`entity_type = 'candidate_cv'` albo bucket `candidate-files`) → `RECRUITMENT_DISABLED`,
--    dla każdej roli (także service_role); wyjątek seedu/testów jak w 0171
--    (`recruitment_write_allowed()`). Odczyt, pobranie i usunięcie istniejących własnych
--    plików bez zmian (prawa do danych).
-- 3. Import CV przez AI: `apply_candidate_cv_proposals` (0115) zamienione na cienką nakładkę
--    ze strażnikiem trybu PRZED jakimkolwiek zapisem (także przed `ensure_candidate_profile`);
--    dotychczasowa treść przeniesiona bez zmian do `apply_candidate_cv_proposals_impl`
--    (bez EXECUTE dla klientów). Sygnatura i granty publicznej funkcji bez zmian.
--
-- Rollback: supabase/rollback/0960_classifieds_messaging_cv_off.down.sql.
-- =============================================================================

-- --- 1. Kolejka e-mail: newMessage wygaszany w trybie ogłoszeniowym -----------------------------
create or replace function public.email_delivery_suppression_reason(
  p_profile_id uuid,
  p_template text,
  p_to_email text,
  p_campaign_id uuid,
  p_entity_type text,
  p_entity_id uuid
) returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    -- 0960 (#1134): rozmowy wyłączone w trybie ogłoszeniowym — list o wiadomości nie wychodzi.
    when p_template = 'newMessage' and not public.recruitment_enabled()
      then 'suppressed_recruitment_disabled'
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

-- --- 2. Pliki CV: brak nowych plików w trybie ogłoszeniowym ----------------------------------
create or replace function public.enforce_recruitment_cv_file()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.recruitment_write_allowed() then return new; end if;
  if (new.entity_type = 'candidate_cv' or new.bucket = 'candidate-files')
     and (tg_op = 'INSERT'
          or old.entity_type is distinct from new.entity_type
          or old.bucket is distinct from new.bucket
          or old.path is distinct from new.path) then
    raise exception 'RECRUITMENT_DISABLED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.enforce_recruitment_cv_file() from public, anon, authenticated;

-- `trg_aa_*`: BEFORE-triggery tabeli idą alfabetycznie — strażnik trybu pierwszy (jak 0171).
drop trigger if exists trg_aa_recruitment_mode_cv on public.files;
create trigger trg_aa_recruitment_mode_cv before insert or update on public.files
  for each row execute function public.enforce_recruitment_cv_file();

-- --- 3. Import CV przez AI: strażnik trybu przed zapisem --------------------------------------
alter function public.apply_candidate_cv_proposals(text[], text[], jsonb, text[], integer)
  rename to apply_candidate_cv_proposals_impl;
revoke all on function public.apply_candidate_cv_proposals_impl(text[], text[], jsonb, text[], integer)
  from public, anon, authenticated;

create function public.apply_candidate_cv_proposals(
  p_occupations text[],
  p_skills text[],
  p_languages jsonb,
  p_certificates text[],
  p_experience_years integer
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- 0960 (#1138): tryb ogłoszeniowy — bez zapisu propozycji z CV (także bez tworzenia profilu).
  perform public.assert_recruitment_enabled();
  return public.apply_candidate_cv_proposals_impl(
    p_occupations, p_skills, p_languages, p_certificates, p_experience_years);
end $$;
revoke all on function public.apply_candidate_cv_proposals(text[], text[], jsonb, text[], integer) from public, anon;
grant execute on function public.apply_candidate_cv_proposals(text[], text[], jsonb, text[], integer) to authenticated;
