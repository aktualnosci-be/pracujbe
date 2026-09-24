-- =============================================================================
-- 0096 — jednorazowa aplikacja bez pełnego konta (#98).
--
-- Przepływ:
--   1. `submit_guest_application` (service_role, woła je Server Action po Turnstile i rate
--      limicie) zapisuje ZGŁOSZENIE w `guest_application_requests` (status `pending`) ze
--      snapshotem zgody (aktualna wersja polityki prywatności z `consent_versions`, locale,
--      IP, UA, czas) i kolejkuje e-mail `guestApplicationConfirm` na podany adres. Firma
--      niczego jeszcze nie widzi.
--   2. `confirm_guest_application` (service_role) — po kliknięciu linku z e-maila (token
--      jednorazowy, 48 h) tworzy aplikację z `candidate_id = NULL` i snapshotem imienia,
--      e-maila i telefonu, powiadamia recruiter+ firmy (in-app + `newApplication` w języku
--      ODBIORCY) i kolejkuje do gościa `guestApplicationSent` z tokenem przejęcia (30 dni).
--   3. `claim_guest_application` (authenticated) — zalogowany kandydat ze ZWERYFIKOWANYM
--      e-mailem równym adresowi zgłoszenia przejmuje aplikację tokenem z e-maila. Token działa
--      raz; obca sesja (inny adres) dostaje NOT_FOUND. Historia statusów zostaje, profil
--      kandydata nie jest publikowany (is_searchable bez zmian).
--   4. `purge_guest_application_requests` (service_role, /api/maintenance co godzinę) —
--      retencja: niepotwierdzone zgłoszenia usuwane 7 dni po wydaniu ostatniego linku,
--      duplikaty 7 dni po potwierdzeniu (razem z ich wierszami `email_deliveries`); po
--      wygaśnięciu okna przejęcia zeruje token.
--
-- Tokeny: baza przechowuje WYŁĄCZNIE hash SHA-256 tokenu (hex) i losowy `nonce`. Token =
-- HMAC-SHA256(GUEST_APPLY_SECRET, cel + nonce) liczy serwer aplikacji (Server Action przy
-- zapisie i worker e-mail przy renderze linku), więc sam odczyt bazy nie pozwala go odtworzyć.
--
-- Idempotencja: klucz żądania (unikat) = ponowienie tego samego wysłania; jedno oczekujące
-- zgłoszenie na (oferta, e-mail); częściowy unikat `applications(job_id, guest_email)` =
-- jedna aplikacja gościa na (oferta, e-mail); potwierdzenie i przejęcie są idempotentne.
--
-- Zmiany w istniejących obiektach:
--   * applications: candidate_id może być NULL (tylko z kompletem snapshotu gościa),
--     kolumny guest_name/guest_email/guest_request_id/claimed_at;
--   * enforce_application_integrity (0020): porównania odporne na NULL, niezmienne pola
--     gościa, zmiana candidate_id wyłącznie NULL → auth.uid() wewnątrz claim_guest_application;
--   * transition_application (0073): aplikacja gościa nie ma profilu odbiorcy — bez
--     powiadomienia/e-maila kandydata (reszta 1:1);
--   * trigger na conversations: rozmowa wymaga konta kandydata (aplikacja gościa → błąd);
--   * record_screening_answers (0093): `p_application_id` NULL = sama walidacja (te same
--     reguły co apply_to_job) — zgłoszenie gościa sprawdza odpowiedzi na pytania oferty przy
--     wysłaniu, a potwierdzenie zapisuje je do aplikacji. Reszta funkcji 1:1 z 0093.
--
-- Rollback (bezpieczny, bez utraty zwykłych aplikacji):
--   delete from public.applications where candidate_id is null;
--   drop function submit_guest_application, confirm_guest_application,
--     claim_guest_application, purge_guest_application_requests, enqueue_guest_email,
--     guard_conversation_guest_application; drop trigger trg_conversations_guest_guard;
--   alter table applications drop constraint applications_candidate_or_guest_chk,
--     drop column guest_name, guest_email, guest_request_id, claimed_at,
--     alter column candidate_id set not null;
--   drop table public.guest_application_requests;
--   odtworzyć enforce_application_integrity z 0020, transition_application z 0073
--   i record_screening_answers z 0093.
-- =============================================================================

-- --- 1. Zgłoszenia gościa (przed potwierdzeniem e-maila) ------------------------------------
create table public.guest_application_requests (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.jobs(id) on delete cascade,
  email               public.citext not null check (char_length(email::text) between 3 and 254),
  full_name           text not null check (char_length(full_name) between 1 and 160),
  phone               text check (phone is null or char_length(phone) <= 40),
  availability        public.availability_status,
  message             text check (message is null or char_length(message) <= 4000),
  -- Odpowiedzi na pytania screeningowe oferty (#101), zwalidowane przy wysłaniu; po
  -- potwierdzeniu przechodzą do application_screening_answers i są tu zerowane.
  screening_answers   jsonb check (screening_answers is null or jsonb_typeof(screening_answers) = 'object'),
  -- Język, w którym gość wypełnił formularz = język ODBIORCY e-maili do gościa (Invariant #1;
  -- gość nie ma profilu z preferred/account/signup_locale).
  locale              text not null references public.supported_locales(code),
  idempotency_key     text not null unique check (char_length(idempotency_key) between 8 and 200),
  status              text not null default 'pending'
                      check (status in ('pending', 'confirmed', 'duplicate')),
  confirm_token_hash  text not null unique check (confirm_token_hash ~ '^[0-9a-f]{64}$'),
  confirm_nonce       text not null check (char_length(confirm_nonce) between 16 and 128),
  confirm_expires_at  timestamptz not null,
  confirmed_at        timestamptz,
  application_id      uuid references public.applications(id) on delete set null,
  claim_token_hash    text unique check (claim_token_hash is null or claim_token_hash ~ '^[0-9a-f]{64}$'),
  claim_nonce         text check (claim_nonce is null or char_length(claim_nonce) between 16 and 128),
  claim_expires_at    timestamptz,
  claimed_at          timestamptz,
  claimed_by          uuid references public.profiles(id) on delete set null,
  -- Snapshot zgody na przetwarzanie danych (wersja polityki prywatności, gdy opublikowana).
  consent_version_id  uuid references public.consent_versions(id) on delete set null,
  consent_document_version text,
  consent_accepted_at timestamptz not null,
  consent_ip          inet,
  consent_user_agent  text check (consent_user_agent is null or char_length(consent_user_agent) <= 512),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index guest_application_requests_pending_uq
  on public.guest_application_requests(job_id, email) where status = 'pending';
create index guest_application_requests_pending_exp_idx
  on public.guest_application_requests(confirm_expires_at) where status = 'pending';
create index guest_application_requests_duplicate_idx
  on public.guest_application_requests(confirmed_at) where status = 'duplicate';
create index guest_application_requests_claim_exp_idx
  on public.guest_application_requests(claim_expires_at) where claim_token_hash is not null;

-- Brak grantów i brak polityk: odczyt/zapis wyłącznie przez RPC poniżej.
alter table public.guest_application_requests enable row level security;
revoke all on public.guest_application_requests from public, anon, authenticated;

drop trigger if exists trg_guest_application_requests_updated_at on public.guest_application_requests;
create trigger trg_guest_application_requests_updated_at
  before update on public.guest_application_requests
  for each row execute function public.set_updated_at();

-- --- 2. applications: aplikacja gościa -------------------------------------------------------
alter table public.applications
  alter column candidate_id drop not null,
  add column guest_name       text check (guest_name is null or char_length(guest_name) between 1 and 160),
  add column guest_email      public.citext check (guest_email is null or char_length(guest_email::text) between 3 and 254),
  add column guest_request_id uuid references public.guest_application_requests(id) on delete set null,
  add column claimed_at       timestamptz,
  add constraint applications_candidate_or_guest_chk
    check (candidate_id is not null or (guest_name is not null and guest_email is not null));

-- Jedna aktywna aplikacja gościa na (oferta, e-mail) — także po przejęciu na konto.
create unique index uq_applications_guest_email_job
  on public.applications(job_id, guest_email)
  where guest_email is not null and deleted_at is null;

-- --- 3. Integralność aplikacji (0020) + przejęcie przez konto -----------------------------
create or replace function public.enforce_application_integrity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.candidate_id := auth.uid();
      new.company_id := (select company_id from public.jobs where id = new.job_id);
      new.match_score := null;
      -- Aplikacja z sesją nigdy nie jest aplikacją gościa.
      new.guest_name := null; new.guest_email := null; new.guest_request_id := null; new.claimed_at := null;
      if new.status is null or new.status not in ('draft', 'submitted') then
        new.status := 'submitted';
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if auth.uid() is not null then
      -- Jedyna dozwolona zmiana kandydata: przejęcie aplikacji gościa (NULL → auth.uid())
      -- wewnątrz claim_guest_application (flaga transakcji z id tej aplikacji).
      if new.candidate_id is distinct from old.candidate_id
         and not (old.candidate_id is null
                  and new.candidate_id = auth.uid()
                  and new.claimed_at is not null
                  and coalesce(current_setting('pracujbe.guest_claim', true), '') = new.id::text) then
        raise exception 'PERMISSION_DENIED: nie można zmienić powiązań aplikacji' using errcode = '42501';
      end if;
      if new.job_id is distinct from old.job_id
         or new.company_id is distinct from old.company_id then
        raise exception 'PERMISSION_DENIED: nie można zmienić powiązań aplikacji' using errcode = '42501';
      end if;
      if new.message is distinct from old.message
         or new.phone is distinct from old.phone
         or new.availability is distinct from old.availability
         or new.locale is distinct from old.locale
         or new.idempotency_key is distinct from old.idempotency_key
         or new.match_score is distinct from old.match_score
         or new.submitted_at is distinct from old.submitted_at
         or new.guest_name is distinct from old.guest_name
         or new.guest_email is distinct from old.guest_email
         or new.guest_request_id is distinct from old.guest_request_id
         or (new.claimed_at is distinct from old.claimed_at
             and new.candidate_id is not distinct from old.candidate_id) then
        raise exception 'PERMISSION_DENIED: pola aplikacji są niezmienne po wysłaniu' using errcode = '42501';
      end if;
      -- Kandydat (właściciel): może jedynie wycofać aplikację.
      if new.candidate_id = auth.uid()
         and new.status is distinct from old.status
         and new.status <> 'withdrawn' then
        raise exception 'PERMISSION_DENIED: kandydat może jedynie wycofać aplikację' using errcode = '42501';
      end if;
      -- Firma (nie kandydat; także aplikacja gościa z candidate_id NULL): status tylko z
      -- allow-listy transition_application.
      if new.candidate_id is distinct from auth.uid()
         and new.status is distinct from old.status
         and new.status not in ('viewed','shortlisted','interview','offer_sent','rejected','hired') then
        raise exception 'PERMISSION_DENIED: niedozwolone przejście statusu aplikacji przez firmę'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $function$;

-- --- 4. transition_application (0073) — aplikacja gościa bez powiadomień kandydata --------
create or replace function public.transition_application(
  p_application_id uuid,
  p_target text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_job uuid; v_candidate uuid; v_from public.application_status;
        v_to public.application_status; v_job_title text; v_company_name text; v_allowed boolean;
        v_history uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  if p_target is null or p_target not in ('viewed','shortlisted','interview','offer_sent','rejected','hired') then
    raise exception 'VALIDATION_FAILED: niedozwolony status docelowy' using errcode = '42501';
  end if;
  v_to := p_target::public.application_status;

  select a.job_id, a.candidate_id, a.status, j.title, c.name
    into v_job, v_candidate, v_from, v_job_title, v_company_name
    from public.applications a
    join public.jobs j on j.id = a.job_id
    join public.companies c on c.id = j.company_id
    where a.id = p_application_id
    for update of a;

  if v_job is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_job_manager(v_job) then
    raise exception 'PERMISSION_DENIED: zmiana statusu wymaga roli recruiter+' using errcode = '42501';
  end if;
  if v_from = v_to then return; end if; -- idempotencja (retry nie tworzy przejścia ani e-maila)

  v_allowed := case v_from
    when 'draft'       then v_to in ('viewed','shortlisted','interview','offer_sent','rejected')
    when 'submitted'   then v_to in ('viewed','shortlisted','interview','offer_sent','rejected')
    when 'viewed'      then v_to in ('shortlisted','interview','offer_sent','rejected','hired')
    when 'shortlisted' then v_to in ('interview','offer_sent','rejected','hired')
    when 'interview'   then v_to in ('shortlisted','offer_sent','rejected','hired')
    when 'offer_sent'  then v_to in ('hired','rejected')
    else false
  end;
  if not v_allowed then
    raise exception 'VALIDATION_FAILED: niedozwolone przejście statusu % -> %', v_from, v_to
      using errcode = '42501';
  end if;

  update public.applications set status = v_to, updated_at = now()
    where id = p_application_id and status = v_from;
  if not found then
    raise exception 'VALIDATION_FAILED: stan aplikacji zmienił się równolegle' using errcode = '42501';
  end if;

  select h.id into v_history
    from public.application_status_history h
    where h.application_id = p_application_id and h.from_status = v_from and h.to_status = v_to
    order by h.created_at desc, h.id desc
    limit 1;
  if v_history is null then
    raise exception 'INTERNAL: brak wpisu historii statusu' using errcode = 'P0001';
  end if;

  -- #98: aplikacja gościa (bez konta) nie ma profilu odbiorcy powiadomienia ani e-maila.
  -- Historia i audyt zapisują się jak zwykle; po przejęciu kandydat widzi pełną historię.
  if v_candidate is null then return; end if;

  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    values (v_candidate, 'application_status_changed', 'application_status_changed', 'application', p_application_id);

  if v_to = 'viewed' then
    perform public.enqueue_email(v_candidate, 'applicationViewed', 'application', p_application_id,
                                 'appstatus-' || p_application_id::text || '-' || v_history::text,
                                 jsonb_build_object('companyName', coalesce(v_company_name, ''),
                                                    'jobTitle', coalesce(v_job_title, '')));
  else
    perform public.enqueue_email(v_candidate, 'statusChanged', 'application', p_application_id,
                                 'appstatus-' || p_application_id::text || '-' || v_history::text,
                                 jsonb_build_object('companyName', coalesce(v_company_name, ''),
                                                    'jobTitle', coalesce(v_job_title, ''),
                                                    'status', v_to::text));
  end if;
end $$;

-- --- 5. Rozmowa wymaga konta kandydata --------------------------------------------------------
-- get_or_create_conversation (0016) dodaje kandydata jako uczestnika; aplikacja gościa nie ma
-- profilu, więc zamiast błędu wstawienia pustego uczestnika zwracamy kontrolowany kod.
create or replace function public.guard_conversation_guest_application()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.application_id is not null and exists (
    select 1 from public.applications a where a.id = new.application_id and a.candidate_id is null
  ) then
    raise exception 'VALIDATION_FAILED: GUEST_APPLICATION' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_conversation_guest_application() from public, anon, authenticated;

drop trigger if exists trg_conversations_guest_guard on public.conversations;
create trigger trg_conversations_guest_guard
  before insert on public.conversations
  for each row execute function public.guard_conversation_guest_application();

-- --- 6. Kolejka e-mail na adres bez konta ------------------------------------------------------
-- Odpowiednik enqueue_email dla gościa: odbiorca bez profilu, język = locale zgłoszenia.
create or replace function public.enqueue_guest_email(
  p_to_email public.citext,
  p_locale text,
  p_type text,
  p_entity_id uuid,
  p_idempotency_key text,
  p_payload jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_type not in ('guestApplicationConfirm', 'guestApplicationSent') then
    raise exception 'VALIDATION_FAILED: nieznany typ e-maila gościa' using errcode = '42501';
  end if;
  insert into public.email_deliveries
    (profile_id, to_email, template, locale, subject, status, entity_type, entity_id,
     idempotency_key, payload, queued_at, next_attempt_at, attempts)
  values
    (null, p_to_email, p_type,
     case when public.is_supported_locale(p_locale) then p_locale else 'en' end,
     p_type, 'queued', 'guest_application_request', p_entity_id,
     p_idempotency_key, coalesce(p_payload, '{}'::jsonb), now(), now(), 0)
  on conflict (idempotency_key) where idempotency_key is not null
    do nothing;
end $$;
revoke all on function public.enqueue_guest_email(public.citext, text, text, uuid, text, jsonb)
  from public, anon, authenticated;

-- --- 6b. Walidacja odpowiedzi bez aplikacji (0093 + tryb gościa) ------------------------------
create or replace function public.record_screening_answers(p_application_id uuid, p_job_id uuid, p_answers jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a jsonb := coalesce(p_answers, '{}'::jsonb);
  q record; v jsonb; v_text text; v_date date; v_bad text;
  v_bool boolean; v_ans_date date; v_ans_text text;
begin
  if jsonb_typeof(a) <> 'object' then
    raise exception 'VALIDATION_FAILED: odpowiedzi' using errcode = '42501';
  end if;
  select k into v_bad from jsonb_object_keys(a) k
    where not exists (select 1 from public.job_screening_questions sq
                      where sq.job_id = p_job_id and sq.id::text = k)
    limit 1;
  if v_bad is not null then
    raise exception 'VALIDATION_FAILED: odpowiedź na nieznane pytanie' using errcode = '42501';
  end if;

  for q in select * from public.job_screening_questions where job_id = p_job_id order by position loop
    v := a->(q.id::text);
    v_bool := null; v_ans_date := null; v_ans_text := null;
    -- Brak odpowiedzi: brak klucza, JSON null albo pusty tekst.
    if v is not null and jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '' then v := null; end if;
    if v is not null and jsonb_typeof(v) = 'null' then v := null; end if;

    if v is not null then
      if q.type = 'yes_no' then
        if jsonb_typeof(v) <> 'boolean' then
          raise exception 'VALIDATION_FAILED: odpowiedź tak/nie' using errcode = '42501';
        end if;
        v_bool := (v #>> '{}')::boolean;
      elsif jsonb_typeof(v) <> 'string' then
        raise exception 'VALIDATION_FAILED: odpowiedź' using errcode = '42501';
      else
        v_text := btrim(v #>> '{}');
        if q.type = 'single_choice' then
          if not exists (select 1 from jsonb_array_elements(q.options) o where o->>'id' = v_text) then
            raise exception 'VALIDATION_FAILED: nieznana opcja' using errcode = '42501';
          end if;
          v_ans_text := v_text;
        elsif q.type = 'date' then
          if v_text !~ '^\d{4}-\d{2}-\d{2}$' then
            raise exception 'VALIDATION_FAILED: data' using errcode = '42501';
          end if;
          begin
            v_date := v_text::date;
          exception when others then
            raise exception 'VALIDATION_FAILED: data' using errcode = '42501';
          end;
          if v_date not between date '1900-01-01' and date '2100-12-31' then
            raise exception 'VALIDATION_FAILED: data' using errcode = '42501';
          end if;
          v_ans_date := v_date;
        else
          if length(v_text) > 500 then
            raise exception 'VALIDATION_FAILED: odpowiedź za długa' using errcode = '42501';
          end if;
          v_ans_text := v_text;
        end if;
      end if;
    elsif q.required then
      raise exception 'SCREENING_ANSWER_REQUIRED: %', q.id using errcode = '23514';
    end if;

    -- #98: bez aplikacji (zgłoszenie gościa przed potwierdzeniem) — tylko walidacja.
    if p_application_id is not null then
      insert into public.application_screening_answers
        (application_id, question_id, position, type, required, prompt, options,
         answer_boolean, answer_date, answer_text)
      values (p_application_id, q.id, q.position, q.type, q.required, q.prompt, q.options,
              v_bool, v_ans_date, v_ans_text);
    end if;
  end loop;
end $$;

revoke all on function public.record_screening_answers(uuid, uuid, jsonb) from public, anon, authenticated;

-- --- 7. submit_guest_application ---------------------------------------------------------------
-- Wynik zawsze neutralny („sprawdź skrzynkę”): nie ujawnia, czy adres już aplikował ani czy ma
-- konto. Duplikat wykrywa dopiero potwierdzenie (właściciel adresu).
create or replace function public.submit_guest_application(
  p_job_id             uuid,
  p_email              text,
  p_full_name          text,
  p_phone              text,
  p_availability       text,
  p_message            text,
  p_locale             text,
  p_idempotency_key    text,
  p_confirm_nonce      text,
  p_confirm_token_hash text,
  p_ip                 text default null,
  p_user_agent         text default null,
  p_answers            jsonb default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email public.citext; v_name text; v_locale text; v_id uuid; v_existing record;
  v_job_title text; v_company_name text; v_slug text;
  v_version_id uuid; v_version text; v_ip inet;
begin
  v_email := lower(btrim(coalesce(p_email, '')))::public.citext;
  v_name := btrim(coalesce(p_full_name, ''));
  v_locale := case when public.is_supported_locale(p_locale) then p_locale else null end;
  if v_email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email::text) > 254
     or char_length(v_name) not between 1 and 160
     or v_locale is null
     or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200
     or p_confirm_token_hash is null or p_confirm_token_hash !~ '^[0-9a-f]{64}$'
     or p_confirm_nonce is null or char_length(p_confirm_nonce) not between 16 and 128
     or (p_phone is not null and char_length(p_phone) > 40)
     or (p_message is not null and char_length(p_message) > 4000) then
    raise exception 'VALIDATION_FAILED' using errcode = '42501';
  end if;

  -- Ponowienie tego samego wysłania (retry/podwójne kliknięcie) → to samo zgłoszenie, bez maila.
  select id, job_id, email into v_existing
    from public.guest_application_requests where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.job_id <> p_job_id or v_existing.email <> v_email then
      raise exception 'VALIDATION_FAILED: klucz idempotencji użyty dla innego zgłoszenia' using errcode = '42501';
    end if;
    return v_existing.id;
  end if;

  if not public.job_is_public(p_job_id) then raise exception 'JOB_NOT_ACTIVE' using errcode = '42501'; end if;
  -- #101: te same reguły odpowiedzi co apply_to_job (SCREENING_ANSWER_REQUIRED: <id> itd.).
  perform public.record_screening_answers(null, p_job_id, p_answers);
  select j.title, c.name, j.slug into v_job_title, v_company_name, v_slug
    from public.jobs j join public.companies c on c.id = j.company_id where j.id = p_job_id;

  -- Snapshot zgody: aktualna wersja polityki prywatności (preferuj język formularza).
  select id, version into v_version_id, v_version from public.consent_versions
    where document = 'privacy' and is_current = true
    order by (locale = v_locale) desc nulls last, published_at desc nulls last, created_at desc
    limit 1;
  begin
    v_ip := nullif(btrim(coalesce(p_ip, '')), '')::inet;
  exception when others then v_ip := null; end;

  -- Jedno oczekujące zgłoszenie na (oferta, e-mail): nowe wysłanie zastępuje dane i token
  -- poprzedniego (stary link przestaje działać), a e-mail z nowym linkiem idzie ponownie.
  -- Nadużycia (zalewanie cudzej skrzynki) ogranicza rate limit per IP i per adres w akcji.
  perform pg_advisory_xact_lock(hashtextextended('guest-apply:' || p_job_id::text || ':' || v_email::text, 0));
  update public.guest_application_requests
     set full_name = v_name, phone = nullif(btrim(coalesce(p_phone, '')), ''),
         availability = nullif(p_availability, '')::public.availability_status,
         message = nullif(btrim(coalesce(p_message, '')), ''), locale = v_locale,
         screening_answers = p_answers,
         idempotency_key = p_idempotency_key,
         confirm_token_hash = p_confirm_token_hash, confirm_nonce = p_confirm_nonce,
         confirm_expires_at = now() + interval '48 hours',
         consent_version_id = v_version_id, consent_document_version = v_version,
         consent_accepted_at = now(), consent_ip = v_ip,
         consent_user_agent = nullif(left(coalesce(p_user_agent, ''), 512), '')
   where job_id = p_job_id and email = v_email and status = 'pending'
   returning id into v_id;

  if v_id is null then
    insert into public.guest_application_requests
      (job_id, email, full_name, phone, availability, message, screening_answers, locale, idempotency_key,
       confirm_token_hash, confirm_nonce, confirm_expires_at,
       consent_version_id, consent_document_version, consent_accepted_at, consent_ip, consent_user_agent)
    values
      (p_job_id, v_email, v_name, nullif(btrim(coalesce(p_phone, '')), ''),
       nullif(p_availability, '')::public.availability_status,
       nullif(btrim(coalesce(p_message, '')), ''), p_answers, v_locale, p_idempotency_key,
       p_confirm_token_hash, p_confirm_nonce, now() + interval '48 hours',
       v_version_id, v_version, now(), v_ip, nullif(left(coalesce(p_user_agent, ''), 512), ''))
    returning id into v_id;
  end if;

  perform public.enqueue_guest_email(v_email, v_locale, 'guestApplicationConfirm', v_id,
    'guest-confirm-' || v_id::text || '-' || left(p_confirm_token_hash, 16),
    jsonb_build_object('nonce', p_confirm_nonce, 'recipientName', v_name,
                       'jobTitle', coalesce(v_job_title, ''), 'companyName', coalesce(v_company_name, ''),
                       'jobSlug', coalesce(v_slug, '')));
  return v_id;
end $$;
revoke all on function public.submit_guest_application(uuid, text, text, text, text, text, text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_guest_application(uuid, text, text, text, text, text, text, text, text, text, text, text, jsonb)
  to service_role;

-- --- 8. confirm_guest_application --------------------------------------------------------------
-- outcome: confirmed | already_confirmed | duplicate | expired | job_closed | invalid.
create or replace function public.confirm_guest_application(
  p_token_hash       text,
  p_claim_nonce      text,
  p_claim_token_hash text
) returns table (outcome text, locale text, job_slug text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.guest_application_requests; v_company uuid; v_job_title text; v_company_name text;
        v_slug text; v_app_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_claim_token_hash is null or p_claim_token_hash !~ '^[0-9a-f]{64}$'
     or p_claim_nonce is null or char_length(p_claim_nonce) not between 16 and 128 then
    return query select 'invalid'::text, null::text, null::text; return;
  end if;

  select * into r from public.guest_application_requests g
    where g.confirm_token_hash = p_token_hash for update;
  if not found then return query select 'invalid'::text, null::text, null::text; return; end if;

  select j.company_id, j.title, c.name, j.slug into v_company, v_job_title, v_company_name, v_slug
    from public.jobs j join public.companies c on c.id = j.company_id where j.id = r.job_id;

  -- Ponowne kliknięcie tego samego linku: bez skutków (brak drugiej aplikacji i e-maili).
  if r.status = 'confirmed' then
    return query select 'already_confirmed'::text, r.locale, v_slug; return;
  end if;
  if r.status = 'duplicate' then
    return query select 'duplicate'::text, r.locale, v_slug; return;
  end if;
  if r.confirm_expires_at <= now() then
    return query select 'expired'::text, r.locale, v_slug; return;
  end if;
  if not public.job_is_public(r.job_id) then
    return query select 'job_closed'::text, r.locale, v_slug; return;
  end if;

  -- Ten adres już aplikował na tę ofertę (jako gość albo z konta o tym adresie).
  if exists (select 1 from public.applications a
               where a.job_id = r.job_id and a.guest_email = r.email and a.deleted_at is null)
     or exists (select 1 from public.applications a join auth.users u on u.id = a.candidate_id
                  where a.job_id = r.job_id and a.deleted_at is null and lower(u.email::text) = lower(r.email::text)) then
    update public.guest_application_requests
       set status = 'duplicate', confirmed_at = now(), phone = null, message = null, screening_answers = null
     where id = r.id;
    return query select 'duplicate'::text, r.locale, v_slug; return;
  end if;

  insert into public.applications
    (job_id, candidate_id, company_id, status, phone, availability, message, locale,
     idempotency_key, submitted_at, guest_name, guest_email, guest_request_id)
  values
    (r.job_id, null, v_company, 'submitted', r.phone, r.availability, r.message, r.locale,
     'guest-' || r.id::text, now(), r.full_name, r.email, r.id)
  on conflict (job_id, guest_email) where guest_email is not null and deleted_at is null do nothing
  returning id into v_app_id;
  if v_app_id is null then
    update public.guest_application_requests
       set status = 'duplicate', confirmed_at = now(), phone = null, message = null, screening_answers = null
     where id = r.id;
    return query select 'duplicate'::text, r.locale, v_slug; return;
  end if;

  -- #101: odpowiedzi na pytania oferty trafiają do aplikacji jak w apply_to_job (snapshot).
  perform public.record_screening_answers(v_app_id, r.job_id, r.screening_answers);

  -- Minimalizacja: telefon, wiadomość i odpowiedzi żyją już tylko w aplikacji; zgłoszenie
  -- trzyma snapshot zgody, adres (do przejęcia) i hash tokenu przejęcia.
  update public.guest_application_requests
     set status = 'confirmed', confirmed_at = now(), application_id = v_app_id,
         phone = null, message = null, screening_answers = null,
         claim_token_hash = p_claim_token_hash, claim_nonce = p_claim_nonce,
         claim_expires_at = now() + interval '30 days'
   where id = r.id;

  -- Firma: jak w apply_to_job — tylko aktywni recruiter+ z aktywnym profilem (0070), e-mail
  -- w języku ODBIORCY (enqueue_email → resolve_recipient_locale).
  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    select cm.profile_id, 'application_received', 'application_received', 'application', v_app_id
    from public.company_members cm
    where cm.company_id = v_company and public.company_recipient_ok(v_company, cm.profile_id);

  perform public.enqueue_email(cm.profile_id, 'newApplication', 'application', v_app_id,
                               'app-' || v_app_id::text || '-' || cm.profile_id::text,
                               jsonb_build_object('candidateName', r.full_name,
                                                  'jobTitle', coalesce(v_job_title, '')))
    from public.company_members cm
    where cm.company_id = v_company and public.company_recipient_ok(v_company, cm.profile_id);

  perform public.enqueue_guest_email(r.email, r.locale, 'guestApplicationSent', r.id,
    'guest-sent-' || r.id::text,
    jsonb_build_object('nonce', p_claim_nonce, 'recipientName', r.full_name,
                       'jobTitle', coalesce(v_job_title, ''), 'companyName', coalesce(v_company_name, '')));

  return query select 'confirmed'::text, r.locale, v_slug;
end $$;
revoke all on function public.confirm_guest_application(text, text, text) from public, anon, authenticated;
grant execute on function public.confirm_guest_application(text, text, text) to service_role;

-- --- 9. claim_guest_application ----------------------------------------------------------------
-- Zalogowany kandydat ze zweryfikowanym adresem = adres zgłoszenia. Zwraca id aplikacji.
create or replace function public.claim_guest_application(p_claim_token_hash text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_email public.citext; r public.guest_application_requests;
        v_app public.applications;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if public.current_profile_role() <> 'candidate' then
    raise exception 'PERMISSION_DENIED: przejąć aplikację może tylko konto kandydata' using errcode = '42501';
  end if;
  if p_claim_token_hash is null or p_claim_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_email := public.current_verified_email();
  if v_email is null then raise exception 'EMAIL_NOT_VERIFIED' using errcode = '42501'; end if;

  -- Token jednorazowy: przejmuje go dokładnie jedno konto. Ponowienie przez to samo konto
  -- (retry po zerwanym połączeniu) zwraca tę samą aplikację; każde inne → NOT_FOUND.
  select * into r from public.guest_application_requests g
    where g.claim_token_hash = p_claim_token_hash and g.status = 'confirmed' for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if r.claimed_at is not null then
    if r.claimed_by = v_uid and r.application_id is not null then return r.application_id; end if;
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Obca sesja (inny adres) — ta sama odpowiedź co brak tokenu.
  if r.email <> v_email then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if r.claim_expires_at is null or r.claim_expires_at <= now() then
    raise exception 'CLAIM_EXPIRED' using errcode = '42501';
  end if;

  select * into v_app from public.applications a
    where a.id = r.application_id and a.deleted_at is null for update;
  if not found or v_app.candidate_id is not null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.applications a
               where a.candidate_id = v_uid and a.job_id = v_app.job_id) then
    raise exception 'APPLICATION_ALREADY_EXISTS' using errcode = '23505';
  end if;

  perform set_config('pracujbe.guest_claim', v_app.id::text, true);
  update public.applications
     set candidate_id = v_uid, claimed_at = now(), updated_at = now()
   where id = v_app.id;
  perform set_config('pracujbe.guest_claim', '', true);

  update public.guest_application_requests
     set claimed_at = now(), claimed_by = v_uid, claim_nonce = null
   where id = r.id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after_data)
    values (v_uid, 'application.guest_claimed', 'application', v_app.id,
            jsonb_build_object('job_id', v_app.job_id, 'company_id', v_app.company_id));
  return v_app.id;
end $$;
revoke all on function public.claim_guest_application(text) from public, anon;
grant execute on function public.claim_guest_application(text) to authenticated;

-- --- 10. Retencja (/api/maintenance) -------------------------------------------------------------
-- * pending 7 dni po wydaniu OSTATNIEGO linku (confirm_expires_at = wydanie + 48 h, więc
--   5 dni po wygaśnięciu; ponowne wysłanie formularza odsuwa termin) i duplicate 7 dni po
--   potwierdzeniu → usunięte (wraz z ich e-mailami w email_deliveries);
-- * confirmed po wygaśnięciu okna przejęcia → token przejęcia wyzerowany (wiersz zostaje jako
--   snapshot zgody powiązany z aplikacją).
create or replace function public.purge_guest_application_requests()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ids uuid[]; v_count integer;
begin
  select coalesce(array_agg(id), '{}') into v_ids
    from (select id from public.guest_application_requests
           where (status = 'pending' and confirm_expires_at < now() - interval '5 days')
              or (status = 'duplicate' and coalesce(confirmed_at, created_at) < now() - interval '7 days')
           order by created_at
           limit 5000
           for update skip locked) s;
  -- Także zakolejkowany (niewysłany) e-mail do usuwanego zgłoszenia — link i tak wygasł.
  delete from public.email_deliveries
   where entity_type = 'guest_application_request' and entity_id = any(v_ids);
  delete from public.guest_application_requests where id = any(v_ids);
  get diagnostics v_count = row_count;

  update public.guest_application_requests
     set claim_token_hash = null, claim_nonce = null
   where claim_token_hash is not null and claim_expires_at <= now();
  -- Przejęte: hash zostaje do końca okna (ponowienie przez to samo konto), potem jak wyżej.
  return v_count;
end $$;
revoke all on function public.purge_guest_application_requests() from public, anon, authenticated;
grant execute on function public.purge_guest_application_requests() to service_role;
