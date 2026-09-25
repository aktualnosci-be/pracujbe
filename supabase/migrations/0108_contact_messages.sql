-- =============================================================================
-- 0108 — Formularz kontaktu (#61, część techniczna)
-- =============================================================================
-- 1. contact_messages — wiadomość z publicznego formularza `/{locale}/kontakt`: nadawca
--    (imię opcjonalne, e-mail), temat ze słownika, treść, język formularza, numer
--    referencyjny `KON-XXXX-XXXX`, klucz idempotencji, status obsługi (new → handled).
--    RLS bez polityk: odczyt i zapis wyłącznie service_role i funkcje SECURITY DEFINER.
-- 2. submit_contact_message(...) — EXECUTE tylko service_role (Server Action za limiterem
--    i Turnstile `contact`). Walidacja lustrzana do Zod, idempotencja (także przy wyścigu:
--    advisory lock), limit 3 wiadomości / adres / 24 h. W tej samej transakcji:
--    - potwierdzenie `supportContact` do nadawcy w języku FORMULARZA
--      (`enqueue_email_to_address`, 0094 — nadawca bez konta nie ma profilu),
--    - powiadomienie `contactMessageAdmin` do każdego aktywnego admina przez
--      `enqueue_email` (język wg Invariantu #1 — `resolve_recipient_locale`).
--    Payload e-maili: numer referencyjny i temat. Treść wiadomości i adres nadawcy NIE
--    trafiają do kolejki — admin czyta je w panelu `/admin/kontakt`.
-- 3. admin_set_contact_message_status(id, status, expected) — is_admin(), CAS po statusie
--    (`STALE_STATE`), audyt `contact_message.status_changed` (bez treści).
--
-- Rollback: drop funkcji submit_contact_message / admin_set_contact_message_status
-- i tabeli contact_messages. Migracja nie zmienia istniejących danych.
-- =============================================================================

create table if not exists public.contact_messages (
  id              uuid primary key default gen_random_uuid(),
  reference       text not null unique,
  idempotency_key uuid not null unique,
  sender_id       uuid references public.profiles(id) on delete set null,
  sender_name     text,
  sender_email    public.citext not null,
  topic           text not null,
  message         text not null,
  locale          text not null references public.supported_locales(code),
  status          text not null default 'new',
  handled_at      timestamptz,
  handled_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint contact_messages_reference_format check (reference ~ '^KON-[0-9A-F]{4}-[0-9A-F]{4}$'),
  constraint contact_messages_topic check (
    topic in ('candidate_account', 'employer_account', 'job_listing', 'technical', 'privacy', 'other')),
  constraint contact_messages_status check (status in ('new', 'handled')),
  constraint contact_messages_name_len check (sender_name is null or char_length(sender_name) between 1 and 200),
  constraint contact_messages_email_len check (char_length(sender_email::text) between 3 and 254),
  constraint contact_messages_message_len check (char_length(message) between 20 and 5000),
  constraint contact_messages_handled check (
    (status = 'new' and handled_at is null and handled_by is null)
    or (status = 'handled' and handled_at is not null))
);

create index if not exists idx_contact_messages_created
  on public.contact_messages (created_at desc, id desc);
create index if not exists idx_contact_messages_email_created
  on public.contact_messages (sender_email, created_at desc);

drop trigger if exists trg_contact_messages_updated_at on public.contact_messages;
create trigger trg_contact_messages_updated_at
  before update on public.contact_messages
  for each row execute function public.set_updated_at();

alter table public.contact_messages enable row level security;
-- Brak polityk: tylko service_role i funkcje SECURITY DEFINER.
revoke all on public.contact_messages from public, anon, authenticated;

-- --- 2. Wysłanie wiadomości (RPC) --------------------------------------------------------
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

  -- Potwierdzenie do nadawcy — język formularza (nadawca bez konta nie ma profilu).
  perform public.enqueue_email_to_address(
    v_email::text, p_locale, v_sender, 'supportContact', 'contact_message', v_id,
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

-- --- 3. Obsługa przez administratora -----------------------------------------------------
create or replace function public.admin_set_contact_message_status(
  p_id uuid,
  p_status text,
  p_expected_status text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.contact_messages;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('new', 'handled') then
    raise exception 'VALIDATION_FAILED: status' using errcode = '22023';
  end if;

  select * into v_row from public.contact_messages where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_expected_status is not null and v_row.status <> p_expected_status then
    raise exception 'STALE_STATE: status wiadomości zmienił się';
  end if;
  if v_row.status = p_status then return; end if;

  update public.contact_messages
     set status = p_status,
         handled_at = case when p_status = 'handled' then now() else null end,
         handled_by = case when p_status = 'handled' then auth.uid() else null end
   where id = p_id;

  perform public.write_audit('contact_message.status_changed', 'contact_message', p_id,
    jsonb_build_object('status', v_row.status),
    jsonb_build_object('status', p_status));
end $$;
revoke all on function public.admin_set_contact_message_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_contact_message_status(uuid, text, text) to authenticated;
