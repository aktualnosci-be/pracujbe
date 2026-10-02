-- =============================================================================
-- 0219_web_push_subscriptions.sql  (numer tymczasowy — ostateczny nada integrator)
-- Web Push dla alertów zapisanych wyszukiwań (#724).
--
-- Decyzja produktowa: portal ogłoszeniowy (#1128) — kanał push obejmuje WYŁĄCZNIE alerty
-- zapisanych wyszukiwań (`notifications.type = 'job_match'`, `entity_type = 'saved_search'`,
-- #100). Propozycje, wiadomości i zgłoszenia nie są wysyłane push w żadnym trybie (jedno źródło:
-- `push_notification_allowed`). Funkcja za flagą aplikacji `WEB_PUSH_ENABLED` (domyślnie
-- wyłączona) i kluczami VAPID ze zmiennych środowiska — baza nie przechowuje kluczy serwera.
--
-- 1. `push_subscriptions` — urządzenie (subskrypcja przeglądarki) kandydata: endpoint usługi
--    push z listy dozwolonych hostów (`push_endpoint_allowed`, lustro `src/lib/push/endpoint.ts`
--    — bez dowolnych adresów, ochrona przed SSRF), klucze szyfrowania klienta (p256dh, auth),
--    zgrubna etykieta urządzenia (przeglądarka · system, bez pełnego user-agenta), ostatnia
--    udana wysyłka, liczba porażek, unieważnienie z powodem. Odczyt: tylko własne wiersze (RLS);
--    zapis: wyłącznie RPC poniżej (bez grantów DML dla klientów).
-- 2. `register_push_subscription` (kandydat) — rejestruje bieżące urządzenie (upsert po
--    endpoincie: ten sam endpoint z innego konta przechodzi na bieżące konto, a jego niewysłane
--    powiadomienia poprzedniego konta są wygaszane), limit 10 aktywnych urządzeń na konto,
--    ustawia `notification_preferences.push_enabled = true`.
--    `unregister_push_subscription(endpoint)` / `revoke_push_subscription(id)` — wycofanie
--    własnego urządzenia (`revoked_reason = 'user'`); po ostatnim urządzeniu `push_enabled`
--    wraca na false. Wycofanie wygasza niewysłane powiadomienia urządzenia.
-- 3. `push_deliveries` — kolejka wysyłek (jeden wiersz na urządzenie × powiadomienie, unikat =
--    deduplikacja). Trigger AFTER INSERT na `notifications` kolejkuje TYLKO dozwolone
--    powiadomienia dla aktywnych urządzeń odbiorcy z `push_enabled = true`. Powiadomienie
--    pominięte przez filtr in-app (0035) nie powstaje, więc push mu nie towarzyszy.
-- 4. `claim_push_deliveries` (service_role) — przed pobraniem wygasza wysyłki starsze niż 24 h
--    (`expired`) i niedozwolone już (urządzenie wycofane, push wyłączony, konto usunięte,
--    alert wyłączony albo wyszukiwanie usunięte → `suppressed`); SKIP LOCKED, dzierżawa,
--    najwyżej 5 prób. Język = `resolve_recipient_locale` ODBIORCY (Invariant #1). Zwraca tylko
--    to, czego potrzebuje payload (liczba ofert, identyfikator encji) — bez nazwy wyszukiwania.
-- 5. `finish_push_delivery` (service_role) — `sent` (urządzenie: ostatnia udana wysyłka, zero
--    porażek), `gone` (404/410 dostawcy → urządzenie unieważnione, jego kolejka wygaszona),
--    `retry` (backoff ≥ Retry-After, po 5 próbach `failed`), `failed`; 5 kolejnych porażek
--    unieważnia urządzenie (`failed`). Tylko dla wysyłki pod dzierżawą (CAS).
-- 6. `purge_push_data` (service_role, `/api/maintenance`) — wysyłki starsze niż 7 dni,
--    urządzenia unieważnione ponad 30 dni temu. Usunięcie konta = kaskada z `profiles`.
--
-- Rollback: supabase/rollback/0219_web_push_subscriptions.down.sql
-- =============================================================================

-- 0. Jedno źródło reguł ---------------------------------------------------------

-- Dozwolone usługi push przeglądarek (FCM, Mozilla, Windows, Apple). Host małymi literami,
-- bez portu i danych logowania, od razu po nim ścieżka. Lustro: PUSH_ENDPOINT_PATTERNS w TS.
create or replace function public.push_endpoint_allowed(p_endpoint text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_endpoint is not null
     and char_length(p_endpoint) between 20 and 2048
     and p_endpoint !~ '[[:space:][:cntrl:]]'
     and (
       p_endpoint ~ '^https://fcm\.googleapis\.com/'
       or p_endpoint ~ '^https://updates\.push\.services\.mozilla\.com/'
       or p_endpoint ~ '^https://[a-z0-9-]+\.notify\.windows\.com/'
       or p_endpoint ~ '^https://([a-z0-9-]+\.)*push\.apple\.com/'
     );
$$;
revoke all on function public.push_endpoint_allowed(text) from public, anon;
grant execute on function public.push_endpoint_allowed(text) to authenticated, service_role;

-- Kanał push tylko dla alertów zapisanych wyszukiwań (#724, tryb ogłoszeniowy #1128).
create or replace function public.push_notification_allowed(p_type text, p_entity_type text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_type = 'job_match' and p_entity_type = 'saved_search';
$$;
revoke all on function public.push_notification_allowed(text, text) from public, anon, authenticated;
grant execute on function public.push_notification_allowed(text, text) to service_role;

create or replace function public.push_max_devices()
returns integer language sql immutable as $$ select 10 $$;

-- 1. Urządzenia -----------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,
  auth_secret     text not null,
  device_label    text,
  failure_count   integer not null default 0,
  last_success_at timestamptz,
  revoked_at      timestamptz,
  revoked_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint push_subscriptions_endpoint_allowed check (public.push_endpoint_allowed(endpoint)),
  -- Klucz publiczny P-256 nieskompresowany (65 B) i sekret uwierzytelniający (16 B), base64url.
  constraint push_subscriptions_p256dh check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  constraint push_subscriptions_auth check (auth_secret ~ '^[A-Za-z0-9_-]{22}$'),
  constraint push_subscriptions_label check (
    device_label is null or (char_length(device_label) between 1 and 60 and device_label !~ '[[:cntrl:]]')
  ),
  constraint push_subscriptions_failures check (failure_count between 0 and 1000),
  constraint push_subscriptions_revoked check (
    (revoked_at is null) = (revoked_reason is null)
    and (revoked_reason is null or revoked_reason in ('user', 'gone', 'failed'))
  )
);

create index if not exists idx_push_subscriptions_profile_active
  on public.push_subscriptions (profile_id) where revoked_at is null;
create index if not exists idx_push_subscriptions_revoked
  on public.push_subscriptions (revoked_at) where revoked_at is not null;

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select on public.push_subscriptions to authenticated;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using (profile_id = auth.uid());

-- 3. Kolejka wysyłek ------------------------------------------------------------
create table if not exists public.push_deliveries (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  status          text not null default 'queued',
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until     timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  unique (subscription_id, notification_id),
  constraint push_deliveries_status check (
    status in ('queued', 'sent', 'gone', 'failed', 'expired', 'suppressed')
  ),
  constraint push_deliveries_attempts check (attempts between 0 and 5),
  -- Same stałe kody (bez treści odpowiedzi dostawcy, Invariant #8).
  constraint push_deliveries_error check (last_error is null or last_error ~ '^[a-z0-9_]{1,40}$')
);

create index if not exists idx_push_deliveries_due
  on public.push_deliveries (next_attempt_at) where status = 'queued';
create index if not exists idx_push_deliveries_created on public.push_deliveries (created_at);
create index if not exists idx_push_deliveries_notification on public.push_deliveries (notification_id);

alter table public.push_deliveries enable row level security;
alter table public.push_deliveries force row level security;
revoke all on public.push_deliveries from public, anon, authenticated;

-- Wygaszenie niewysłanych wysyłek urządzenia (wycofanie, przejęcie, gone).
create or replace function public.push_suppress_queued(p_subscription_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.push_deliveries
     set status = 'suppressed', lease_until = null
   where subscription_id = p_subscription_id and status = 'queued';
$$;
revoke all on function public.push_suppress_queued(uuid) from public, anon, authenticated;

-- 2. RPC klienta ------------------------------------------------------------------
create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_device_label text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_label text := nullif(btrim(coalesce(p_device_label, '')), '');
  v_existing public.push_subscriptions;
  v_id uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.profiles p
     where p.id = v_uid and p.role = 'candidate' and p.deleted_at is null
  ) then
    raise exception 'PERMISSION_DENIED: push tylko dla kandydata' using errcode = '42501';
  end if;
  if not public.push_endpoint_allowed(p_endpoint) then
    raise exception 'VALIDATION_FAILED: ENDPOINT' using errcode = '22023';
  end if;
  if coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]{87}$' or coalesce(p_auth, '') !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'VALIDATION_FAILED: KEYS' using errcode = '22023';
  end if;
  if v_label is not null and (char_length(v_label) > 60 or v_label ~ '[[:cntrl:]]') then
    v_label := null;
  end if;

  -- Serializacja rejestracji jednego konta (limit urządzeń bez wyścigu).
  perform pg_advisory_xact_lock(hashtextextended('push_subscriptions:' || v_uid::text, 0));

  select * into v_existing from public.push_subscriptions where endpoint = p_endpoint for update;
  if (v_existing.id is null or v_existing.profile_id <> v_uid or v_existing.revoked_at is not null)
     and (select count(*) from public.push_subscriptions s
           where s.profile_id = v_uid and s.revoked_at is null) >= public.push_max_devices() then
    raise exception 'PUSH_DEVICE_LIMIT' using errcode = '22023';
  end if;

  if v_existing.id is not null and v_existing.profile_id <> v_uid then
    -- Przejęcie urządzenia przez inne konto: powiadomienia poprzedniego konta nie wychodzą.
    perform public.push_suppress_queued(v_existing.id);
  end if;

  insert into public.push_subscriptions as s (profile_id, endpoint, p256dh, auth_secret, device_label)
  values (v_uid, p_endpoint, p_p256dh, p_auth, v_label)
  on conflict (endpoint) do update
    set profile_id = excluded.profile_id,
        p256dh = excluded.p256dh,
        auth_secret = excluded.auth_secret,
        device_label = excluded.device_label,
        failure_count = 0,
        revoked_at = null,
        revoked_reason = null,
        updated_at = now()
  returning s.id into v_id;

  insert into public.notification_preferences as np (profile_id, push_enabled)
  values (v_uid, true)
  on conflict (profile_id) do update set push_enabled = true, updated_at = now()
    where np.push_enabled is distinct from true;

  return v_id;
end $$;
revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- Wspólny rdzeń wycofania własnego urządzenia (po id albo endpoincie).
create or replace function public.push_revoke_own(p_uid uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rows integer;
begin
  update public.push_subscriptions
     set revoked_at = now(), revoked_reason = 'user', updated_at = now()
   where id = p_id and profile_id = p_uid and revoked_at is null;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;
  perform public.push_suppress_queued(p_id);
  if not exists (select 1 from public.push_subscriptions
                  where profile_id = p_uid and revoked_at is null) then
    update public.notification_preferences
       set push_enabled = false, updated_at = now()
     where profile_id = p_uid and push_enabled;
  end if;
  return true;
end $$;
revoke all on function public.push_revoke_own(uuid, uuid) from public, anon, authenticated;

create or replace function public.revoke_push_subscription(p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not exists (select 1 from public.push_subscriptions
                  where id = p_id and profile_id = v_uid and revoked_at is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return public.push_revoke_own(v_uid, p_id);
end $$;
revoke all on function public.revoke_push_subscription(uuid) from public, anon;
grant execute on function public.revoke_push_subscription(uuid) to authenticated;

-- Wycofanie bieżącego urządzenia (przeglądarka zna swój endpoint). Cudzy/nieznany = false,
-- bez ujawniania, czy endpoint istnieje.
create or replace function public.unregister_push_subscription(p_endpoint text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select id into v_id from public.push_subscriptions
   where endpoint = p_endpoint and profile_id = v_uid and revoked_at is null;
  if v_id is null then return false; end if;
  return public.push_revoke_own(v_uid, v_id);
end $$;
revoke all on function public.unregister_push_subscription(text) from public, anon;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- 3b. Kolejkowanie przy powiadomieniu -------------------------------------------
create or replace function public.trg_push_enqueue_notification()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.push_notification_allowed(new.type::text, new.entity_type) then
    return null;
  end if;
  insert into public.push_deliveries (subscription_id, notification_id)
  select s.id, new.id
    from public.push_subscriptions s
    join public.notification_preferences np on np.profile_id = s.profile_id
    join public.profiles p on p.id = s.profile_id
   where s.profile_id = new.profile_id
     and s.revoked_at is null
     and np.push_enabled
     and p.deleted_at is null
  on conflict (subscription_id, notification_id) do nothing;
  return null;
end $$;
revoke all on function public.trg_push_enqueue_notification() from public, anon, authenticated;

drop trigger if exists trg_notifications_push_enqueue on public.notifications;
create trigger trg_notifications_push_enqueue
  after insert on public.notifications
  for each row execute function public.trg_push_enqueue_notification();

-- 4. Pobranie wysyłek -------------------------------------------------------------
create or replace function public.claim_push_deliveries(
  p_limit integer default 50,
  p_lease_seconds integer default 120
)
returns table (
  delivery_id uuid,
  endpoint text,
  p256dh text,
  auth_secret text,
  locale text,
  entity_type text,
  entity_id uuid,
  job_count integer,
  attempts integer
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_lease interval := make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900)));
begin
  -- Nieaktualne: alert sprzed doby nie wychodzi z opóźnieniem.
  update public.push_deliveries d
     set status = 'expired', lease_until = null
   where d.status = 'queued' and d.created_at < now() - interval '24 hours';

  -- Niedozwolone już w chwili wysyłki (zgoda/urządzenie/konto/alert).
  update public.push_deliveries d
     set status = 'suppressed', lease_until = null
    from public.push_subscriptions s, public.notifications n
   where d.status = 'queued'
     and s.id = d.subscription_id
     and n.id = d.notification_id
     and (
       s.revoked_at is not null
       or n.profile_id <> s.profile_id
       or not public.push_notification_allowed(n.type::text, n.entity_type)
       or not coalesce((select np.push_enabled from public.notification_preferences np
                         where np.profile_id = s.profile_id), false)
       or not exists (select 1 from public.profiles p where p.id = s.profile_id and p.deleted_at is null)
       or (n.entity_type = 'saved_search' and not exists (
             select 1 from public.saved_searches ss
              where ss.id = n.entity_id and ss.profile_id = s.profile_id and ss.alerts_enabled))
     );

  return query
  with due as (
    select d.id
      from public.push_deliveries d
     where d.status = 'queued'
       and d.next_attempt_at <= now()
       and (d.lease_until is null or d.lease_until < now())
       and d.attempts < 5
     order by d.next_attempt_at, d.id
     limit v_limit
     for update skip locked
  ), claimed as (
    update public.push_deliveries d
       set attempts = d.attempts + 1, lease_until = now() + v_lease
      from due
     where d.id = due.id
    returning d.id, d.subscription_id, d.notification_id, d.attempts
  )
  select c.id, s.endpoint, s.p256dh, s.auth_secret,
         public.resolve_recipient_locale(s.profile_id),
         n.entity_type, n.entity_id,
         case when jsonb_typeof(n.data -> 'count') = 'number'
              then greatest(0, least((n.data ->> 'count')::numeric, 100000))::integer end,
         c.attempts
    from claimed c
    join public.push_subscriptions s on s.id = c.subscription_id
    join public.notifications n on n.id = c.notification_id;
end $$;
revoke all on function public.claim_push_deliveries(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_push_deliveries(integer, integer) to service_role;

-- 5. Wynik wysyłki ------------------------------------------------------------------
create or replace function public.finish_push_delivery(
  p_delivery_id uuid,
  p_outcome text,
  p_error text default null,
  p_retry_after_seconds integer default null
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_d public.push_deliveries;
  v_error text := case when p_error ~ '^[a-z0-9_]{1,40}$' then p_error end;
  v_failures integer;
begin
  if p_outcome is null or p_outcome not in ('sent', 'gone', 'retry', 'failed') then
    raise exception 'VALIDATION_FAILED: OUTCOME' using errcode = '22023';
  end if;
  select * into v_d from public.push_deliveries
   where id = p_delivery_id and status = 'queued' and lease_until is not null
   for update;
  if v_d.id is null then return false; end if;

  if p_outcome = 'sent' then
    update public.push_deliveries
       set status = 'sent', sent_at = now(), lease_until = null, last_error = null
     where id = v_d.id;
    update public.push_subscriptions
       set last_success_at = now(), failure_count = 0, updated_at = now()
     where id = v_d.subscription_id;
  elsif p_outcome = 'gone' then
    update public.push_deliveries
       set status = 'gone', lease_until = null, last_error = coalesce(v_error, 'gone')
     where id = v_d.id;
    update public.push_subscriptions
       set revoked_at = now(), revoked_reason = 'gone', updated_at = now()
     where id = v_d.subscription_id and revoked_at is null;
    perform public.push_suppress_queued(v_d.subscription_id);
  elsif p_outcome = 'retry' and v_d.attempts < 5 then
    update public.push_deliveries
       set lease_until = null,
           last_error = v_error,
           next_attempt_at = now() + greatest(
             make_interval(secs => greatest(0, least(coalesce(p_retry_after_seconds, 0), 21600))),
             least(interval '6 hours', interval '1 minute' * power(2, greatest(v_d.attempts - 1, 0))::integer))
     where id = v_d.id;
  else
    update public.push_deliveries
       set status = 'failed', lease_until = null, last_error = v_error
     where id = v_d.id;
    update public.push_subscriptions
       set failure_count = failure_count + 1, updated_at = now()
     where id = v_d.subscription_id
    returning failure_count into v_failures;
    if v_failures >= 5 then
      update public.push_subscriptions
         set revoked_at = now(), revoked_reason = 'failed', updated_at = now()
       where id = v_d.subscription_id and revoked_at is null;
      perform public.push_suppress_queued(v_d.subscription_id);
    end if;
  end if;
  return true;
end $$;
revoke all on function public.finish_push_delivery(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.finish_push_delivery(uuid, text, text, integer) to service_role;

-- 6. Retencja -----------------------------------------------------------------------
create or replace function public.purge_push_data()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_deliveries integer;
  v_subscriptions integer;
begin
  delete from public.push_deliveries where created_at < now() - interval '7 days';
  get diagnostics v_deliveries = row_count;
  delete from public.push_subscriptions where revoked_at < now() - interval '30 days';
  get diagnostics v_subscriptions = row_count;
  return v_deliveries + v_subscriptions;
end $$;
revoke all on function public.purge_push_data() from public, anon, authenticated;
grant execute on function public.purge_push_data() to service_role;
