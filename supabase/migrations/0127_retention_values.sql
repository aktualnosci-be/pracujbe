-- =============================================================================
-- 0127_retention_values.sql — #574: okresy retencji wg opracowania 2026-09-25 (#573,
-- docs/legal-drafts/opracowanie-2026-09-25/wdrozenie/retention-proposal.json) i brakujące
-- zadania. HARMONOGRAM WYŁĄCZONY: /api/maintenance woła run_retention_purge wyłącznie przy
-- jawnym RETENTION_MODE=dry-run|apply (src/lib/retention/mode.ts, domyślnie off). Migracja
-- zapisuje wartości i kod, niczego nie usuwa.
--
-- 1. retention_policies: kolumny `warning_period` (ostrzeżenie przed usunięciem / próg
--    alarmu) i `enforcement` (kto egzekwuje: job = run_retention_purge, monitoring =
--    czujka ops_metrics, infrastructure = poza bazą, none = brak zadania — do zrobienia).
--    Wartości: pliki i profile oznaczone do usunięcia 7 dni (zamiast 30) łącznie z fizycznym
--    usunięciem obiektu (≤ 72 h), aplikacje i wiadomości 180 dni od zamknięcia, CV 365 dni
--    bez aktywności, konto 730, ukrycie profilu w wyszukiwarce 180, ślad gościa 30
--    (niepotwierdzone 7, IP/UA 7), wnioski 1095, dowody zgód 1095, logi 30, audyt 365,
--    kopie 14 dni kalendarzowych. Rejestr usunięć BEZ ZMIAN (minimum 400 dni zmienia osobny
--    krok po RET-09/RET-10).
-- 2. applications.closed_at — niezmienny znacznik zamknięcia dla KAŻDEGO statusu końcowego
--    (rejected, withdrawn, hired, offer_accepted, offer_declined); ustawia go trigger przy
--    wejściu w stan końcowy, nie resetuje go żadna późniejsza zmiana (odczyt, powiadomienie,
--    updated_at). Wyjście ze stanu końcowego (dziś niedozwolone przez transition_application)
--    zeruje go — i jest audytowane triggerem 0017. Uzupełnienie istniejących: czas wejścia
--    w bieżący status z historii, inaczej updated_at.
-- 3. profiles.last_seen_at — aktualizowane przy realnej aktywności: utworzenie sesji Better
--    Auth (logowanie) i jej odświeżenie przy używaniu (`expires_at`), najwyżej raz na godzinę.
--    Zadania tła (service_role) nie dotykają sesji, więc nie przedłużają aktywności.
-- 4. retention_warnings — ostrzeżenie `warning_period` przed usunięciem CV / konta (e-mail
--    inactiveCvWarning / inactiveAccountWarning w języku odbiorcy). Usunięcie następuje
--    najwcześniej po terminie z ostrzeżenia; nowa aktywność unieważnia ostrzeżenie.
-- 5. run_retention_purge(p_limit, p_dry_run) — nowe zadania: konto nieaktywne, ukrycie
--    profilu, ślad gościa (potwierdzony / niepotwierdzony / IP-UA), rozmowy zamkniętych
--    aplikacji; licznik `fullBatches` = kategorie, które wyczerpały partię (worker woła
--    kolejną). Dry-run liczy w podtransakcji wycofywanej na końcu (bez zmian i e-maili).
-- 6. storage_deletion_queue: dead-letter po 20 próbach (`dead_lettered_at`, także po
--    porzuconej dzierżawie), `requeue_storage_dead_letters` (service_role, audyt) i sekcja
--    `storageDeletion` w ops_metrics (czujka: wiek > 24 h, dead-letter > 0 → alarm).
--
-- Rollback (nowa migracja naprawcza): run_retention_purge z 0105 (drop wersji (integer,
-- boolean)), complete/claim_storage_deletions i queue_storage_deletion z 0105, ops_metrics
-- z 0118; drop retention_purge_batch, requeue_storage_dead_letters, touch_profile_activity,
-- trigger trg_auth_sessions_touch_activity, trg_applications_closed_at,
-- tabela retention_warnings, kolumny applications.closed_at,
-- storage_deletion_queue.dead_lettered_at, retention_policies.warning_period/enforcement;
-- przywrócenie wartości z 0105 przez admin_set_retention_policy.
-- =============================================================================

