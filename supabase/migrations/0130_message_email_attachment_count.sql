-- =============================================================================
-- 0130_message_email_attachment_count.sql — e-mail `newMessage` z liczbą załączników.
-- (Numer tymczasowy — ostateczny nada integrator.)
--
-- send_message (podpis bez zmian z 0119): payload `newMessage` dostaje `attachmentCount` =
-- liczba plików połączonych z wiadomością w tej samej transakcji. Tylko liczba — bez nazw,
-- typów i rozmiarów (minimalizacja #503; e-mail prowadzi do wątku). Odbiorca po stronie
-- firmy, gdy nadawcą jest kandydat, który zablokował tę firmę (#97), dostaje 0 — tak jak
-- w wątku nie widzi plików tego kandydata. Reszta funkcji 1:1 z 0119.
--
-- Rollback: odtworzyć send_message(uuid, text, uuid, uuid[]) z 0119 (z grantami).
-- =============================================================================

create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text,
  p_client_message_id uuid,
  p_attachment_ids uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_msg_id uuid;
  v_sender_name text;
  v_company uuid;
  v_company_name text;
  v_sender_is_company boolean := false;
  v_body text := btrim(coalesce(p_body, ''));
  v_attachments uuid[] := coalesce(p_attachment_ids, '{}'::uuid[]);
  v_linked integer := 0;
  v_candidate uuid;
  v_hide_from_company boolean := false;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_client_message_id is null then
    raise exception 'VALIDATION_FAILED: brak identyfikatora operacji' using errcode = '42501';
  end if;
  if cardinality(v_attachments) > 3
     or array_position(v_attachments, null) is not null
     or cardinality(v_attachments) <> (select count(distinct x) from unnest(v_attachments) x) then
    raise exception 'VALIDATION_FAILED: nieprawidłowa lista załączników' using errcode = '42501';
  end if;
  if (length(v_body) = 0 and cardinality(v_attachments) = 0) or length(v_body) > 5000 then
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
    -- istniejącą wiadomość (z jej załącznikami) bez drugiego powiadomienia i e-maila.
    select m.id into v_msg_id
      from public.messages m
      where m.conversation_id = p_conversation_id
        and m.sender_id = v_uid
        and m.client_message_id = p_client_message_id;
    return v_msg_id;
  end if;

  -- Załączniki: tylko własne, przygotowane w TEJ rozmowie i jeszcze niewysłane. Brak
  -- któregokolwiek cofa całą wiadomość (także powiadomienia i e-maile niżej).
  if cardinality(v_attachments) > 0 then
    if not public.can_attach_in_conversation(p_conversation_id) then
      raise exception 'PERMISSION_DENIED' using errcode = '42501';
    end if;
    update public.message_attachments a
       set message_id = v_msg_id, position = x.ord, linked_at = now()
      from unnest(v_attachments) with ordinality as x(id, ord)
     where a.id = x.id
       and a.uploader_id = v_uid
       and a.conversation_id = p_conversation_id
       and a.message_id is null;
    get diagnostics v_linked = row_count;
    if v_linked <> cardinality(v_attachments) then
      raise exception 'VALIDATION_FAILED: załącznik niedostępny' using errcode = '42501';
    end if;
  end if;

  update public.conversations
    set last_message_at = now(), updated_at = now()
    where id = p_conversation_id
    returning company_id into v_company;

  -- #503: w e-mailu tylko LICZBA załączników (bez nazw plików). Strona firmowa, której
  -- kandydat-nadawca ją zablokował (#97), nie widzi jego plików — więc nie dostaje też liczby.
  if v_company is not null and v_linked > 0 then
    select public.conversation_candidate(c.application_id, c.offer_id) into v_candidate
      from public.conversations c where c.id = p_conversation_id;
    v_hide_from_company := v_candidate is not null and v_uid = v_candidate
      and public.candidate_blocked_company(v_candidate, v_company);
  end if;

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
  -- #290 (0113): conversationId → przycisk prowadzi do właściwego wątku.
  -- Odbiorca spoza firmy nie dostaje danych osobowych piszącego członka firmy.
  perform public.enqueue_email(
            r.profile_id, 'newMessage', 'message', v_msg_id,
            'msg-' || v_msg_id::text || '-' || r.profile_id::text,
            jsonb_build_object(
              'senderName', case
                when v_sender_is_company and not r.is_company then coalesce(v_company_name, '—')
                else v_sender_name
              end,
              'panel', case when p.role = 'employer' then 'employer' else 'candidate' end,
              'conversationId', p_conversation_id,
              'attachmentCount', case
                when r.is_company and v_hide_from_company then 0
                else v_linked
              end))
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

revoke all on function public.send_message(uuid, text, uuid, uuid[]) from public;
grant execute on function public.send_message(uuid, text, uuid, uuid[]) to authenticated;
