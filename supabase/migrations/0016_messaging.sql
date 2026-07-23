-- =============================================================================
-- 0016_messaging.sql
-- Bezpieczne procesy komunikacji (Etap 6) jako RPC SECURITY DEFINER — domknięcie
-- P1-14/F-08 (tworzenie konwersacji z walidacją relacji, bez wstrzykiwania stron).
-- Klient NIE tworzy konwersacji/wiadomości bezpośrednim INSERT-em pod dowolne strony;
-- mutacje idą przez te RPC, które sprawdzają, że wywołujący jest stroną aplikacji/oferty.
--
-- Język e-maila o nowej wiadomości = język ODBIORCY (INVARIANT #1) — wyznaczany
-- w enqueue_email() z profilu odbiorcy, nie z sesji nadawcy.
-- =============================================================================

-- Jedna aktywna (nieusunięta) konwersacja na aplikację / propozycję — twarda gwarancja
-- braku duplikatów nawet przy równoległych wywołaniach (dodatkowo advisory lock w RPC).
create unique index if not exists uq_conversations_application
  on public.conversations(application_id)
  where application_id is not null and deleted_at is null;
create unique index if not exists uq_conversations_offer
  on public.conversations(offer_id)
  where offer_id is not null and deleted_at is null;

-- =============================================================================
-- get_or_create_conversation — konwersacja powiązana z aplikacją LUB propozycją.
-- Waliduje, że wywołujący jest stroną relacji (kandydat-właściciel albo aktywny
-- członek firmy). Tworzy konwersację i dodaje OBIE strony jako uczestników
-- (kandydat + aktywni członkowie firmy). Zwraca id konwersacji (istniejącej lub nowej).
-- =============================================================================
create or replace function public.get_or_create_conversation(
  p_application_id uuid default null,
  p_offer_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_conv_id uuid;
  v_type public.conversation_type;
  v_job uuid; v_company uuid; v_candidate uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  -- Dokładnie jedna relacja (XOR).
  if (p_application_id is null) = (p_offer_id is null) then
    raise exception 'VALIDATION_FAILED: podaj dokładnie jedną relację (aplikacja albo propozycja)'
      using errcode = '42501';
  end if;

  if p_application_id is not null then
    if not public.can_access_application(p_application_id) then
      raise exception 'PERMISSION_DENIED' using errcode = '42501';
    end if;
    select a.job_id, j.company_id, a.candidate_id
      into v_job, v_company, v_candidate
      from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = p_application_id;
    if v_job is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    v_type := 'application';
  else
    if not public.can_access_offer(p_offer_id) then
      raise exception 'PERMISSION_DENIED' using errcode = '42501';
    end if;
    select o.job_id, j.company_id, o.candidate_id
      into v_job, v_company, v_candidate
      from public.offers o
      join public.jobs j on j.id = o.job_id
      where o.id = p_offer_id;
    if v_job is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    v_type := 'offer';
  end if;

  -- Serializacja tworzenia dla danej relacji (bez duplikatów przy równoległych stronach).
  perform pg_advisory_xact_lock(
    hashtextextended('conversation:' || coalesce(p_application_id, p_offer_id)::text, 0));

  -- Po zajęciu blokady: konwersacja mogła powstać w międzyczasie.
  if p_application_id is not null then
    select id into v_conv_id from public.conversations
      where application_id = p_application_id and deleted_at is null limit 1;
  else
    select id into v_conv_id from public.conversations
      where offer_id = p_offer_id and deleted_at is null limit 1;
  end if;
  if v_conv_id is not null then return v_conv_id; end if;

  insert into public.conversations
    (type, company_id, job_id, application_id, offer_id, created_by, last_message_at)
  values
    (v_type, v_company, v_job, p_application_id, p_offer_id, v_uid, now())
  returning id into v_conv_id;

  -- Uczestnicy: kandydat + aktywni członkowie firmy (unikat pilnuje duplikatów).
  insert into public.conversation_members (conversation_id, profile_id)
    values (v_conv_id, v_candidate)
    on conflict (conversation_id, profile_id) do nothing;
  insert into public.conversation_members (conversation_id, profile_id)
    select v_conv_id, cm.profile_id
      from public.company_members cm
      where cm.company_id = v_company and cm.is_active = true
    on conflict (conversation_id, profile_id) do nothing;

  return v_conv_id;
end $$;

-- =============================================================================
-- send_message — wiadomość w konwersacji (tylko uczestnik). Powiadamia pozostałe
-- strony (in-app) i kolejkuje e-mail (każdy odbiorca w SWOIM języku, poza wyciszonymi).
-- =============================================================================
create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_msg_id uuid;
  v_sender_name text;
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
    where id = p_conversation_id;

  v_sender_name := coalesce(public.profile_full_name(v_uid), '—');

  -- Powiadomienie in-app dla pozostałych uczestników.
  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    select cm.profile_id, 'message_received', 'message_received', 'conversation', p_conversation_id
    from public.conversation_members cm
    where cm.conversation_id = p_conversation_id and cm.profile_id <> v_uid;

  -- E-mail dla niewyciszonych (idempotentnie: klucz per wiadomość+odbiorca).
  perform public.enqueue_email(
            cm.profile_id, 'newMessage', 'message', v_msg_id,
            'msg-' || v_msg_id::text || '-' || cm.profile_id::text,
            jsonb_build_object(
              'senderName', v_sender_name,
              'panel', case when p.role = 'employer' then 'employer' else 'candidate' end))
    from public.conversation_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.conversation_id = p_conversation_id
      and cm.profile_id <> v_uid
      and cm.is_muted = false;

  return v_msg_id;
end $$;

-- =============================================================================
-- mark_conversation_read — ustawia last_read_at wywołującego i wygasza powiązane
-- powiadomienia in-app (tylko własne).
-- =============================================================================
create or replace function public.mark_conversation_read(
  p_conversation_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;

  update public.conversation_members
    set last_read_at = now()
    where conversation_id = p_conversation_id and profile_id = v_uid;

  update public.notifications
    set read_at = now(), updated_at = now()
    where profile_id = v_uid
      and entity_type = 'conversation'
      and entity_id = p_conversation_id
      and read_at is null;
end $$;

-- =============================================================================
-- mark_notifications_read — oznacza powiadomienia jako przeczytane (tylko własne).
-- p_ids = null -> wszystkie nieprzeczytane wywołującego; inaczej wskazane id.
-- =============================================================================
create or replace function public.mark_notifications_read(
  p_ids uuid[] default null
) returns integer language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_count integer;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  update public.notifications
    set read_at = now(), updated_at = now()
    where profile_id = v_uid
      and read_at is null
      and (p_ids is null or id = any(p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- --- Uprawnienia: tylko zalogowani; logika autoryzacji wewnątrz RPC ----------
revoke all on function public.get_or_create_conversation(uuid, uuid) from public;
revoke all on function public.send_message(uuid, text) from public;
revoke all on function public.mark_conversation_read(uuid) from public;
revoke all on function public.mark_notifications_read(uuid[]) from public;
grant execute on function public.get_or_create_conversation(uuid, uuid) to authenticated;
grant execute on function public.send_message(uuid, text) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