-- --- 1. Wartości retencji ------------------------------------------------------------------
alter table public.retention_policies
  add column if not exists warning_period interval
    check (warning_period is null or (warning_period >= interval '1 day' and warning_period <= interval '365 days')),
  add column if not exists enforcement text not null default 'job'
    check (enforcement in ('job', 'monitoring', 'infrastructure', 'none'));

comment on column public.retention_policies.warning_period is
  '#574: ostrzeżenie przed usunięciem (CV, konto) albo próg alarmu (storage).';
comment on column public.retention_policies.enforcement is
  '#574: job = run_retention_purge, monitoring = czujka ops_metrics, infrastructure = poza bazą, none = brak zadania.';

insert into public.retention_policies (key, period, warning_period, enforcement, description) values
  ('deleted_file', interval '7 days', null, 'job',
   'Plik oznaczony jako usunięty: wiersz files i obiekt storage usunięte łącznie w 7 dni (obiekt ≤ storage_physical_deletion).'),
  ('deleted_profile', interval '7 days', null, 'job',
   'Profil kandydata oznaczony jako usunięty: pełne usunięcie konta i danych procesu w 7 dni.'),
  ('closed_application', interval '180 days', null, 'job',
   'Aplikacja w stanie końcowym (także hired) od closed_at: aplikacja, jej rozmowy, powiadomienia i e-maile.'),
  ('inactive_candidate_cv', interval '365 days', interval '30 days', 'job',
   'CV kandydata bez aktywności (last_seen_at): ostrzeżenie 30 dni wcześniej, potem usunięcie pliku.'),
  ('inactive_candidate_account', interval '730 days', interval '30 days', 'job',
   'Konto kandydata bez aktywności (last_seen_at): ostrzeżenie 30 dni wcześniej, potem pełne usunięcie.'),
  ('inactive_searchable_profile', interval '180 days', null, 'job',
   'Profil wyszukiwalny bez aktywności kandydata: ukrycie w wyszukiwarce firm.'),
  ('confirmed_guest_request', interval '30 days', null, 'job',
   'Minimalny bufor potwierdzonego zgłoszenia bez konta od confirmed_at (aplikacja zostaje ze snapshotem).'),
  ('unconfirmed_guest_request', interval '7 days', null, 'job',
   'Niepotwierdzone zgłoszenie bez konta: maksymalnie 7 dni od pierwszego wysłania (ponowny link nie przedłuża).'),
  ('guest_ip_user_agent', interval '7 days', null, 'job',
   'Adres IP i user-agent zgody gościa: wyzerowanie po 7 dniach od wysłania.'),
  ('data_rights_request_log', interval '1095 days', null, 'job',
   'Ślad obsługi wniosku o dostęp/usunięcie (bez treści danych) od zakończenia.'),
  ('storage_physical_deletion', interval '3 days', interval '1 day', 'monitoring',
   'Fizyczne usunięcie obiektu storage po usunięciu wiersza: ≤ 72 h, alarm po 24 h, dead-letter po 20 próbach.'),
  ('consent_evidence', interval '1095 days', null, 'none',
   'Dowody zgód i akceptacji po minimalizacji: do 1095 dni. Brak zadania (niezmienne receipty) — osobny krok.'),
  ('audit_log', interval '365 days', null, 'none',
   'Zminimalizowany dziennik audytu: 365 dni. Brak zadania — osobny krok (uzasadnienia DSA).'),
  ('security_log', interval '30 days', null, 'infrastructure',
   'Surowe logi bezpieczeństwa i aplikacji (Railway): 30 dni — ustawienie dostawcy.'),
  ('database_backup', interval '14 days', null, 'infrastructure',
   'Kopie bazy i eksporty: najwyżej 14 dni kalendarzowych (nie liczba kopii) — scripts/db/backup.sh i dostawca.')
on conflict (key) do update
  set period = excluded.period,
      warning_period = excluded.warning_period,
      enforcement = excluded.enforcement,
      description = excluded.description,
      updated_at = now(),
      updated_by = null;

-- Rejestr usunięć: bez zmiany wartości (null) i minimum 400 dni — tylko opis zadania.
update public.retention_policies
   set enforcement = 'job'
 where key = 'erasure_tombstone';

insert into public.audit_logs (actor_id, action, entity_type, after_data)
values (null, 'retention.policies_seeded', 'retention_policy',
        jsonb_build_object('source', 'opracowanie-2026-09-25', 'issue', 574, 'scheduleEnabled', false));

-- --- 2. Niezmienny closed_at aplikacji ------------------------------------------------------
alter table public.applications add column if not exists closed_at timestamptz;
comment on column public.applications.closed_at is
  '#574: wejście w stan końcowy (rejected/withdrawn/hired/offer_accepted/offer_declined); niezmienne, początek retencji.';

