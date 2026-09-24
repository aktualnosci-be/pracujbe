-- =============================================================================
-- 0075 — idempotentna wysyłka wiadomości (#147) i jedna granica wygaśnięcia
-- propozycji w respond_to_offer (#88).
--
-- #147: send_message nie miał identyfikatora operacji. Gdy transakcja zapisała
-- wiadomość, powiadomienia i e-maile, a odpowiedź HTTP zginęła, ponowienie tworzyło
-- drugą wiadomość i drugi komplet alertów. Teraz klient przekazuje stabilny
-- p_client_message_id (UUID, ten sam dla wszystkich prób jednej operacji):
--   * kolumna messages.client_message_id + unikalny indeks
--     (conversation_id, sender_id, client_message_id) — PostgreSQL rozstrzyga
--     równoległe próby atomowo (druga czeka na commit pierwszej);
--   * pierwsza próba: wiadomość + last_message_at + powiadomienia + e-mail;
--   * konflikt (retry/równoległa próba): zwrot id istniejącej wiadomości BEZ
--     ponawiania efektów ubocznych;
--   * brak deduplikacji po treści — dwa różne klucze z tą samą treścią = dwie wiadomości.
-- Stary podpis send_message(uuid, text) jest usuwany, żeby nie istniała ścieżka bez klucza.
-- Reszta treści send_message skopiowana 1:1 z 0070.
--
-- #88: respond_to_offer odrzucał dopiero expires_at < now(), a warstwa odczytu
-- (candidate.ts: expires_at > now) i UI (canRespondToProposal: expiresAt > now) uznają
-- propozycję za aktywną tylko ściśle przed terminem. Teraz RPC odrzuca expires_at <= now().
-- Reszta respond_to_offer skopiowana 1:1 z 0070.
--
-- Rollback: odtworzyć send_message(uuid, text) i respond_to_offer z 0070 (z grantami
-- z 0016/0012), usunąć send_message(uuid, text, uuid), indeks
-- messages_client_message_id_uniq i kolumnę messages.client_message_id. Istniejące
-- wiadomości mają client_message_id = null, więc migracja nie zmienia danych.
-- =============================================================================

alter table public.messages add column if not exists client_message_id uuid;

create unique index if not exists messages_client_message_id_uniq
  on public.messages (conversation_id, sender_id, client_message_id)
  where client_message_id is not null;

drop function if exists public.send_message(uuid, text);

create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text,
  p_client_message_id uuid
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
  if p_client_message_id is null then
    raise exception 'VALIDATION_FAILED: brak identyfikatora operacji' using errcode = '42501';
  end if;
  if length(v_body) = 0 or length(v_body) > 5000 then
    raise exception 'VALIDATION_FAILED: treść wiadomości poza dozwolonym zakresem'
      using errcode = '42501';
  end if;

  -- Unikalny indeks rozstrzyga ponowienia i równoległe próby tej samej operacji.
  insert into public.messages (conversation_id, sender_id, body, client_message_id)
    values (p_conversation_id, v_uid, v_body, p_client_message_id)
    on conflict (conversation_id, sender_id, client_message_id)
      where client_message_id is not null
      do nothing
    returning id into v_msg_id;

  if v_msg_id is null then
    -- Ta operacja została już zapisana (np. odpowiedź zginęła po commicie): zwracamy
    -- istniejącą wiadomość bez drugiego powiadomienia i e-maila.
    select m.id into v_msg_id
      from public.messages m
      where m.conversation_id = p_conversation_id
        and m.sender_id = v_uid
        and m.client_message_id = p_client_message_id;
    return v_msg_id;
  end if;

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

revoke all on function public.send_message(uuid, text, uuid) from public;
grant execute on function public.send_message(uuid, text, uuid) to authenticated;

-- --- respond_to_offer (0070) — granica wygaśnięcia expires_at <= now() --------------
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
  -- Kontrola wygaśnięcia: propozycja jest aktywna tylko ściśle przed expires_at — ta sama
  -- granica co w warstwie odczytu (expires_at > now()) i UI. Oznaczenie 'expired'
  -- zostawiamy zadaniu utrzymaniowemu — tu tylko blokujemy.
  if v_expires is not null and v_expires <= now() then
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
