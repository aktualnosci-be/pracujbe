-- =============================================================================
-- 0998 (numer tymczasowy) — potwierdzenie formularza kontaktu w języku odbiorcy (#1093).
--
-- `submit_contact_message` (0125) kolejkował `supportContact` zawsze w języku FORMULARZA,
-- także dla zalogowanego nadawcy — inaczej niż potwierdzenie zgłoszenia treści (0094/0188),
-- które dla konta używa `resolve_recipient_locale`. Invariant #1: język e-maila = język
-- odbiorcy (preferred → account → signup → en). Teraz:
--   * nadawca z aktywnym profilem → `resolve_recipient_locale(profil)`,
--   * nadawca bez konta (albo profil usunięty/nieistniejący) → język formularza, jak dotąd.
-- Powiadomienia administratorów bez zmian (każdy w swoim języku). Kolumna
-- `contact_messages.locale` nadal = język formularza. Sygnatura i granty bez zmian.
--
-- Rollback: supabase/rollback/0998_contact_recipient_locale.down.sql (test:
-- supabase/tests/contact-recipient-locale-rollback.sql).
-- =============================================================================

create or replace function public.submit_contact_message(
  p_sender_id       uuid,
  p_idempotency_key uuid,
  p_topic           text,
  p_message         text,
  p_sender_name     text,
  p_sender_email    text,
  p_locale          text
) returns table (message_id uuid, reference text, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email    public.citext;
  v_name     text := nullif(btrim(coalesce(p_sender_name, '')), '');
  v_message  text := btrim(coalesce(p_message, ''));
  v_sender   uuid;
  v_existing record;
  v_ref      text;
  v_id       uuid;
  v_admin    record;
  v_mail_locale text;
begin
  if p_idempotency_key is null then
    raise exception 'VALIDATION_FAILED: brak klucza idempotencji' using errcode = '22023';
  end if;

  -- Ten sam klucz = to samo wysłanie (także przy wyścigu dwóch żądań).
  perform pg_advisory_xact_lock(hashtextextended('contact:' || p_idempotency_key::text, 0));
  select m.id, m.reference into v_existing
    from public.contact_messages m where m.idempotency_key = p_idempotency_key;
  if found then
    return query select v_existing.id, v_existing.reference, false;
    return;
  end if;

  if p_topic is null or p_topic not in
     ('candidate_account', 'employer_account', 'job_listing', 'technical', 'privacy', 'other') then
    raise exception 'VALIDATION_FAILED: temat' using errcode = '22023';
  end if;
  if char_length(v_message) < 20 or char_length(v_message) > 5000 then
    raise exception 'VALIDATION_FAILED: treść' using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 200 then
    raise exception 'VALIDATION_FAILED: imię' using errcode = '22023';
  end if;
  v_email := lower(btrim(coalesce(p_sender_email, '')));
  if char_length(v_email::text) not between 3 and 254
     or v_email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_FAILED: e-mail' using errcode = '22023';
  end if;
  if public.is_supported_locale(p_locale) is not true then
    raise exception 'VALIDATION_FAILED: język' using errcode = '22023';
  end if;

  -- Limit w bazie: 3 wiadomości / adres / 24 h (niezależnie od limitera IP w aplikacji).
  perform pg_advisory_xact_lock(hashtextextended('contact-email:' || v_email::text, 0));
  if (select count(*) from public.contact_messages m
        where m.sender_email = v_email and m.created_at > now() - interval '24 hours') >= 3 then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;

  -- Zalogowany nadawca: istniejący, aktywny profil (tylko powiązanie; adres podaje formularz).
  if p_sender_id is not null then
    select p.id into v_sender from public.profiles p
      where p.id = p_sender_id and p.deleted_at is null;
  end if;

  -- #1093: potwierdzenie w języku ODBIORCY (Invariant #1) — zalogowany nadawca dostaje je
  -- w języku swojego konta (jak potwierdzenie zgłoszenia treści, 0188); nadawca bez konta
  -- nie ma profilu, więc jedynym znanym językiem jest język formularza. Wiadomość zachowuje
  -- język formularza (kolumna `locale` — w nim nadawca pisał).
  v_mail_locale := case when v_sender is not null
                        then public.resolve_recipient_locale(v_sender)
                        else p_locale end;

  -- Numer referencyjny: 32 bity losowe, ponowienie przy kolizji.
  loop
    v_ref := upper(substr(encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'), 1, 8));
    v_ref := 'KON-' || substr(v_ref, 1, 4) || '-' || substr(v_ref, 5, 4);
    exit when not exists (select 1 from public.contact_messages m where m.reference = v_ref);
  end loop;

  insert into public.contact_messages(
    reference, idempotency_key, sender_id, sender_name, sender_email, topic, message, locale)
  values (v_ref, p_idempotency_key, v_sender, v_name, v_email, p_topic, v_message, p_locale)
  returning id into v_id;

  -- Potwierdzenie do nadawcy — język odbiorcy (konto) albo formularza (bez konta).
  perform public.enqueue_email_to_address(
    v_email::text, v_mail_locale, v_sender, 'supportContact', 'contact_message', v_id,
    'contact-received:' || v_id::text,
    jsonb_build_object('reference', v_ref, 'topic', p_topic, 'recipientName', v_name));

  -- Powiadomienie administratorów — każdy w swoim języku (Invariant #1).
  for v_admin in
    select p.id from public.profiles p
     where p.role = 'admin' and p.deleted_at is null
  loop
    perform public.enqueue_email(
      v_admin.id, 'contactMessageAdmin', 'contact_message', v_id,
      'contact-admin:' || v_id::text || ':' || v_admin.id::text,
      jsonb_build_object('reference', v_ref, 'topic', p_topic));
  end loop;

  return query select v_id, v_ref, true;
end $$;
revoke all on function public.submit_contact_message(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_contact_message(uuid, uuid, text, text, text, text, text)
  to service_role;