create or replace function public.application_status_is_terminal(p_status public.application_status)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_status in ('rejected', 'withdrawn', 'hired', 'offer_accepted', 'offer_declined');
$$;

create or replace function public.set_application_closed_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if public.application_status_is_terminal(new.status) then
    if tg_op = 'UPDATE' and public.application_status_is_terminal(old.status) then
      -- Zmiana w obrębie stanów końcowych, odczyt, powiadomienie: znacznik bez zmian.
      new.closed_at := coalesce(old.closed_at, now());
    else
      new.closed_at := now();
    end if;
  else
    -- Rzeczywiste ponowne otwarcie (zmiana statusu audytuje trg_audit_application_status).
    new.closed_at := null;
  end if;
  return new;
end $$;
revoke all on function public.set_application_closed_at() from public;

-- Uzupełnienie bez zmiany updated_at istniejących aplikacji.
alter table public.applications disable trigger trg_set_updated_at;
update public.applications a
   set closed_at = coalesce(
         (select max(h.created_at) from public.application_status_history h
           where h.application_id = a.id and h.to_status = a.status),
         a.updated_at)
 where public.application_status_is_terminal(a.status) and a.closed_at is null;
alter table public.applications enable trigger trg_set_updated_at;

drop trigger if exists trg_applications_closed_at on public.applications;
create trigger trg_applications_closed_at
  before insert or update on public.applications
  for each row execute function public.set_application_closed_at();

create index if not exists idx_applications_closed_at
  on public.applications (closed_at) where closed_at is not null;

-- --- 3. Aktywność konta -----------------------------------------------------------------------
create or replace function public.touch_profile_activity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.profiles
     set last_seen_at = now()
   where id = new.user_id
     and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
  return null;
end $$;
revoke all on function public.touch_profile_activity() from public, anon, authenticated;

-- auth.sessions pochodzi z database/auth (0057). Zestaw bez schematu Better Auth (np. seed
-- na shimie) pomija trigger — aktywność bierze się wyłącznie z sesji.
do $$
begin
  if to_regclass('auth.sessions') is not null then
    execute 'drop trigger if exists trg_auth_sessions_touch_activity on auth.sessions';
    execute 'create trigger trg_auth_sessions_touch_activity
               after insert or update of expires_at on auth.sessions
               for each row execute function public.touch_profile_activity()';
  end if;
end $$;

create index if not exists idx_profiles_candidate_activity
  on public.profiles ((coalesce(last_seen_at, created_at))) where role = 'candidate';

-- --- 4. Ostrzeżenia przed usunięciem -----------------------------------------------------------
create table if not exists public.retention_warnings (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  policy_key  text not null references public.retention_policies(key) on delete cascade,
  activity_at timestamptz not null,
  warned_at   timestamptz not null default now(),
  due_at      timestamptz not null,
  primary key (profile_id, policy_key, activity_at)
);
comment on table public.retention_warnings is
  '#574: ostrzeżenie przed usunięciem z powodu braku aktywności; activity_at = aktywność, której dotyczy.';
create index if not exists idx_retention_warnings_due on public.retention_warnings (policy_key, due_at);

alter table public.retention_warnings enable row level security;
alter table public.retention_warnings force row level security;
revoke all on public.retention_warnings from public, anon, authenticated;

-- --- 6. Kolejka storage: dead-letter ----------------------------------------------------------
alter table public.storage_deletion_queue add column if not exists dead_lettered_at timestamptz;
create index if not exists idx_storage_deletion_queue_dead
  on public.storage_deletion_queue (dead_lettered_at) where dead_lettered_at is not null;

create or replace function public.queue_storage_deletion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.storage_deletion_queue (bucket, path)
  values (old.bucket, old.path)
  on conflict (bucket, path) do update
    set next_attempt_at = now(), locked_until = null, attempts = 0, last_error = null,
        dead_lettered_at = null;
  return old;
end $$;
revoke all on function public.queue_storage_deletion() from public, anon, authenticated;

