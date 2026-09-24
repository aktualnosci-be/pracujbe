-- =============================================================================
-- 0094 — publiczne zgłoszenia treści (DSA) i trwały model sprawy (#41).
--
-- 1. `reports` dostaje rodzaj (`kind`): `quality` (dotychczasowe zgłoszenia) albo
--    `dsa_notice` (zgłoszenie treści z publicznego formularza). Sprawa `dsa_notice` ma:
--    niezgadywalny numer (`case_number`, 64 bity losowe), skrót kodu dostępu zgłaszającego
--    (`access_code_hash`, SHA-256 — sam kod zna tylko zgłaszający), klucz idempotencji,
--    kategorię, opis, adres treści, kontakt zgłaszającego, język zgłaszającego, znacznik
--    oświadczenia, zapis dowodu (`target_snapshot` — stan treści w chwili zgłoszenia,
--    zbudowany w bazie, nie z danych klienta) i termin (`due_at`).
-- 2. Niezmienność: trigger `reports_notice_immutable` (dla KAŻDEJ roli, także service_role)
--    blokuje zmianę pól zgłoszenia `dsa_notice` i jego usunięcie. Zmienia się tylko stan
--    sprawy (status, resolved_*). `reporter_id` może jedynie przejść na null (FK przy
--    usunięciu konta).
-- 3. `report_events` — historia sprawy tylko do dopisywania (submitted, status_changed),
--    zapisywana triggerami; zmiana statusu przez istniejące `admin_resolve_report` trafia
--    tu automatycznie. Zgłaszający widzi zdarzenia swoich spraw (RLS, bez `actor_id`).
-- 4. Zapis wyłącznie przez RPC: klient traci INSERT na `reports` (polityka
--    `reports_insert_own` usunięta; aplikacja nie zapisywała zgłoszeń bezpośrednio).
--    `submit_content_report` i `get_report_case` mają EXECUTE tylko dla service_role —
--    woła je Server Action po Turnstile i limiterze (inaczej anon omijałby obie warstwy
--    przez PostgREST). Tożsamość zalogowanego zgłaszającego podaje serwer z sesji.
-- 5. Zgłaszać można tylko treść publiczną: ofertę widoczną publicznie (`job_is_public`)
--    albo firmę tej oferty. Nieistniejąca i prywatna treść daje ten sam NOT_FOUND.
-- 6. Limit w bazie (niezależny od limitera aplikacji): 5 spraw na adres e-mail w 24 h
--    i jedna otwarta sprawa na (adres, treść) — RATE_LIMITED bez ujawniania szczegółów.
-- 7. Potwierdzenie e-mail `reportReceived` przez outbox (`enqueue_email_to_address`) w języku
--    zgłaszającego: zalogowany — `resolve_recipient_locale` (Invariant #1), gość — język
--    formularza, który sam wybrał. Awaria poczty nie wpływa na sprawę (worker ponawia).
--
-- Wartości tymczasowe do potwierdzenia w mapie obowiązków (#40): katalog kategorii,
-- termin 7 dni, wymagalność imienia. Decyzje moderacyjne i egzekucja — #42, odwołania — #43.
--
-- Rollback (sprawy `dsa_notice` są dowodem — przed rollbackiem wyeksportować je razem
-- z `report_events`): drop function submit_content_report, get_report_case,
-- enqueue_email_to_address, reports_notice_immutable,
-- report_events_log, report_events_append_only; drop table report_events; delete
-- (albo archiwizacja) wierszy `kind = 'dsa_notice'`; drop nowych kolumn/ograniczeń/indeksów
-- `reports`; odtworzyć politykę `reports_insert_own` z 0009 i
-- `grant insert on public.reports to authenticated`. Migracja nie zmienia istniejących danych.
-- =============================================================================

-- --- 1. Kolumny sprawy -----------------------------------------------------------------
alter table public.reports
  add column if not exists kind             text not null default 'quality',
  add column if not exists case_number      text,
  add column if not exists access_code_hash text,
  add column if not exists idempotency_key  uuid,
  add column if not exists category         text,
  add column if not exists content_url      text,
  add column if not exists reporter_name    text,
  add column if not exists reporter_email   public.citext,
  add column if not exists reporter_locale  text references public.supported_locales(code),
  add column if not exists good_faith_at    timestamptz,
  add column if not exists target_snapshot  jsonb,
  add column if not exists due_at           timestamptz;

alter table public.reports
  add constraint reports_kind_chk check (kind in ('quality', 'dsa_notice')),
  add constraint reports_category_chk check (
    category is null
    or category in ('fraud', 'impersonation', 'discrimination', 'illegal_conditions', 'data_misuse', 'other')
  ),
  add constraint reports_content_url_length check (content_url is null or char_length(content_url) <= 2000),
  add constraint reports_reporter_name_length check (reporter_name is null or char_length(reporter_name) <= 200),
  add constraint reports_reporter_email_length check (
    reporter_email is null or char_length(reporter_email::text) between 3 and 254
  ),
  -- Sprawa DSA jest kompletna albo nie istnieje (także przy zapisie service_role).
  add constraint reports_dsa_notice_complete check (
    kind <> 'dsa_notice' or (
      case_number is not null and access_code_hash is not null and idempotency_key is not null
      and category is not null and details is not null and reporter_email is not null
      and reporter_locale is not null and good_faith_at is not null
      and target_snapshot is not null and due_at is not null
      and target_type in ('job', 'company')
    )
  );

create unique index if not exists reports_case_number_uq
  on public.reports(case_number) where case_number is not null;
create unique index if not exists reports_idempotency_key_uq
  on public.reports(idempotency_key) where idempotency_key is not null;
create index if not exists reports_kind_status_created_idx
  on public.reports(kind, status, created_at desc);
create index if not exists reports_reporter_email_idx
  on public.reports(reporter_email, created_at desc) where reporter_email is not null;

-- --- 2. Zapis tylko przez RPC ----------------------------------------------------------
drop policy if exists reports_insert_own on public.reports;
revoke insert, update, delete on public.reports from authenticated;
revoke all on public.reports from anon;

-- --- 3. Niezmienność zgłoszenia DSA ----------------------------------------------------
create or replace function public.reports_notice_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'dsa_notice' then
      raise exception 'PERMISSION_DENIED: sprawy zgłoszenia nie można usunąć' using errcode = '42501';
    end if;
    return old;
  end if;

  if old.kind = 'dsa_notice' or new.kind is distinct from old.kind then
    if new.kind is distinct from old.kind
       or new.case_number is distinct from old.case_number
       or new.access_code_hash is distinct from old.access_code_hash
       or new.idempotency_key is distinct from old.idempotency_key
       or new.category is distinct from old.category
       or new.content_url is distinct from old.content_url
       or new.reporter_name is distinct from old.reporter_name
       or new.reporter_email is distinct from old.reporter_email
       or new.reporter_locale is distinct from old.reporter_locale
       or new.good_faith_at is distinct from old.good_faith_at
       or new.target_snapshot is distinct from old.target_snapshot
       or new.due_at is distinct from old.due_at
       or new.target_type is distinct from old.target_type
       or new.target_id is distinct from old.target_id
       or new.reason is distinct from old.reason
       or new.details is distinct from old.details
       or new.created_at is distinct from old.created_at
       or (new.reporter_id is distinct from old.reporter_id and new.reporter_id is not null) then
      raise exception 'PERMISSION_DENIED: treść zgłoszenia jest niezmienna' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.reports_notice_immutable() from public;

drop trigger if exists trg_reports_notice_immutable on public.reports;
create trigger trg_reports_notice_immutable
  before update or delete on public.reports
  for each row execute function public.reports_notice_immutable();

-- --- 4. Historia sprawy ----------------------------------------------------------------
create table if not exists public.report_events (
  id          bigint generated always as identity primary key,
  report_id   uuid not null references public.reports(id) on delete cascade,
  event_type  text not null check (event_type in ('submitted', 'status_changed')),
  from_status public.report_status,
  to_status   public.report_status,
  actor_id    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists report_events_report_idx on public.report_events(report_id, id);

alter table public.report_events enable row level security;
revoke all on public.report_events from anon, authenticated;
-- Zgłaszający widzi historię swoich spraw; bez `actor_id` (tożsamość moderatora).
grant select (id, report_id, event_type, from_status, to_status, created_at)
  on public.report_events to authenticated;
drop policy if exists report_events_select_own on public.report_events;
create policy report_events_select_own on public.report_events
  for select to authenticated
  using (exists (
    select 1 from public.reports r
    where r.id = report_events.report_id and r.reporter_id = auth.uid()
  ));

create or replace function public.report_events_append_only()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Usunięcie przez kaskadę FK (pg_trigger_depth > 1) jest dozwolone; sprawy DSA i tak
  -- nie da się usunąć (reports_notice_immutable).
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'PERMISSION_DENIED: historia sprawy jest tylko do dopisywania' using errcode = '42501';
end $$;
revoke all on function public.report_events_append_only() from public;

drop trigger if exists trg_report_events_append_only on public.report_events;
create trigger trg_report_events_append_only
  before update or delete on public.report_events
  for each row execute function public.report_events_append_only();

create or replace function public.report_events_log()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.report_events(report_id, event_type, to_status, actor_id)
      values (new.id, 'submitted', new.status, new.reporter_id);
  elsif new.status is distinct from old.status then
    insert into public.report_events(report_id, event_type, from_status, to_status, actor_id)
      values (new.id, 'status_changed', old.status, new.status, auth.uid());
  end if;
  return null;
end $$;
revoke all on function public.report_events_log() from public;

drop trigger if exists trg_report_events_log on public.reports;
create trigger trg_report_events_log
  after insert or update of status on public.reports
  for each row execute function public.report_events_log();

-- --- 5. Outbox na adres bez profilu ----------------------------------------------------
-- Jak `enqueue_email` (0073), ale na jawny adres i jawny język odbiorcy — dla osoby bez
-- konta. Wiadomość transakcyjna (potwierdzenie sprawy), więc bez preferencji marketingowych.
create or replace function public.enqueue_email_to_address(
  p_email text,
  p_locale text,
  p_profile_id uuid,
  p_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.is_supported_locale(p_locale) is not true then
    raise exception 'VALIDATION_FAILED: nieobsługiwany język odbiorcy' using errcode = '22023';
  end if;
  insert into public.email_deliveries
    (profile_id, to_email, template, locale, subject, status, entity_type, entity_id,
     idempotency_key, payload, queued_at, next_attempt_at, attempts)
  values
    (p_profile_id, p_email, p_type, p_locale, p_type, 'queued', p_entity_type, p_entity_id,
     p_idempotency_key, coalesce(p_payload, '{}'::jsonb), now(), now(), 0)
  on conflict (idempotency_key) where idempotency_key is not null
    do nothing;
end $$;
revoke all on function public.enqueue_email_to_address(text, text, uuid, text, text, uuid, text, jsonb)
  from public, anon, authenticated;

-- --- 6. Zgłoszenie (RPC) ---------------------------------------------------------------
create or replace function public.submit_content_report(
  p_reporter_id     uuid,
  p_idempotency_key uuid,
  p_access_code     text,
  p_target_type     text,
  p_job_id          uuid,
  p_category        text,
  p_details         text,
  p_content_url     text,
  p_reporter_name   text,
  p_reporter_email  text,
  p_locale          text,
  p_good_faith      boolean
) returns table (report_id uuid, case_number text, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hash     text;
  v_email    public.citext;
  v_name     text := nullif(btrim(coalesce(p_reporter_name, '')), '');
  v_details  text := btrim(coalesce(p_details, ''));
  v_url      text := nullif(btrim(coalesce(p_content_url, '')), '');
  v_reporter uuid;
  v_locale   text;
  v_existing record;
  v_job      record;
  v_target   uuid;
  v_snapshot jsonb;
  v_case     text;
  v_id       uuid;
begin
  if p_idempotency_key is null then
    raise exception 'VALIDATION_FAILED: brak klucza idempotencji' using errcode = '22023';
  end if;
  if p_access_code is null or p_access_code !~ '^[A-Z2-7]{24}$' then
    raise exception 'VALIDATION_FAILED: kod dostępu' using errcode = '22023';
  end if;
  v_hash := encode(sha256(convert_to(p_access_code, 'UTF8')), 'hex');

  -- Ten sam klucz = to samo wysłanie (także przy wyścigu dwóch żądań).
  perform pg_advisory_xact_lock(hashtextextended('report:' || p_idempotency_key::text, 0));
  select r.id, r.case_number, r.access_code_hash into v_existing
    from public.reports r where r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.access_code_hash is distinct from v_hash then
      raise exception 'VALIDATION_FAILED: klucz idempotencji użyty z innym kodem' using errcode = '22023';
    end if;
    return query select v_existing.id, v_existing.case_number, false;
    return;
  end if;

  if p_good_faith is distinct from true then
    raise exception 'VALIDATION_FAILED: brak oświadczenia' using errcode = '22023';
  end if;
  if p_target_type not in ('job', 'company') then
    raise exception 'VALIDATION_FAILED: rodzaj treści' using errcode = '22023';
  end if;
  if p_category is null or p_category not in
     ('fraud', 'impersonation', 'discrimination', 'illegal_conditions', 'data_misuse', 'other') then
    raise exception 'VALIDATION_FAILED: kategoria' using errcode = '22023';
  end if;
  if char_length(v_details) < 20 or char_length(v_details) > 5000 then
    raise exception 'VALIDATION_FAILED: opis' using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 200 then
    raise exception 'VALIDATION_FAILED: imię' using errcode = '22023';
  end if;
  if v_url is not null and (char_length(v_url) > 2000 or v_url !~* '^https?://') then
    raise exception 'VALIDATION_FAILED: adres treści' using errcode = '22023';
  end if;
  v_email := lower(btrim(coalesce(p_reporter_email, '')));
  if char_length(v_email::text) not between 3 and 254
     or v_email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_FAILED: e-mail' using errcode = '22023';
  end if;
  if public.is_supported_locale(p_locale) is not true then
    raise exception 'VALIDATION_FAILED: język' using errcode = '22023';
  end if;

  -- Zalogowany zgłaszający: istniejący, aktywny profil; język wg Invariantu #1.
  if p_reporter_id is not null then
    select p.id into v_reporter from public.profiles p
      where p.id = p_reporter_id and p.deleted_at is null;
  end if;
  v_locale := case when v_reporter is not null
                   then public.resolve_recipient_locale(v_reporter)
                   else p_locale end;

  -- Tylko treść publiczna; prywatna i nieistniejąca → ten sam NOT_FOUND.
  if p_job_id is null or not public.job_is_public(p_job_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select j.id, j.slug, j.title, j.city, j.region, j.status::text as status, j.contract_type::text as contract_type,
         j.salary_min, j.salary_max, j.currency, j.salary_period::text as salary_period,
         j.published_at, j.expires_at, j.default_locale, j.company_id,
         c.name as company_name, c.website as company_website, c.city as company_city,
         c.vat_number as company_vat, c.description as company_description
    into v_job
    from public.jobs j join public.companies c on c.id = j.company_id
    where j.id = p_job_id and c.deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_target := case p_target_type when 'job' then v_job.id else v_job.company_id end;

  -- Limit w bazie: 5 spraw / adres / 24 h; jedna otwarta sprawa na adres i treść.
  if (select count(*) from public.reports r
        where r.kind = 'dsa_notice' and r.reporter_email = v_email
          and r.created_at > now() - interval '24 hours') >= 5
     or exists (select 1 from public.reports r
        where r.kind = 'dsa_notice' and r.reporter_email = v_email
          and r.target_type = p_target_type::public.report_target_type and r.target_id = v_target
          and r.status in ('open', 'reviewing')) then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;

  -- Dowód: stan treści w chwili zgłoszenia, zbudowany z bazy.
  v_snapshot := jsonb_build_object(
    'capturedAt', now(),
    'job', jsonb_build_object(
      'id', v_job.id, 'slug', v_job.slug, 'title', v_job.title,
      'city', v_job.city, 'region', v_job.region, 'status', v_job.status,
      'contractType', v_job.contract_type, 'salaryMin', v_job.salary_min,
      'salaryMax', v_job.salary_max, 'currency', v_job.currency,
      'salaryPeriod', v_job.salary_period, 'publishedAt', v_job.published_at,
      'expiresAt', v_job.expires_at,
      'translations', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'locale', t.locale, 'title', t.title, 'description', t.description,
                 'responsibilities', t.responsibilities, 'conditions', t.conditions,
                 'benefits', t.benefits) order by t.locale)
          from public.job_translations t where t.job_id = v_job.id), '[]'::jsonb),
      'requirements', coalesce((
        select jsonb_agg(jsonb_build_object('locale', q.locale, 'kind', q.kind, 'content', q.content)
                 order by q.locale, q.position)
          from public.job_requirements q where q.job_id = v_job.id), '[]'::jsonb)
    ),
    'company', jsonb_build_object(
      'id', v_job.company_id, 'name', v_job.company_name, 'website', v_job.company_website,
      'city', v_job.company_city, 'vatNumber', v_job.company_vat,
      'description', v_job.company_description
    )
  );

  -- Numer sprawy: 64 bity losowe (skrót z gen_random_uuid), ponowienie przy kolizji.
  loop
    v_case := 'DSA-' || upper(
      substr(encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'), 1, 16));
    v_case := substr(v_case, 1, 8) || '-' || substr(v_case, 9, 4) || '-' || substr(v_case, 13, 4) || '-' || substr(v_case, 17, 4);
    exit when not exists (select 1 from public.reports r where r.case_number = v_case);
  end loop;

  insert into public.reports(
    reporter_id, target_type, target_id, reason, details, status, kind, case_number,
    access_code_hash, idempotency_key, category, content_url, reporter_name,
    reporter_email, reporter_locale, good_faith_at, target_snapshot, due_at)
  values (
    v_reporter, p_target_type::public.report_target_type, v_target, p_category, v_details,
    'open', 'dsa_notice', v_case, v_hash, p_idempotency_key, p_category, v_url, v_name,
    v_email, v_locale, now(), v_snapshot, now() + interval '7 days')
  returning id into v_id;

  perform public.enqueue_email_to_address(
    v_email::text, v_locale, v_reporter, 'reportReceived', 'report', v_id,
    'report-received:' || v_id::text,
    jsonb_build_object(
      'caseNumber', v_case,
      'accessCode', p_access_code,
      'targetType', p_target_type,
      'recipientName', v_name));

  return query select v_id, v_case, true;
end $$;
revoke all on function public.submit_content_report(
  uuid, uuid, text, text, uuid, text, text, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.submit_content_report(
  uuid, uuid, text, text, uuid, text, text, text, text, text, text, boolean)
  to service_role;

-- --- 7. Sprawdzenie sprawy przez zgłaszającego -----------------------------------------
-- Numer + kod dostępu; zły kod i nieistniejący numer dają ten sam wynik (null).
-- Zwraca wyłącznie stan sprawy — bez treści zgłoszenia, danych kontaktowych i aktorów.
create or replace function public.get_report_case(p_case_number text, p_access_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_report record;
begin
  if p_case_number is null or p_access_code is null
     or char_length(p_case_number) > 32 or p_access_code !~ '^[A-Z2-7]{24}$' then
    return null;
  end if;
  select r.id, r.case_number, r.status::text as status, r.target_type::text as target_type,
         r.category, r.created_at, r.due_at, r.access_code_hash
    into v_report
    from public.reports r
    where r.kind = 'dsa_notice' and r.case_number = upper(btrim(p_case_number));
  if not found
     or v_report.access_code_hash <> encode(sha256(convert_to(p_access_code, 'UTF8')), 'hex') then
    return null;
  end if;
  return jsonb_build_object(
    'caseNumber', v_report.case_number,
    'status', v_report.status,
    'targetType', v_report.target_type,
    'category', v_report.category,
    'createdAt', v_report.created_at,
    'dueAt', v_report.due_at,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'type', e.event_type, 'toStatus', e.to_status, 'at', e.created_at) order by e.id)
        from public.report_events e where e.report_id = v_report.id), '[]'::jsonb));
end $$;
revoke all on function public.get_report_case(text, text) from public, anon, authenticated;
grant execute on function public.get_report_case(text, text) to service_role;
