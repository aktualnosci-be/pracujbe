-- =============================================================================
-- 0108_message_attachments.sql — załączniki w rozmowach (Etap 5, „Wiadomości").
-- NUMER TYMCZASOWY — ostateczny nada integrator (kolejka migracji).
--
-- Model:
--   * obiekt w prywatnym buckecie Railway (#26), klucz `<conversation_id>/att-<uuid>.<ext>`
--     (pdf/doc/docx/jpg/png, ≤ 5 MB) nadaje serwer; metadane w `files`
--     (entity_type = 'message_attachment', entity_id = rozmowa, bucket logiczny 'message-files');
--   * `message_attachments` wiąże plik z rozmową i — po wysłaniu — z wiadomością.
--     Wgrany plik jest najpierw „przygotowany" (message_id null), a `send_message` łączy go
--     z wiadomością w TEJ SAMEJ transakcji, w której powstaje wiadomość (idempotencja
--     `client_message_id` z 0075: ponowienie zwraca istniejącą wiadomość z jej załącznikami).
--     Ponowienie uploadu z tym samym `client_upload_id` zwraca istniejący załącznik.
--   * dostęp wyłącznie przez RPC (brak grantów na tabelę): lista i pobranie wymagają
--     BIEŻĄCEGO dostępu do rozmowy (`is_conversation_member`: aktywny recruiter+ albo
--     strona kandydata) i wysłanej wiadomości; pobranie dodatkowo `scan_status` in
--     ('clean','skipped') — kwarantanna ('pending'/'infected') = brak pobrania (AV = otwarte);
--   * blokada firmy (#97): strona firmowa nie wgrywa plików do rozmowy z kandydatem, który
--     ją zablokował (wysłanie i tak blokuje trigger z 0078), i nie widzi ani nie pobiera
--     plików wgranych przez tego kandydata; historia wiadomości zostaje jak dotąd;
--   * usuwanie: skasowanie wiersza `message_attachments` (kaskada z wiadomości/rozmowy —
--     także przy usunięciu konta #486) usuwa wiersz `files`, a trigger z 0105 kolejkuje
--     obiekt w `storage_deletion_queue`. Nieużyte przygotowane pliki sprząta
--     `purge_stale_message_attachments` (service_role, /api/maintenance);
--   * metadane plików załączników zmienia wyłącznie kod definera — bezpośredni
--     INSERT/UPDATE `files` z entity_type 'message_attachment' przez klienta jest odrzucany
--     (inaczej właściciel mógłby podmienić ścieżkę na cudzy obiekt albo zdjąć kwarantannę).
--
-- send_message: nowy podpis (uuid, text, uuid, uuid[] default '{}'); stary 3-argumentowy
-- jest usuwany (wywołania 3-argumentowe działają przez wartość domyślną). Pusta treść jest
-- dozwolona tylko z co najmniej jednym załącznikiem. Reszta treści 1:1 z 0075.
--
-- Rollback: drop function send_message(uuid, text, uuid, uuid[]); odtworzyć
-- send_message(uuid, text, uuid) z 0075 (z grantami); drop functions
-- stage_message_attachment, discard_message_attachment, get_message_attachments,
-- get_message_attachment_download, purge_stale_message_attachments,
-- message_attachment_visible, can_attach_in_conversation; drop triggery
-- trg_message_attachment_delete_file, trg_files_guard_message_attachment; drop table
-- message_attachments (po skasowaniu wierszy files z entity_type 'message_attachment',
-- żeby trigger 0105 zakolejkował obiekty).
-- =============================================================================

create table if not exists public.message_attachments (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  uploader_id      uuid references public.profiles(id) on delete set null,
  file_id          uuid not null unique references public.files(id) on delete cascade,
  client_upload_id uuid not null,
  message_id       uuid references public.messages(id) on delete cascade,
  position         smallint,
  created_at       timestamptz not null default now(),
  linked_at        timestamptz,
  unique (uploader_id, client_upload_id),
  constraint message_attachments_link_check
    check ((message_id is null) = (position is null) and (message_id is null) = (linked_at is null)),
  constraint message_attachments_position_check check (position is null or position between 1 and 3)
);
create index if not exists idx_message_attachments_message
  on public.message_attachments (message_id) where message_id is not null;
create index if not exists idx_message_attachments_staged
  on public.message_attachments (created_at) where message_id is null;
create index if not exists idx_message_attachments_conversation
  on public.message_attachments (conversation_id);

alter table public.message_attachments enable row level security;
alter table public.message_attachments force row level security;
revoke all on public.message_attachments from public, anon, authenticated;

-- --- Usunięcie załącznika → usunięcie metadanych pliku (→ kolejka storage z 0105) ---------
create or replace function public.message_attachment_delete_file()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.files f where f.id = old.file_id;
  return old;
end $$;
revoke all on function public.message_attachment_delete_file() from public, anon, authenticated;

drop trigger if exists trg_message_attachment_delete_file on public.message_attachments;
create trigger trg_message_attachment_delete_file
  after delete on public.message_attachments
  for each row execute function public.message_attachment_delete_file();

-- --- Metadane plików załączników tylko przez kod definera ---------------------------------
-- Rola klienta (anon/authenticated) nie tworzy ani nie zmienia wierszy files załączników.
-- Usunięcie własnego wiersza zostaje (kaskada usuwa załącznik, obiekt trafia do kolejki).
create or replace function public.guard_message_attachment_file()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated')
     and (new.entity_type = 'message_attachment'
          or (tg_op = 'UPDATE' and old.entity_type = 'message_attachment')) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_message_attachment_file() from public, anon, authenticated;

drop trigger if exists trg_files_guard_message_attachment on public.files;
create trigger trg_files_guard_message_attachment
  before insert or update on public.files
  for each row execute function public.guard_message_attachment_file();

-- --- Czy wywołujący może dołączać pliki w rozmowie ----------------------------------------
-- Bieżący dostęp do rozmowy + blokada firmy (#97) dla strony firmowej (jak trigger 0078).
create or replace function public.can_attach_in_conversation(p_conversation_id uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid; v_candidate uuid;
begin
  if auth.uid() is null or not public.is_conversation_member(p_conversation_id) then
    return false;
  end if;
  select c.company_id, public.conversation_candidate(c.application_id, c.offer_id)
    into v_company, v_candidate
    from public.conversations c where c.id = p_conversation_id and c.deleted_at is null;
  if not found then return false; end if;
  if v_company is not null and v_candidate is not null
     and auth.uid() is distinct from v_candidate
     and public.candidate_blocked_company(v_candidate, v_company) then
    return false;
  end if;
  return true;
end $$;
revoke all on function public.can_attach_in_conversation(uuid) from public, anon;
-- Wstępna kontrola przed zapisem obiektu w buckecie (bez dostępu nie wysyłamy bajtów);
-- zwraca tylko prawo wywołującego, nic o cudzych rozmowach.
grant execute on function public.can_attach_in_conversation(uuid) to authenticated;

-- --- Widoczność wysłanego załącznika dla wywołującego ------------------------------------
create or replace function public.message_attachment_visible(
  p_conversation_id uuid, p_uploader_id uuid, p_message_id uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid; v_candidate uuid;
begin
  if p_message_id is null or auth.uid() is null
     or not public.is_conversation_member(p_conversation_id) then
    return false;
  end if;
  select c.company_id, public.conversation_candidate(c.application_id, c.offer_id)
    into v_company, v_candidate
    from public.conversations c where c.id = p_conversation_id and c.deleted_at is null;
  if not found then return false; end if;
  -- Blokada (#97): strona firmowa nie widzi plików kandydata, który ją zablokował.
  if v_company is not null and v_candidate is not null
     and p_uploader_id is not distinct from v_candidate
     and auth.uid() is distinct from v_candidate
     and public.candidate_blocked_company(v_candidate, v_company) then
    return false;
  end if;
  return true;
end $$;
revoke all on function public.message_attachment_visible(uuid, uuid, uuid) from public, anon, authenticated;

-- --- Przygotowanie załącznika (po zapisie obiektu w buckecie) -----------------------------
-- Zwraca id załącznika i `created` = false, gdy ten sam client_upload_id był już zapisany
-- (wywołujący usuwa wtedy nowo wgrany, zbędny obiekt).
create or replace function public.stage_message_attachment(
  p_conversation_id  uuid,
  p_client_upload_id uuid,
  p_path             text,
  p_file_name        text,
  p_mime_type        text,
  p_size_bytes       bigint,
  p_checksum_sha256  text,
  p_scan_status      text default 'skipped'
) returns table (attachment_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid  uuid := auth.uid();
  v_ext  text;
  v_file uuid;
  v_id   uuid;
  v_conv uuid;
  v_name text := btrim(coalesce(p_file_name, ''));
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_conversation_id is null or p_client_upload_id is null then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  if not public.can_attach_in_conversation(p_conversation_id) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;

  -- Jedna operacja uploadu naraz (retry i równoległe próby tego samego klucza).
  perform pg_advisory_xact_lock(hashtextextended('msgatt:' || v_uid::text || ':' || p_client_upload_id::text, 0));
  select a.id, a.conversation_id into v_id, v_conv
    from public.message_attachments a
   where a.uploader_id = v_uid and a.client_upload_id = p_client_upload_id;
  if v_id is not null then
    if v_conv <> p_conversation_id then
      raise exception 'VALIDATION_FAILED' using errcode = '22023';
    end if;
    return query select v_id, false;
    return;
  end if;

  if p_path is null or p_path !~ ('^' || p_conversation_id::text
       || '/att-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|doc|docx|jpg|png)$') then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  v_ext := substring(p_path from '\.([a-z]+)$');
  if p_mime_type is distinct from (case v_ext
       when 'pdf' then 'application/pdf'
       when 'doc' then 'application/msword'
       when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
       when 'jpg' then 'image/jpeg'
       when 'png' then 'image/png' end) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 5 * 1024 * 1024
     or char_length(v_name) not between 1 and 200 or v_name ~ '[\x01-\x1f\x7f]'
     or p_checksum_sha256 is null or p_checksum_sha256 !~ '^[0-9a-f]{64}$'
     or p_scan_status not in ('pending', 'skipped') then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  -- Limit nieużytych plików jednej osoby w rozmowie (porzucone uploady).
  if (select count(*) from public.message_attachments a
       where a.conversation_id = p_conversation_id and a.uploader_id = v_uid
         and a.message_id is null) >= 10 then
    raise exception 'VALIDATION_FAILED: limit przygotowanych załączników' using errcode = '22023';
  end if;

  insert into public.files
    (owner_id, bucket, path, file_name, mime_type, size_bytes, visibility,
     entity_type, entity_id, scan_status, checksum_sha256)
  values
    (v_uid, 'message-files', p_path, v_name, p_mime_type, p_size_bytes, 'private',
     'message_attachment', p_conversation_id, p_scan_status, p_checksum_sha256)
  returning id into v_file;

  insert into public.message_attachments (conversation_id, uploader_id, file_id, client_upload_id)
  values (p_conversation_id, v_uid, v_file, p_client_upload_id)
  returning id into v_id;

  return query select v_id, true;
end $$;
revoke all on function public.stage_message_attachment(uuid, uuid, text, text, text, bigint, text, text)
  from public, anon;
grant execute on function public.stage_message_attachment(uuid, uuid, text, text, text, bigint, text, text)
  to authenticated;

-- --- Rezygnacja z przygotowanego (niewysłanego) załącznika --------------------------------
create or replace function public.discard_message_attachment(p_attachment_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  delete from public.message_attachments a
   where a.id = p_attachment_id and a.uploader_id = v_uid and a.message_id is null;
  return found;
end $$;
revoke all on function public.discard_message_attachment(uuid) from public, anon;
grant execute on function public.discard_message_attachment(uuid) to authenticated;

-- --- Lista załączników wysłanych wiadomości (wątek) ---------------------------------------
create or replace function public.get_message_attachments(p_message_ids uuid[])
returns table (
  id uuid, message_id uuid, "position" smallint, file_name text, mime_type text,
  size_bytes bigint, downloadable boolean
) language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.message_id, a.position, f.file_name, f.mime_type, f.size_bytes,
         f.scan_status in ('clean', 'skipped')
    from public.message_attachments a
    join public.messages m on m.id = a.message_id and m.deleted_at is null
    join public.files f on f.id = a.file_id and f.deleted_at is null
   where a.message_id = any(coalesce(p_message_ids, '{}'::uuid[]))
     and cardinality(coalesce(p_message_ids, '{}'::uuid[])) <= 200
     and public.message_attachment_visible(a.conversation_id, a.uploader_id, a.message_id)
   order by a.message_id, a.position
$$;
revoke all on function public.get_message_attachments(uuid[]) from public, anon;
grant execute on function public.get_message_attachments(uuid[]) to authenticated;

-- --- Metadane do pobrania (link i trasa pobrania sprawdzają to przy KAŻDYM żądaniu) -------
create or replace function public.get_message_attachment_download(p_attachment_id uuid)
returns table (id uuid, conversation_id uuid, path text, file_name text, mime_type text, size_bytes bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.conversation_id, f.path, f.file_name, f.mime_type, f.size_bytes
    from public.message_attachments a
    join public.messages m on m.id = a.message_id and m.deleted_at is null
    join public.files f on f.id = a.file_id and f.deleted_at is null
   where a.id = p_attachment_id
     and f.entity_type = 'message_attachment'
     and f.scan_status in ('clean', 'skipped')
     and public.message_attachment_visible(a.conversation_id, a.uploader_id, a.message_id)
$$;
revoke all on function public.get_message_attachment_download(uuid) from public, anon;
grant execute on function public.get_message_attachment_download(uuid) to authenticated;

-- --- Sprzątanie porzuconych uploadów (service_role, /api/maintenance) ---------------------
create or replace function public.purge_stale_message_attachments(
  p_older_than_hours integer default 24, p_limit integer default 500)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  delete from public.message_attachments a
   where a.id in (select x.id from public.message_attachments x
                   where x.message_id is null
                     and x.created_at < now() - make_interval(hours => greatest(1, coalesce(p_older_than_hours, 24)))
                   order by x.created_at
                   limit greatest(1, least(coalesce(p_limit, 500), 1000))
                   for update skip locked);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.purge_stale_message_attachments(integer, integer) from public, anon, authenticated;
grant execute on function public.purge_stale_message_attachments(integer, integer) to service_role;

-- --- send_message z załącznikami ---------------------------------------------------------
drop function if exists public.send_message(uuid, text, uuid);

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
  v_linked integer;
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

revoke all on function public.send_message(uuid, text, uuid, uuid[]) from public;
grant execute on function public.send_message(uuid, text, uuid, uuid[]) to authenticated;
