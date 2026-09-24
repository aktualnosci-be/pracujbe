-- =============================================================================
-- 0087_email_unsubscribe_budget.sql — #45, etap 1: wypisanie jednym kliknięciem,
-- ponowna kontrola zgody tuż przed wysyłką i atomowe budżety wysyłki.
--
-- 1. email_preference_category(template) — jedno źródło mapowania typu maila na
--    kategorię preferencji (`notification_preferences.email_<kategoria>`). Lustro TS:
--    src/lib/email/categories.ts (test porównuje oba).
-- 2. email_allowed(profile, template) — aktualna zgoda odbiorcy. Brak wiersza
--    preferencji = wartości domyślne kolumn (marketing domyślnie WYŁĄCZONY — opt-in).
-- 3. enqueue_email — ta sama logika co 0073, preferencje przez email_allowed.
-- 4. claim_email_batch — przy claimie ponownie sprawdza zgodę; wiersz odbiorcy, który
--    się wypisał po zakolejkowaniu, jest wygaszany (status 'failed', `suppressed_at`,
--    error_message 'suppressed_opt_out') i NIE trafia do workera. Dzierżawa i
--    SKIP LOCKED jak w 0021 — outbox pozostaje ponawialny (Invariant #3).
-- 5. email_unsubscribe(profile, category) — RPC tylko dla service_role (endpoint
--    wypisania po weryfikacji podpisanego tokenu). Idempotentne; audyt tylko przy zmianie.
-- 6. Budżety: email_send_budget_config (limit dostawcy na okno + rezerwy) i
--    email_send_windows (licznik okna). take_email_send_budget(template) pod blokadą
--    wiersza okna: marketing kończy się przed rezerwą transakcyjną i auth,
--    transakcyjne przed rezerwą auth. Równoległe workery nie przekroczą limitu okna.
--
-- Status 'failed' + suppressed_at zamiast nowej wartości enuma: ALTER TYPE ADD VALUE
-- w transakcji migratora uniemożliwiłby użycie wartości w tej samej paczce migracji.
-- Rollback: enqueue_email z 0073, claim_email_batch z 0021; drop funkcji
-- email_unsubscribe / take_email_send_budget / email_send_pool / email_allowed /
-- email_preference_category, tabel email_send_windows / email_send_budget_config
-- i kolumny email_deliveries.suppressed_at. Migracja nie zmienia istniejących danych.
-- =============================================================================

alter table public.email_deliveries
  add column if not exists suppressed_at timestamptz;

-- --- 1. Kategoria preferencji dla typu maila ---------------------------------------
create or replace function public.email_preference_category(p_template text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case p_template
    when 'newApplication'    then 'applications'
    when 'statusChanged'     then 'applications'
    when 'applicationViewed' then 'applications'
    when 'jobOffer'          then 'offers'
    when 'offerAccepted'     then 'offers'
    when 'offerDeclined'     then 'offers'
    when 'newMessage'        then 'messages'
    when 'jobMatch'          then 'job_matches'
    when 'newsletter'        then 'marketing'
    else null
  end;
$$;
revoke all on function public.email_preference_category(text) from public;
grant execute on function public.email_preference_category(text) to service_role;

-- --- 2. Aktualna zgoda odbiorcy --------------------------------------------------
-- Typ bez kategorii (np. jobPublished) => zawsze dozwolony (jak dotąd).
create or replace function public.email_allowed(p_profile_id uuid, p_template text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select case c.cat
              when 'applications' then np.email_applications
              when 'offers'       then np.email_offers
              when 'messages'     then np.email_messages
              when 'job_matches'  then np.email_job_matches
              when 'marketing'    then np.email_marketing
              else null
            end
       from public.notification_preferences np
      where np.profile_id = p_profile_id),
    -- Brak wiersza (lub typ bez kategorii): domyślne wartości kolumn — marketing tylko po opt-in.
    c.cat is distinct from 'marketing')
  from (select public.email_preference_category(p_template) as cat) c;
$$;
revoke all on function public.email_allowed(uuid, text) from public;
grant execute on function public.email_allowed(uuid, text) to service_role;

-- --- 3. enqueue_email (0073) — preferencje przez email_allowed ----------------------
create or replace function public.enqueue_email(
  p_profile_id uuid,
  p_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email public.citext; v_locale text;
begin
  select u.email into v_email from auth.users u where u.id = p_profile_id;
  if v_email is null then return; end if;

  -- Opt-out: nie kolejkujemy. Worker sprawdza zgodę ponownie przy claimie.
  if not public.email_allowed(p_profile_id, p_type) then return; end if;

  v_locale := public.resolve_recipient_locale(p_profile_id);
  insert into public.email_deliveries
    (profile_id, to_email, template, locale, subject, status, entity_type, entity_id,
     idempotency_key, payload, queued_at, next_attempt_at, attempts)
  values
    (p_profile_id, v_email, p_type, v_locale, p_type, 'queued', p_entity_type, p_entity_id,
     p_idempotency_key, coalesce(p_payload, '{}'::jsonb), now(), now(), 0)
  on conflict (idempotency_key) where idempotency_key is not null
    do nothing;
end $$;

-- --- 4. claim_email_batch (0021) — ponowna kontrola zgody przed wysyłką -------------
create or replace function public.claim_email_batch(
  p_limit integer default 20,
  p_lease_seconds integer default 300
) returns setof public.email_deliveries language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with picked as (
    select e.id, public.email_allowed(e.profile_id, e.template) as allowed
      from public.email_deliveries e
     where e.status = 'queued'
       and e.next_attempt_at <= now()
       and (e.locked_at is null or e.locked_at < now() - make_interval(secs => p_lease_seconds))
     order by e.queued_at asc
     for update skip locked
     limit greatest(p_limit, 0)
  ), suppressed as (
    -- Odbiorca wypisał się po zakolejkowaniu: wiersz zostaje (ślad), ale nie wychodzi.
    update public.email_deliveries d
       set status = 'failed', suppressed_at = now(), error_message = 'suppressed_opt_out',
           locked_at = null, updated_at = now()
      from picked p
     where d.id = p.id and p.allowed is not true
    returning d.id
  )
  update public.email_deliveries d
     set locked_at = now(), updated_at = now()
    from picked p
   where d.id = p.id and p.allowed is true
  returning d.*;
end $$;

-- --- 5. Wypisanie (tylko service_role, po weryfikacji podpisanego tokenu) -----------
-- Zwraca true, gdy preferencja zmieniła się teraz; false przy ponowieniu lub braku profilu.
create or replace function public.email_unsubscribe(p_profile_id uuid, p_category text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_column text; v_changed integer;
begin
  if p_category is null
     or p_category not in ('applications', 'offers', 'messages', 'job_matches', 'marketing') then
    raise exception 'VALIDATION_FAILED: nieznana kategoria' using errcode = '22023';
  end if;
  if p_profile_id is null or not exists (select 1 from public.profiles where id = p_profile_id) then
    return false;
  end if;

  v_column := 'email_' || p_category;
  insert into public.notification_preferences (profile_id) values (p_profile_id)
    on conflict (profile_id) do nothing;
  execute format(
    'update public.notification_preferences set %I = false, updated_at = now()
      where profile_id = $1 and %I is distinct from false', v_column, v_column)
    using p_profile_id;
  get diagnostics v_changed = row_count;

  if v_changed > 0 then
    perform public.write_audit('email.unsubscribed', 'profile', p_profile_id, null,
                               jsonb_build_object('category', p_category));
  end if;
  return v_changed > 0;
end $$;
revoke all on function public.email_unsubscribe(uuid, text) from public;
grant execute on function public.email_unsubscribe(uuid, text) to service_role;

-- --- 6. Atomowe budżety wysyłki ----------------------------------------------------
create table if not exists public.email_send_budget_config (
  id                     boolean primary key default true check (id),
  window_seconds         integer not null default 60 check (window_seconds between 1 and 86400),
  provider_limit         integer not null default 100 check (provider_limit > 0),
  reserve_auth           integer not null default 20 check (reserve_auth >= 0),
  reserve_transactional  integer not null default 30 check (reserve_transactional >= 0),
  updated_at             timestamptz not null default now(),
  check (reserve_auth + reserve_transactional < provider_limit)
);
insert into public.email_send_budget_config (id) values (true) on conflict (id) do nothing;

create table if not exists public.email_send_windows (
  window_start        timestamptz primary key,
  auth_used           integer not null default 0 check (auth_used >= 0),
  transactional_used  integer not null default 0 check (transactional_used >= 0),
  marketing_used      integer not null default 0 check (marketing_used >= 0)
);

alter table public.email_send_budget_config enable row level security;
alter table public.email_send_windows enable row level security;
-- Brak polityk: odczyt/zapis wyłącznie przez service_role i funkcje SECURITY DEFINER.
revoke all on public.email_send_budget_config from public, anon, authenticated;
revoke all on public.email_send_windows from public, anon, authenticated;

create or replace function public.email_send_pool(p_template text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_template in ('accountConfirmation', 'passwordReset', 'magicLink', 'emailChange', 'invite')
      then 'auth'
    when p_template in ('newsletter', 'jobMatch') then 'marketing'
    else 'transactional'
  end;
$$;
revoke all on function public.email_send_pool(text) from public;
grant execute on function public.email_send_pool(text) to service_role;

-- Pula może zużywać okno, dopóki łączne zużycie jest poniżej jej sufitu:
--   auth          → provider_limit
--   transactional → provider_limit - reserve_auth
--   marketing     → provider_limit - reserve_auth - reserve_transactional
-- Blokada wiersza okna serializuje równoległe workery. Odmowa zwraca początek
-- następnego okna (retry_at) — worker odkłada wiersz bez zwiększania `attempts`.
create or replace function public.take_email_send_budget(p_template text)
returns table (granted boolean, retry_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cfg public.email_send_budget_config;
  v_pool text := public.email_send_pool(p_template);
  v_window timestamptz;
  v_next timestamptz;
  v_row public.email_send_windows;
  v_total integer;
  v_cap integer;
  v_inserted boolean;
begin
  select * into v_cfg from public.email_send_budget_config where id;
  if v_cfg.id is null then
    raise exception 'INTERNAL: brak konfiguracji budżetu wysyłki' using errcode = 'P0001';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / v_cfg.window_seconds) * v_cfg.window_seconds);
  v_next := v_window + make_interval(secs => v_cfg.window_seconds);

  insert into public.email_send_windows (window_start) values (v_window)
    on conflict (window_start) do nothing
    returning true into v_inserted;
  if v_inserted then
    -- Nowe okno: sprzątamy stare liczniki (doba zapasu na diagnostykę).
    delete from public.email_send_windows where window_start < v_window - interval '1 day';
  end if;

  select * into v_row from public.email_send_windows where window_start = v_window for update;
  v_total := v_row.auth_used + v_row.transactional_used + v_row.marketing_used;
  v_cap := case v_pool
    when 'auth' then v_cfg.provider_limit
    when 'transactional' then v_cfg.provider_limit - v_cfg.reserve_auth
    else v_cfg.provider_limit - v_cfg.reserve_auth - v_cfg.reserve_transactional
  end;

  if v_total >= v_cap then
    return query select false, v_next;
    return;
  end if;

  update public.email_send_windows
     set auth_used          = auth_used          + (v_pool = 'auth')::int,
         transactional_used = transactional_used + (v_pool = 'transactional')::int,
         marketing_used     = marketing_used     + (v_pool = 'marketing')::int
   where window_start = v_window;
  return query select true, null::timestamptz;
end $$;
revoke all on function public.take_email_send_budget(text) from public;
grant execute on function public.take_email_send_budget(text) to service_role;