create or replace function public.claim_storage_deletions(p_limit integer default 50)
returns table (id uuid, bucket text, path text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.storage_deletion_queue q
   where exists (select 1 from public.files f where f.bucket = q.bucket and f.path = q.path);
  -- Porzucona dzierżawa po ostatniej próbie (proces przerwany przed wynikiem) = dead-letter,
  -- a nie cicho pominięty wiersz.
  update public.storage_deletion_queue q
     set dead_lettered_at = now(), locked_until = null,
         last_error = coalesce(q.last_error, 'LEASE_ABANDONED')
   where q.attempts >= 20 and q.dead_lettered_at is null
     and (q.locked_until is null or q.locked_until < now());
  return query
  with due as (
    select q.id from public.storage_deletion_queue q
     where q.next_attempt_at <= now()
       and (q.locked_until is null or q.locked_until < now())
       and q.attempts < 20
       and q.dead_lettered_at is null
     order by q.next_attempt_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked
  )
  update public.storage_deletion_queue q
     set locked_until = now() + interval '5 minutes', attempts = q.attempts + 1
    from due where q.id = due.id
  returning q.id, q.bucket, q.path;
end $$;
revoke all on function public.claim_storage_deletions(integer) from public, anon, authenticated;
grant execute on function public.claim_storage_deletions(integer) to service_role;

create or replace function public.complete_storage_deletion(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_ok then
    delete from public.storage_deletion_queue where id = p_id;
  else
    update public.storage_deletion_queue
       set locked_until = null,
           last_error = left(coalesce(nullif(p_error, ''), 'unknown'), 40),
           next_attempt_at = now() + least(interval '1 day', interval '1 minute' * power(2, least(attempts, 12))),
           dead_lettered_at = case when attempts >= 20 then now() else null end
     where id = p_id;
  end if;
end $$;
revoke all on function public.complete_storage_deletion(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.complete_storage_deletion(uuid, boolean, text) to service_role;

-- Obsługa dead-letter: ponowienie po naprawie przyczyny (np. konfiguracji bucketu).
-- null = wszystkie. Zwraca liczbę wierszy; audyt bez ścieżek.
create or replace function public.requeue_storage_dead_letters(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  if p_ids is not null and coalesce(array_length(p_ids, 1), 0) > 1000 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  update public.storage_deletion_queue q
     set attempts = 0, dead_lettered_at = null, locked_until = null, next_attempt_at = now()
   where q.dead_lettered_at is not null and (p_ids is null or q.id = any(p_ids));
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into public.audit_logs (actor_id, action, entity_type, after_data)
    values (null, 'storage.dead_letters_requeued', 'storage_deletion_queue', jsonb_build_object('count', v_n));
  end if;
  return v_n;
end $$;
revoke all on function public.requeue_storage_dead_letters(uuid[]) from public, anon, authenticated;
grant execute on function public.requeue_storage_dead_letters(uuid[]) to service_role;

-- ops_metrics z 0118 (0096 + mail) + sekcja storageDeletion (same liczby).
create or replace function public.ops_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_email jsonb;
  v_auth_email jsonb := null;
  v_webhooks jsonb;
  v_maintenance jsonb;
  v_connections jsonb;
  v_mail jsonb;
  v_storage jsonb;
begin
  select jsonb_build_object(
    'ready', count(*) filter (where status = 'queued' and next_attempt_at <= now()),
    'oldestReadyAgeSeconds', coalesce(floor(extract(epoch from now() - min(next_attempt_at)
      filter (where status = 'queued' and next_attempt_at <= now())))::bigint, 0),
    'abandonedLeases', count(*) filter (where status = 'queued' and locked_at is not null
      and locked_at < now() - interval '300 seconds'),
    'failedLast24h', count(*) filter (where status = 'failed' and updated_at > now() - interval '24 hours')
  ) into v_email
  from public.email_deliveries
  where status in ('queued', 'failed');

  if to_regclass('auth.email_outbox') is not null then
    execute $q$
      select jsonb_build_object(
        'ready', count(*) filter (where status = 'queued' and next_attempt_at <= now()),
        'oldestReadyAgeSeconds', coalesce(floor(extract(epoch from now() - min(next_attempt_at)
          filter (where status = 'queued' and next_attempt_at <= now())))::bigint, 0),
        'abandonedLeases', count(*) filter (where status = 'leased' and lease_expires_at < now()),
        'failedLast24h', count(*) filter (where status = 'failed' and created_at > now() - interval '24 hours'))
      from auth.email_outbox where status in ('queued', 'leased', 'failed')
    $q$ into v_auth_email;
  end if;

  select jsonb_build_object(
    'stuckProcessing', count(*) filter (where status = 'processing' and updated_at < now() - interval '15 minutes'),
    'failedLast24h', count(*) filter (where status = 'failed' and updated_at > now() - interval '24 hours')
  ) into v_webhooks
  from public.processed_webhooks
  where status in ('processing', 'failed');

  select jsonb_build_object(
    'overdueActiveJobs', (select count(*) from public.jobs
      where status = 'active' and expires_at is not null and expires_at <= now() - interval '2 hours'),
    'staleDiscountReservations', (select count(*) from public.discount_redemptions
      where status = 'reserved' and created_at < now() - interval '26 hours'),
    'staleCheckoutIntents', (select count(*) from public.checkout_intents
      where status = 'pending' and created_at < now() - interval '150 minutes')
  ) into v_maintenance;

  select jsonb_build_object(
    'used', (select count(*) from pg_stat_activity where backend_type = 'client backend'),
    'max', current_setting('max_connections')::integer,
    'reserved', current_setting('superuser_reserved_connections')::integer
  ) into v_connections;

  -- #44: jakość doręczeń. Kohorta = listy przyjęte przez dostawcę (sent_at) w oknie;
  -- odbicie trwałe (bounce_type = 'permanent') i skarga liczone dla tej samej kohorty,
  -- niezależnie od tego, kiedy przyszło zdarzenie. Okno bazowe = 7 dób przed bieżącą
  -- dobą (wzrost odsetka porównuje aplikacja). Progi i minimalna próba — w aplikacji.
  select jsonb_build_object(
    'sentLast24h', count(*) filter (where sent_at > now() - interval '24 hours'),
    'hardBouncesLast24h', count(*) filter (where sent_at > now() - interval '24 hours'
      and bounce_type = 'permanent'),
    'complaintsLast24h', count(*) filter (where sent_at > now() - interval '24 hours'
      and complained_at is not null),
    'sentBaseline7d', count(*) filter (where sent_at <= now() - interval '24 hours'),
    'hardBouncesBaseline7d', count(*) filter (where sent_at <= now() - interval '24 hours'
      and bounce_type = 'permanent'),
    'complaintsBaseline7d', count(*) filter (where sent_at <= now() - interval '24 hours'
      and complained_at is not null),
    'activeSuppressions', (select count(*) from public.email_suppressions where lifted_at is null),
    'newSuppressionsLast24h', (select count(*) from public.email_suppressions
      where created_at > now() - interval '24 hours')
  ) into v_mail
  from public.email_deliveries
  where sent_at > now() - interval '8 days';

  -- #574: obiekty czekające na fizyczne usunięcie (wiek od usunięcia wiersza) i dead-letter.
  select jsonb_build_object(
    'pending', count(*) filter (where dead_lettered_at is null),
    'oldestPendingAgeSeconds', coalesce(floor(extract(epoch from now() - min(created_at)
      filter (where dead_lettered_at is null)))::bigint, 0),
    'deadLetters', count(*) filter (where dead_lettered_at is not null)
  ) into v_storage
  from public.storage_deletion_queue;

  return jsonb_build_object(
    'email', v_email,
    'authEmail', v_auth_email,
    'webhooks', v_webhooks,
    'maintenance', v_maintenance,
    'connections', v_connections,
    'mail', v_mail,
    'storageDeletion', v_storage
  );
end $$;
revoke all on function public.ops_metrics() from public, anon, authenticated;
grant execute on function public.ops_metrics() to pracujbe_ops, service_role;

-- --- 5. Zadanie retencji ---------------------------------------------------------------------
create or replace function public.retention_warning_period(p_key text)
returns interval language sql stable security definer set search_path = public, pg_temp as $$
  select warning_period from public.retention_policies where key = p_key
$$;
revoke all on function public.retention_warning_period(text) from public, anon, authenticated;

-- Jedna partia wszystkich kategorii (funkcja wewnętrzna; wywołuje ją run_retention_purge).
create or replace function public.retention_purge_batch(p_limit integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_limit   integer := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_erase_limit integer := least(v_limit, 50);
  v_period  interval;
  v_warn    interval;
  -- Fizyczne usunięcie obiektu mieści się w okresie kategorii: wiersz usuwamy o tyle wcześniej.
  v_lead    interval := coalesce(public.retention_period('storage_physical_deletion'), interval '0');
  v_ids     uuid[];
  v_convs   uuid[];
  v_subject uuid;
  v_request uuid;
  v_row     record;
  v_due     timestamptz;
  v_out     jsonb := '{}'::jsonb;
  v_full    integer := 0;
  v_n       integer;
begin
  -- Pliki oznaczone jako usunięte → wiersz (trigger kolejkuje obiekt storage).
  v_period := public.retention_period('deleted_file');
  v_n := 0;
  if v_period is not null then
    delete from public.files f
     where f.id in (select x.id from public.files x
                     where x.deleted_at is not null
                       and x.deleted_at < now() - greatest(v_period - v_lead, interval '0')
                     order by x.deleted_at limit v_limit for update skip locked);
    get diagnostics v_n = row_count;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  end if;
  v_out := v_out || jsonb_build_object('deletedFiles', v_n);

  -- Profile kandydatów oznaczone jako usunięte → pełne usunięcie.
  v_period := public.retention_period('deleted_profile');
  v_n := 0;
  if v_period is not null then
    for v_subject in
      select p.id from public.profiles p
       where p.role = 'candidate' and p.deleted_at is not null
         and p.deleted_at < now() - greatest(v_period - v_lead, interval '0')
       order by p.deleted_at limit v_erase_limit for update skip locked
    loop
      insert into public.data_rights_requests (subject_id, kind, channel, due_at)
      values (v_subject, 'erasure', 'retention', now()) returning id into v_request;
      update public.data_rights_requests
         set details = public.erase_candidate_subject(v_subject, 'retention', v_request), completed_at = now()
       where id = v_request;
      v_n := v_n + 1;
    end loop;
    if v_n >= v_erase_limit then v_full := v_full + 1; end if;
  end if;
  v_out := v_out || jsonb_build_object('erasedProfiles', v_n);

  -- Aplikacje zamknięte (każdy stan końcowy) od closed_at — z rozmowami, powiadomieniami, e-mailami.
  v_period := public.retention_period('closed_application');
  v_n := 0;
  if v_period is not null then
    select coalesce(array_agg(x.id), '{}') into v_ids
      from (select a.id from public.applications a
             where a.closed_at is not null
               and public.application_status_is_terminal(a.status)
               and a.closed_at < now() - v_period
             order by a.closed_at limit v_limit for update skip locked) x;
    select coalesce(array_agg(c.id), '{}') into v_convs
      from public.conversations c where c.application_id = any(v_ids);
    delete from public.notifications n
     where n.entity_id = any(v_ids) or n.entity_id = any(v_convs)
        or n.entity_id in (select m.id from public.messages m where m.conversation_id = any(v_convs));
    delete from public.email_deliveries e
     where e.entity_id = any(v_ids) or e.entity_id = any(v_convs)
        or e.entity_id in (select m.id from public.messages m where m.conversation_id = any(v_convs));
    delete from public.conversations c where c.id = any(v_convs);
    -- Ślad zgłoszenia bez konta traci powiązanie (FK → null); jego okres: confirmed_guest_request.
    delete from public.applications a where a.id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  end if;
  v_out := v_out || jsonb_build_object('closedApplications', v_n,
                                       'closedApplicationConversations', coalesce(array_length(v_convs, 1), 0));
  v_convs := '{}';

  -- Ostrzeżenia przestają obowiązywać, gdy kandydat był aktywny (inna aktywność niż ostrzeżona).
  delete from public.retention_warnings w
   using public.profiles p
   where p.id = w.profile_id and w.activity_at <> coalesce(p.last_seen_at, p.created_at);

  -- CV nieaktywnych kandydatów: ostrzeżenie, potem usunięcie pliku (obiekt → kolejka).
  v_period := public.retention_period('inactive_candidate_cv');
  v_warn := coalesce(public.retention_warning_period('inactive_candidate_cv'), interval '0');
  v_n := 0;
  if v_period is not null then
    for v_row in
      select p.id, coalesce(p.last_seen_at, p.created_at) as activity
        from public.profiles p
       where p.role = 'candidate' and p.deleted_at is null
         and coalesce(p.last_seen_at, p.created_at) < now() - greatest(v_period - v_warn, interval '0')
         and exists (select 1 from public.files x where x.owner_id = p.id
                       and x.entity_type = 'candidate_cv' and x.deleted_at is null)
         and not exists (select 1 from public.retention_warnings w
                          where w.profile_id = p.id and w.policy_key = 'inactive_candidate_cv'
                            and w.activity_at = coalesce(p.last_seen_at, p.created_at))
       order by 2 limit v_limit
       for update of p skip locked
    loop
      insert into public.retention_warnings (profile_id, policy_key, activity_at, due_at)
      values (v_row.id, 'inactive_candidate_cv', v_row.activity,
              greatest(v_row.activity + v_period, now() + v_warn))
      returning due_at into v_due;
      perform public.enqueue_email(v_row.id, 'inactiveCvWarning', 'profile', v_row.id,
        'retention:inactive_candidate_cv:' || v_row.id || ':' || extract(epoch from v_row.activity)::bigint,
        jsonb_build_object('deletionDate', v_due));
      v_n := v_n + 1;
    end loop;
    if v_n >= v_limit then v_full := v_full + 1; end if;
    v_out := v_out || jsonb_build_object('inactiveCvWarned', v_n);

    delete from public.files f
     where f.id in (select x.id from public.files x
                      join public.profiles p on p.id = x.owner_id
                      join public.retention_warnings w
                        on w.profile_id = p.id and w.policy_key = 'inactive_candidate_cv'
                       and w.activity_at = coalesce(p.last_seen_at, p.created_at)
                     where x.entity_type = 'candidate_cv' and x.deleted_at is null
                       and w.due_at - v_lead <= now()
                     order by w.due_at limit v_limit for update of x skip locked);
    get diagnostics v_n = row_count;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  else
    v_out := v_out || jsonb_build_object('inactiveCvWarned', 0);
    v_n := 0;
  end if;
  v_out := v_out || jsonb_build_object('inactiveCvDeleted', v_n);

  -- Konta nieaktywnych kandydatów: ostrzeżenie, potem pełne usunięcie.
  v_period := public.retention_period('inactive_candidate_account');
  v_warn := coalesce(public.retention_warning_period('inactive_candidate_account'), interval '0');
  v_n := 0;
  if v_period is not null then
    for v_row in
      select p.id, coalesce(p.last_seen_at, p.created_at) as activity
        from public.profiles p
       where p.role = 'candidate' and p.deleted_at is null
         and coalesce(p.last_seen_at, p.created_at) < now() - greatest(v_period - v_warn, interval '0')
         and not exists (select 1 from public.retention_warnings w
                          where w.profile_id = p.id and w.policy_key = 'inactive_candidate_account'
                            and w.activity_at = coalesce(p.last_seen_at, p.created_at))
       order by 2 limit v_limit
       for update of p skip locked
    loop
      insert into public.retention_warnings (profile_id, policy_key, activity_at, due_at)
      values (v_row.id, 'inactive_candidate_account', v_row.activity,
              greatest(v_row.activity + v_period, now() + v_warn))
      returning due_at into v_due;
      perform public.enqueue_email(v_row.id, 'inactiveAccountWarning', 'profile', v_row.id,
        'retention:inactive_candidate_account:' || v_row.id || ':' || extract(epoch from v_row.activity)::bigint,
        jsonb_build_object('deletionDate', v_due));
      v_n := v_n + 1;
    end loop;
    if v_n >= v_limit then v_full := v_full + 1; end if;
    v_out := v_out || jsonb_build_object('inactiveAccountsWarned', v_n);

    v_n := 0;
    for v_subject in
      select p.id from public.profiles p
        join public.retention_warnings w
          on w.profile_id = p.id and w.policy_key = 'inactive_candidate_account'
         and w.activity_at = coalesce(p.last_seen_at, p.created_at)
       where p.role = 'candidate' and w.due_at - v_lead <= now()
       order by w.due_at limit v_erase_limit
       for update of p skip locked
    loop
      insert into public.data_rights_requests (subject_id, kind, channel, due_at)
      values (v_subject, 'erasure', 'retention', now()) returning id into v_request;
      update public.data_rights_requests
         set details = public.erase_candidate_subject(v_subject, 'retention', v_request), completed_at = now()
       where id = v_request;
      v_n := v_n + 1;
    end loop;
    if v_n >= v_erase_limit then v_full := v_full + 1; end if;
  else
    v_out := v_out || jsonb_build_object('inactiveAccountsWarned', 0);
  end if;
  v_out := v_out || jsonb_build_object('inactiveAccountsErased', v_n);

  -- Profil wyszukiwalny bez aktywności → ukryty (jak wyłączenie przez kandydata, z historią).
  v_period := public.retention_period('inactive_searchable_profile');
  v_n := 0;
  if v_period is not null then
    select coalesce(array_agg(x.profile_id), '{}') into v_ids
      from (select cp.profile_id from public.candidate_profiles cp
              join public.profiles p on p.id = cp.profile_id
             where cp.is_searchable and p.deleted_at is null
               and coalesce(p.last_seen_at, p.created_at) < now() - v_period
             order by coalesce(p.last_seen_at, p.created_at) limit v_limit
             for update of cp skip locked) x;
    update public.candidate_profiles
       set is_searchable = false, searchable_changed_at = now()
     where profile_id = any(v_ids);
    get diagnostics v_n = row_count;
    insert into public.candidate_visibility_events (candidate_id, searchable)
    select unnest(v_ids), false;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  end if;
  v_out := v_out || jsonb_build_object('hiddenProfiles', v_n);

  -- Zgłoszenia bez konta: niepotwierdzone (od pierwszego wysłania) i bufor potwierdzonych.
  v_period := public.retention_period('unconfirmed_guest_request');
  v_n := 0;
  if v_period is not null then
    select coalesce(array_agg(x.id), '{}') into v_ids
      from (select g.id from public.guest_application_requests g
             where g.status = 'pending' and g.created_at < now() - v_period
             order by g.created_at limit v_limit for update skip locked) x;
    delete from public.email_deliveries
     where entity_type = 'guest_application_request' and entity_id = any(v_ids);
    delete from public.guest_application_requests where id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  end if;
  v_out := v_out || jsonb_build_object('unconfirmedGuestRequests', v_n);

  v_period := public.retention_period('confirmed_guest_request');
  v_n := 0;
  if v_period is not null then
    select coalesce(array_agg(x.id), '{}') into v_ids
      from (select g.id from public.guest_application_requests g
             where g.status in ('confirmed', 'duplicate') and g.confirmed_at is not null
               and g.confirmed_at < now() - v_period
             order by g.confirmed_at limit v_limit for update skip locked) x;
    delete from public.email_deliveries
     where entity_type = 'guest_application_request' and entity_id = any(v_ids);
    delete from public.guest_application_requests where id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  end if;
  v_out := v_out || jsonb_build_object('confirmedGuestRequests', v_n);

  v_period := public.retention_period('guest_ip_user_agent');
  v_n := 0;
  if v_period is not null then
    update public.guest_application_requests g
       set consent_ip = null, consent_user_agent = null
     where g.id in (select x.id from public.guest_application_requests x
                     where (x.consent_ip is not null or x.consent_user_agent is not null)
                       and x.created_at < now() - v_period
                     order by x.created_at limit v_limit for update skip locked);
    get diagnostics v_n = row_count;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  end if;
  v_out := v_out || jsonb_build_object('guestIpCleared', v_n);

  v_period := public.retention_period('data_rights_request_log');
  v_n := 0;
  if v_period is not null then
    delete from public.data_rights_requests r
     where r.id in (select x.id from public.data_rights_requests x
                     where x.completed_at is not null and x.completed_at < now() - v_period
                     order by x.completed_at limit v_limit for update skip locked);
    get diagnostics v_n = row_count;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  end if;
  v_out := v_out || jsonb_build_object('dataRightsRequests', v_n);

  v_period := public.retention_period('erasure_tombstone');
  v_n := 0;
  if v_period is not null then
    delete from public.erasure_tombstones t
     where t.subject_id in (select x.subject_id from public.erasure_tombstones x
                             where greatest(x.erased_at, coalesce(x.reapplied_at, x.erased_at)) < now() - v_period
                             order by x.erased_at limit v_limit for update skip locked);
    get diagnostics v_n = row_count;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  end if;
  return v_out || jsonb_build_object('erasureTombstones', v_n, 'fullBatches', v_full);
end $$;
revoke all on function public.retention_purge_batch(integer) from public, anon, authenticated;

-- Wywołanie z /api/maintenance. Dry-run: ta sama partia w podtransakcji wycofanej na końcu —
-- liczniki bez zmian danych i bez e-maili (zmienne PL/pgSQL nie są wycofywane).
drop function if exists public.run_retention_purge(integer);
create or replace function public.run_retention_purge(p_limit integer default 200, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_out jsonb;
begin
  if not coalesce(p_dry_run, false) then
    return public.retention_purge_batch(p_limit);
  end if;
  begin
    v_out := public.retention_purge_batch(p_limit);
    raise exception 'RETENTION_DRY_RUN_ROLLBACK' using errcode = 'P0001';
  exception when raise_exception then
    if sqlerrm <> 'RETENTION_DRY_RUN_ROLLBACK' then raise; end if;
  end;
  return v_out || jsonb_build_object('dryRun', 1);
end $$;
revoke all on function public.run_retention_purge(integer, boolean) from public, anon, authenticated;
grant execute on function public.run_retention_purge(integer, boolean) to service_role;
