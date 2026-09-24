-- =============================================================================
-- 0098_email_delivery_events.sql — #44: zdarzenia doręczeń dostawcy poczty,
-- lista blokad adresów (suppression) i ręczne zdjęcie blokady przez admina.
--
-- 1. email_deliveries: czasy zdarzeń dostawcy (bounced_at, complained_at, delayed_at,
--    provider_event_at) i rodzaj odbicia (bounce_type). delivered_at istniało od 0006.
-- 2. email_suppressions — blokady adresów po TRWAŁYM odbiciu albo skardze. Jedna aktywna
--    blokada na adres (indeks częściowy `lifted_at is null`); zdjęta blokada zostaje jako
--    historia. RLS włączone i wymuszone, bez polityk; anon/authenticated bez grantów —
--    zapis wyłącznie przez funkcje SECURITY DEFINER (service_role / admin).
-- 3. email_address_suppressed(email) — jedno źródło odpowiedzi „czy adres jest zablokowany”.
-- 4. enqueue_email (0087) — adres z aktywną blokadą nie trafia do kolejki.
-- 5. claim_email_batch (0087) — wiersz zakolejkowany przed blokadą jest wygaszany tym samym
--    mechanizmem co wypisanie (status 'failed' + suppressed_at), z error_message
--    'suppressed_address'. Dzierżawa i SKIP LOCKED bez zmian (Invariant #3).
-- 6. record_email_event(...) — zapis zdarzenia dostawcy (tylko service_role, woła go
--    webhook po weryfikacji podpisu i claimie inboxu processed_webhooks):
--      * status tylko „w górę” (sent < delivered < bounced < complained) — spóźnione
--        zdarzenie nie cofa nowszego stanu; czasy zapisywane przy pierwszym wystąpieniu,
--      * delivery_delayed nie zmienia statusu (tylko delayed_at),
--      * odbicie inne niż trwałe (transient/undetermined) zapisuje bounce_type/bounced_at,
--        bez zmiany statusu i bez blokady,
--      * trwałe odbicie i skarga → blokada adresu (także gdy wiadomości nie ma w
--        email_deliveries, np. e-mail Auth wysłany poza kolejką),
--      * ponowienie tego samego zdarzenia nie zmienia żadnego wiersza.
-- 7. admin_lift_email_suppression(id, reason) — zdjęcie blokady przez
--    admina (is_admin(), uzasadnienie wymagane) z audytem.
--
-- E-maile Auth (weryfikacja konta, reset hasła) nie przechodzą przez enqueue_email i nie są
-- blokowane: to wysyłki obowiązkowe, inicjowane przez użytkownika. Blokada dotyczy
-- nieobowiązkowych powiadomień z kolejki email_deliveries.
--
-- Rollback: enqueue_email i claim_email_batch z 0087; drop funkcji
-- admin_lift_email_suppression / record_email_event / email_delivery_status_rank /
-- email_address_suppressed, tabeli email_suppressions i kolumn email_deliveries
-- (bounced_at, complained_at, delayed_at, bounce_type, provider_event_at).
-- Migracja nie zmienia istniejących danych.
-- =============================================================================

-- --- 1. Czasy zdarzeń dostawcy ------------------------------------------------------
alter table public.email_deliveries
  add column if not exists bounced_at        timestamptz,
  add column if not exists complained_at     timestamptz,
  add column if not exists delayed_at        timestamptz,
  add column if not exists bounce_type       text,
  add column if not exists provider_event_at timestamptz;

do $$ begin
  alter table public.email_deliveries
    add constraint email_deliveries_bounce_type
    check (bounce_type is null or bounce_type in ('permanent', 'transient', 'undetermined'));
exception when duplicate_object then null; end $$;

-- --- 2. Blokady adresów ---------------------------------------------------------------
create table if not exists public.email_suppressions (
  id                  uuid primary key default gen_random_uuid(),
  email               citext not null,
  reason              text not null,
  provider            text not null default 'resend',
  provider_message_id text,
  delivery_id         uuid references public.email_deliveries(id) on delete set null,
  created_at          timestamptz not null default now(),
  lifted_at           timestamptz,
  lifted_by           uuid references public.profiles(id) on delete set null,
  lift_reason         text,
  constraint email_suppressions_reason check (reason in ('hard_bounce', 'complaint')),
  constraint email_suppressions_email_len check (char_length(email::text) between 3 and 320),
  constraint email_suppressions_provider_len check (char_length(provider) between 1 and 40),
  constraint email_suppressions_message_len check (
    provider_message_id is null or char_length(provider_message_id) <= 200),
  constraint email_suppressions_lift check (
    (lifted_at is null and lifted_by is null and lift_reason is null)
    or (lifted_at is not null and char_length(btrim(coalesce(lift_reason, ''))) between 1 and 1000))
);

create unique index if not exists uq_email_suppressions_active
  on public.email_suppressions (email) where lifted_at is null;
create index if not exists idx_email_suppressions_created
  on public.email_suppressions (created_at desc, id desc);

alter table public.email_suppressions enable row level security;
alter table public.email_suppressions force row level security;
revoke all on public.email_suppressions from public, anon, authenticated;

-- --- 3. Czy adres jest zablokowany -------------------------------------------------------
create or replace function public.email_address_suppressed(p_email text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_email is not null and exists (
    select 1 from public.email_suppressions s
     where s.email = p_email::citext and s.lifted_at is null);
$$;
revoke all on function public.email_address_suppressed(text) from public;
grant execute on function public.email_address_suppressed(text) to service_role;

-- --- 4. enqueue_email (0087) — bez kolejkowania na zablokowany adres ---------------------
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
  -- #44: trwałe odbicie albo skarga na ten adres — nie kolejkujemy.
  if public.email_address_suppressed(v_email::text) then return; end if;

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

-- --- 5. claim_email_batch (0087) — wygaszanie wierszy na zablokowany adres ---------------
create or replace function public.claim_email_batch(
  p_limit integer default 20,
  p_lease_seconds integer default 300
) returns setof public.email_deliveries language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with picked as (
    select e.id,
           public.email_allowed(e.profile_id, e.template) as allowed,
           public.email_address_suppressed(e.to_email::text) as blocked
      from public.email_deliveries e
     where e.status = 'queued'
       and e.next_attempt_at <= now()
       and (e.locked_at is null or e.locked_at < now() - make_interval(secs => p_lease_seconds))
     order by e.queued_at asc
     for update skip locked
     limit greatest(p_limit, 0)
  ), suppressed as (
    -- Odbiorca wypisał się albo adres dostał blokadę po zakolejkowaniu: wiersz zostaje
    -- (ślad), ale nie wychodzi.
    update public.email_deliveries d
       set status = 'failed', suppressed_at = now(),
           error_message = case when p.blocked then 'suppressed_address' else 'suppressed_opt_out' end,
           locked_at = null, updated_at = now()
      from picked p
     where d.id = p.id and (p.allowed is not true or p.blocked)
    returning d.id
  )
  update public.email_deliveries d
     set locked_at = now(), updated_at = now()
    from picked p
   where d.id = p.id and p.allowed is true and not p.blocked
  returning d.*;
end $$;

-- --- 6. Zdarzenia dostawcy ---------------------------------------------------------------
-- Ranga statusu: stan niższej rangi nie nadpisuje wyższego (zdarzenia przychodzą w dowolnej
-- kolejności). opened/clicked (0001) traktujemy jak delivered.
create or replace function public.email_delivery_status_rank(p_status public.email_status)
returns integer language sql immutable set search_path = public, pg_temp as $$
  select case p_status
    when 'queued'     then 0
    when 'failed'     then 0
    when 'sent'       then 1
    when 'delivered'  then 2
    when 'opened'     then 2
    when 'clicked'    then 2
    when 'bounced'    then 3
    when 'complained' then 4
    else 0
  end;
$$;
revoke all on function public.email_delivery_status_rank(public.email_status) from public;
grant execute on function public.email_delivery_status_rank(public.email_status) to service_role;

-- Zwraca: 'applied' (zmieniono wiersz wysyłki lub dodano blokadę), 'unchanged' (ponowienie /
-- starsze zdarzenie) albo 'unknown_message' (brak wiersza wysyłki i brak nowej blokady).
create or replace function public.record_email_event(
  p_provider text,
  p_provider_message_id text,
  p_event text,
  p_occurred_at timestamptz,
  p_recipient text default null,
  p_bounce_type text default null
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.email_deliveries;
  v_found boolean;
  v_at timestamptz := least(coalesce(p_occurred_at, now()), now());
  v_bounce text;
  v_hard boolean;
  v_target public.email_status;
  v_status public.email_status;
  v_delivered timestamptz;
  v_bounced timestamptz;
  v_bounce_type text;
  v_complained timestamptz;
  v_delayed timestamptz;
  v_event_at timestamptz;
  v_changed boolean := false;
  v_email text;
  v_supp uuid;
begin
  if p_provider is null or char_length(p_provider) not between 1 and 40 then
    raise exception 'VALIDATION_FAILED: provider' using errcode = '22023';
  end if;
  if p_provider_message_id is null or char_length(p_provider_message_id) not between 1 and 200 then
    raise exception 'VALIDATION_FAILED: provider_message_id' using errcode = '22023';
  end if;
  if p_event is null or p_event not in ('delivered', 'delivery_delayed', 'bounced', 'complained') then
    raise exception 'VALIDATION_FAILED: event' using errcode = '22023';
  end if;

  v_bounce := case when p_event = 'bounced' then
    case lower(coalesce(p_bounce_type, ''))
      when 'permanent' then 'permanent'
      when 'transient' then 'transient'
      else 'undetermined'
    end end;
  v_hard := v_bounce = 'permanent';
  v_target := case
    when p_event = 'delivered' then 'delivered'::public.email_status
    when p_event = 'complained' then 'complained'::public.email_status
    when v_hard then 'bounced'::public.email_status
  end;

  select * into v_row from public.email_deliveries
   where provider_message_id = p_provider_message_id and provider = p_provider
   for update;
  v_found := found;

  if v_found then
    v_status := v_row.status;
    if v_target is not null
       and public.email_delivery_status_rank(v_target) > public.email_delivery_status_rank(v_row.status) then
      v_status := v_target;
    end if;
    v_delivered := case when p_event = 'delivered' then coalesce(v_row.delivered_at, v_at) else v_row.delivered_at end;
    v_bounced := case when p_event = 'bounced' then coalesce(v_row.bounced_at, v_at) else v_row.bounced_at end;
    -- Trwałe odbicie wygrywa z wcześniejszym przejściowym; przejściowe nie nadpisuje trwałego.
    v_bounce_type := case
      when v_bounce is null then v_row.bounce_type
      when v_row.bounce_type = 'permanent' then 'permanent'
      else v_bounce end;
    v_complained := case when p_event = 'complained' then coalesce(v_row.complained_at, v_at) else v_row.complained_at end;
    v_delayed := case when p_event = 'delivery_delayed' then greatest(coalesce(v_row.delayed_at, v_at), v_at) else v_row.delayed_at end;
    v_event_at := greatest(coalesce(v_row.provider_event_at, v_at), v_at);

    if v_status is distinct from v_row.status
       or v_delivered is distinct from v_row.delivered_at
       or v_bounced is distinct from v_row.bounced_at
       or v_bounce_type is distinct from v_row.bounce_type
       or v_complained is distinct from v_row.complained_at
       or v_delayed is distinct from v_row.delayed_at
       or v_event_at is distinct from v_row.provider_event_at then
      update public.email_deliveries
         set status = v_status, delivered_at = v_delivered, bounced_at = v_bounced,
             bounce_type = v_bounce_type, complained_at = v_complained, delayed_at = v_delayed,
             provider_event_at = v_event_at, updated_at = now()
       where id = v_row.id;
      v_changed := true;
    end if;
    v_email := v_row.to_email::text;
  else
    v_email := nullif(btrim(coalesce(p_recipient, '')), '');
    if v_email is not null and char_length(v_email) not between 3 and 320 then v_email := null; end if;
  end if;

  if (v_hard or p_event = 'complained') and v_email is not null then
    insert into public.email_suppressions (email, reason, provider, provider_message_id, delivery_id)
    values (v_email::citext,
            case when p_event = 'complained' then 'complaint' else 'hard_bounce' end,
            p_provider, p_provider_message_id, case when v_found then v_row.id end)
    on conflict (email) where lifted_at is null do nothing
    returning id into v_supp;
    if v_supp is not null then
      v_changed := true;
      -- Bez adresu w dzienniku: identyfikator blokady wystarcza do podglądu w panelu.
      perform public.write_audit('email.suppressed', 'email_suppression', v_supp, null,
        jsonb_build_object('status', case when p_event = 'complained' then 'complaint' else 'hard_bounce' end));
    end if;
  end if;

  if v_changed then return 'applied'; end if;
  return case when v_found then 'unchanged' else 'unknown_message' end;
end $$;
revoke all on function public.record_email_event(text, text, text, timestamptz, text, text) from public;
grant execute on function public.record_email_event(text, text, text, timestamptz, text, text) to service_role;

-- --- 7. Zdjęcie blokady przez admina ------------------------------------------------------
create or replace function public.admin_lift_email_suppression(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_row public.email_suppressions;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if char_length(v_reason) = 0 then
    raise exception 'VALIDATION_FAILED: REASON_REQUIRED' using errcode = '22023';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'VALIDATION_FAILED: REASON_TOO_LONG' using errcode = '22023';
  end if;

  select * into v_row from public.email_suppressions where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  -- Inny admin zdjął ją w międzyczasie.
  if v_row.lifted_at is not null then raise exception 'STALE_STATE: blokada została już zdjęta'; end if;

  update public.email_suppressions
     set lifted_at = now(), lifted_by = auth.uid(), lift_reason = v_reason
   where id = p_id;

  perform public.write_audit('email.suppression_lifted', 'email_suppression', p_id,
    jsonb_build_object('status', v_row.reason),
    jsonb_build_object('status', 'lifted', 'reason', v_reason));
end $$;
revoke all on function public.admin_lift_email_suppression(uuid, text) from public;
grant execute on function public.admin_lift_email_suppression(uuid, text) to authenticated;
