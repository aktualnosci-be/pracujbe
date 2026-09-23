-- =============================================================================
-- 0070 — odbiorcy powiadomień firmowych = aktywni członkowie z uprawnieniami;
--        e-mail o wiadomości do kandydata podpisany nazwą firmy.
--
-- 1. Nowy prywatny helper `company_recipient_ok(company, profile)`: aktywne
--    członkostwo recruiter+ (owner/admin/recruiter) ORAZ aktywny, nieusunięty profil.
--    Bez grantu dla ról klienta — wołają go wyłącznie funkcje SECURITY DEFINER.
-- 2. apply_to_job — odbiorcy po stronie firmy przez helper (dotąd bez kontroli profilu).
-- 3. respond_to_offer — powiadomienie trafia do nadawcy propozycji tylko, gdy nadal
--    spełnia helper; w przeciwnym razie do aktywnych recruiter+ firmy oferty
--    (odpowiedź kandydata nie ginie, a były członek jej nie dostaje).
-- 4. send_message — odbiorcy po stronie firmy (członkowie firmy rozmowy) tylko przez
--    helper; strona kandydata bez zmian. Ta sama reguła co dostęp do rozmowy (0039).
--    `senderName` dla odbiorcy spoza firmy = nazwa firmy, gdy pisze członek firmy
--    (kandydat nie widzi profilu pracodawcy pod RLS — por. 0023). Wewnątrz firmy
--    i od kandydata do firmy — imię i nazwisko jak dotąd.
--
-- Treść pozostałych funkcji skopiowana 1:1 z ostatnich definicji (0040/0041/0016).
-- Rollback: odtworzyć funkcje z 0040 (apply_to_job), 0041 (respond_to_offer),
-- 0016 (send_message) i `drop function public.company_recipient_ok(uuid, uuid)`.
-- Migracja nie zmienia danych.
-- =============================================================================

create function public.company_recipient_ok(p_company_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = p_company_id
      and cm.profile_id = p_profile_id
      and cm.is_active = true
      and cm.role in ('owner', 'admin', 'recruiter')
      and p.is_active = true
      and p.deleted_at is null
  );
$$;
revoke all on function public.company_recipient_ok(uuid, uuid) from public;

-- --- apply_to_job (0040) — odbiorcy przez helper ---------------------------------
create or replace function public.apply_to_job(
  p_job_id uuid,
  p_idempotency_key text,
  p_phone text default null,
  p_availability text default null,
  p_message text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_company uuid; v_app_id uuid; v_locale text; v_job_title text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  -- P1-04: aplikować może wyłącznie konto kandydata (nie pracodawca/admin).
  if public.current_profile_role() <> 'candidate' then
    raise exception 'PERMISSION_DENIED: aplikować może tylko konto kandydata' using errcode = '42501';
  end if;
  if not public.job_is_public(p_job_id) then raise exception 'JOB_NOT_ACTIVE' using errcode = '42501'; end if;

  select company_id, title into v_company, v_job_title from public.jobs where id = p_job_id;
  v_locale := public.resolve_recipient_locale(v_uid);

  insert into public.applications
    (job_id, candidate_id, company_id, status, phone, availability, message, locale, idempotency_key, submitted_at)
  values
    (p_job_id, v_uid, v_company, 'submitted', p_phone,
     nullif(p_availability,'')::public.availability_status, p_message, v_locale, p_idempotency_key, now())
  on conflict (candidate_id, job_id) do nothing
  returning id into v_app_id;

  if v_app_id is null then
    select id into v_app_id from public.applications where candidate_id = v_uid and job_id = p_job_id;
    return v_app_id;
  end if;

  -- Powiadom/e-mail tylko aktywnych recruiter+ z aktywnym profilem (0070).
  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    select cm.profile_id, 'application_received', 'application_received', 'application', v_app_id
    from public.company_members cm
    where cm.company_id = v_company and public.company_recipient_ok(v_company, cm.profile_id);

  perform public.enqueue_email(cm.profile_id, 'newApplication', 'application', v_app_id,
                               'app-' || v_app_id::text || '-' || cm.profile_id::text,
                               jsonb_build_object('candidateName', coalesce(public.profile_full_name(v_uid), '—'),
                                                  'jobTitle', coalesce(v_job_title, '')))
    from public.company_members cm
    where cm.company_id = v_company and public.company_recipient_ok(v_company, cm.profile_id);

  return v_app_id;
end $$;

-- --- respond_to_offer (0041) — nadawca tylko, gdy nadal uprawniony ----------------
create or replace function public.respond_to_offer(
  p_offer_id uuid,
  p_accept boolean
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_candidate uuid; v_sender uuid; v_job_title text;
        v_status public.offer_status; v_expires timestamptz; v_company uuid;
        v_to public.offer_status := case when p_accept then 'accepted' else 'declined' end;
        v_type text := case when p_accept then 'offerAccepted' else 'offerDeclined' end;
        v_payload jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  -- Blokada wiersza propozycji (koniec wyścigu równoległych accept/decline).
  select o.candidate_id, o.sender_id, o.status, o.expires_at, j.title, j.company_id
    into v_candidate, v_sender, v_status, v_expires, v_job_title, v_company
    from public.offers o join public.jobs j on j.id = o.job_id
    where o.id = p_offer_id
    for update of o;
  if v_candidate is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_candidate <> v_uid then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if v_status not in ('sent', 'viewed') then
    raise exception 'VALIDATION_FAILED: propozycja nie jest już aktywna' using errcode = '42501';
  end if;
  -- Kontrola wygaśnięcia: wygasłej propozycji nie można przyjąć/odrzucić (oznaczenie 'expired'
  -- zostawiamy zadaniu utrzymaniowemu — tu tylko blokujemy, by nie kolidować z guard-triggerem).
  if v_expires is not null and v_expires < now() then
    raise exception 'VALIDATION_FAILED: propozycja wygasła' using errcode = '42501';
  end if;

  -- Compare-and-swap na stanie aktywnym.
  update public.offers set status = v_to, responded_at = now(), updated_at = now()
    where id = p_offer_id and status in ('sent', 'viewed');
  if not found then
    raise exception 'VALIDATION_FAILED: propozycja zmieniła stan równolegle' using errcode = '42501';
  end if;

  v_payload := jsonb_build_object('candidateName', coalesce(public.profile_full_name(v_candidate), '—'),
                                  'jobTitle', coalesce(v_job_title, ''));

  if v_sender is not null and public.company_recipient_ok(v_company, v_sender) then
    insert into public.notifications (profile_id, type, title, entity_type, entity_id)
      values (v_sender, 'offer_status_changed', 'offer_status_changed', 'offer', p_offer_id);
    perform public.enqueue_email(v_sender, v_type, 'offer', p_offer_id,
      'offerresp-' || p_offer_id::text, v_payload);
  else
    -- Nadawca nie jest już aktywnym recruiter+: informujemy aktywnych recruiter+ firmy.
    insert into public.notifications (profile_id, type, title, entity_type, entity_id)
      select cm.profile_id, 'offer_status_changed', 'offer_status_changed', 'offer', p_offer_id
      from public.company_members cm
      where cm.company_id = v_company and public.company_recipient_ok(v_company, cm.profile_id);
    perform public.enqueue_email(cm.profile_id, v_type, 'offer', p_offer_id,
      'offerresp-' || p_offer_id::text || '-' || cm.profile_id::text, v_payload)
      from public.company_members cm
      where cm.company_id = v_company and public.company_recipient_ok(v_company, cm.profile_id);
  end if;
end $$;

-- --- send_message (0016) — odbiorcy firmowi przez helper; nazwa firmy dla kandydata ---
create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_msg_id uuid;
  v_sender_name text;
  v_company uuid;
  v_company_name text;
  v_sender_is_company boolean := false;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if length(v_body) = 0 or length(v_body) > 5000 then
    raise exception 'VALIDATION_FAILED: treść wiadomości poza dozwolonym zakresem'
      using errcode = '42501';
  end if;

  insert into public.messages (conversation_id, sender_id, body)
    values (p_conversation_id, v_uid, v_body)
    returning id into v_msg_id;

  update public.conversations
    set last_message_at = now(), updated_at = now()
    where id = p_conversation_id
    returning company_id into v_company;

  if v_company is not null then
    select c.name into v_company_name from public.companies c where c.id = v_company;
    v_sender_is_company := exists (
      select 1 from public.company_members m where m.company_id = v_company and m.profile_id = v_uid);
  end if;
  v_sender_name := coalesce(public.profile_full_name(v_uid), '—');

  -- Odbiorcy: pozostali uczestnicy; członek firmy rozmowy tylko jako aktywny recruiter+.
  -- Powiadomienie in-app dla uprawnionych odbiorców.
  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    select r.profile_id, 'message_received', 'message_received', 'conversation', p_conversation_id
    from (
      select cm.profile_id,
             exists (select 1 from public.company_members m
                     where m.company_id = v_company and m.profile_id = cm.profile_id) as is_company
      from public.conversation_members cm
      where cm.conversation_id = p_conversation_id and cm.profile_id <> v_uid
    ) r
    where not r.is_company or public.company_recipient_ok(v_company, r.profile_id);

  -- E-mail dla niewyciszonych (idempotentnie: klucz per wiadomość+odbiorca).
  -- Odbiorca spoza firmy nie dostaje danych osobowych piszącego członka firmy.
  perform public.enqueue_email(
            r.profile_id, 'newMessage', 'message', v_msg_id,
            'msg-' || v_msg_id::text || '-' || r.profile_id::text,
            jsonb_build_object(
              'senderName', case
                when v_sender_is_company and not r.is_company then coalesce(v_company_name, '—')
                else v_sender_name
              end,
              'panel', case when p.role = 'employer' then 'employer' else 'candidate' end))
    from (
      select cm.profile_id,
             exists (select 1 from public.company_members m
                     where m.company_id = v_company and m.profile_id = cm.profile_id) as is_company
      from public.conversation_members cm
      where cm.conversation_id = p_conversation_id and cm.profile_id <> v_uid and cm.is_muted = false
    ) r
    join public.profiles p on p.id = r.profile_id
    where not r.is_company or public.company_recipient_ok(v_company, r.profile_id);

  return v_msg_id;
end $$;
