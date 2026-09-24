-- =============================================================================
-- 0101_email_consent_campaigns.sql — #45, etap 2: dowód zgody, budżet na odbiorcę,
-- rezerwacja kampanii „rewizja + odbiorca”. Buduje na 0087 (wypisanie, budżet dostawcy)
-- i 0098 (#44, blokady adresów) — numer tymczasowy, nada go koordynator.
--
-- 1. email_consent_events — NIEZMIENNY dowód każdej zmiany zgody e-mail (kategoria,
--    zgoda/wycofanie, źródło, język, wersja treści pokazanej przy zgodzie). Zapisuje go
--    trigger na notification_preferences, więc żadna ścieżka zapisu (ustawienia, wypisanie,
--    bezpośredni UPDATE pod RLS) nie zmieni zgody bez śladu. Źródło, język i wersję treści
--    podają RPC przez ustawienia transakcji `pracujbe.email_consent_*`; bez nich źródło to
--    'direct', a język = język odbiorcy (Invariant #1).
-- 2. set_notification_preferences(prefs, locale, wording) — zapis preferencji zalogowanego
--    użytkownika z dowodem (źródło 'settings', wersja treści `sha256:<hex>` liczona przez
--    aplikację z pokazanych etykiet).
-- 3. email_unsubscribe(profile, category, source, locale) i email_unsubscribe_all(...) —
--    wypisanie z dowodem (źródło 'unsubscribe_page' / 'one_click').
-- 4. Budżet na odbiorcę przy KOLEJKOWANIU: email_recipient_budget_config (zakres
--    `pool:<pula>` albo `template:<typ>`, okno, limit) i email_recipient_windows (licznik).
--    Licznik rośnie jednym INSERT … ON CONFLICT DO UPDATE … WHERE used < limit (blokada
--    wiersza) — równoległe enqueue nie przekroczą limitu. Wiersz ponad limit zostaje jako
--    ślad (status 'failed', suppressed_at, 'suppressed_recipient_budget'), więc ponowienie
--    z tym samym kluczem nie tworzy drugiego listu (Invariant #3). List wygaszony przed
--    wysyłką oddaje miejsce (trigger refund_email_recipient_budget).
-- 5. enqueue_email_outcome(...) — jedna implementacja kolejkowania z wynikiem
--    (queued/duplicate/no_email/opted_out/suppressed_address/recipient_budget);
--    enqueue_email zachowuje sygnaturę i zachowanie z 0098 (+ budżet odbiorcy).
-- 6. Kampanie: email_campaigns (slug + rewizja, treść per język, status) i
--    email_campaign_recipients (PK = rewizja + odbiorca; status reserved/queued/accepted/
--    delivered/skipped_consent/failed/cancelled, bez treści i bez adresu e-mail).
--    enqueue_campaign_batch rezerwuje odbiorcę atomowo PRZED kolejkowaniem; zgoda jest
--    sprawdzana dla każdej rewizji osobno; aktywacja nowej rewizji wygasza niewysłane listy
--    starej, a starej rewizji nie da się aktywować ponownie.
-- 7. claim_email_batch (0098) — dodatkowo wygasza listy kampanii, której rewizja nie jest
--    już aktywna ('suppressed_campaign_inactive'). Trigger synchronizuje status odbiorcy
--    kampanii ze statusem wysyłki.
--
-- Rollback: enqueue_email i claim_email_batch z 0098; email_unsubscribe(uuid, text) z 0087;
-- drop funkcji set_notification_preferences / email_unsubscribe_all / enqueue_email_outcome /
-- take_email_recipient_budget / create_email_campaign_revision / activate_email_campaign /
-- cancel_email_campaign / enqueue_campaign_batch / process_email_campaigns /
-- record_email_consent_change / sync_email_campaign_recipient / guard_email_consent_events /
-- email_consent_context / email_campaign_content_ok / refund_email_recipient_budget,
-- triggerów, tabel email_campaign_recipients / email_campaigns / email_recipient_windows /
-- email_recipient_budget_config / email_consent_events i kolumny email_deliveries.campaign_id.
-- Migracja nie zmienia istniejących danych.
-- =============================================================================

-- --- 1. Dowód zgody ------------------------------------------------------------------
create table if not exists public.email_consent_events (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  category        text not null,
  granted         boolean not null,
  source          text not null,
  locale          text not null references public.supported_locales(code),
  wording_version text,
  created_at      timestamptz not null default now(),
  constraint email_consent_events_category check (
    category in ('applications', 'offers', 'messages', 'job_matches', 'marketing')),
  constraint email_consent_events_source check (
    source in ('settings', 'unsubscribe_page', 'one_click', 'direct')),
  constraint email_consent_events_wording check (
    wording_version is null or wording_version ~ '^sha256:[0-9a-f]{64}$')
);
create index if not exists idx_email_consent_events_profile
  on public.email_consent_events (profile_id, created_at desc);

alter table public.email_consent_events enable row level security;
alter table public.email_consent_events force row level security;
revoke all on public.email_consent_events from public, anon, authenticated;
grant select on public.email_consent_events to authenticated;
drop policy if exists email_consent_events_select_own on public.email_consent_events;
create policy email_consent_events_select_own on public.email_consent_events
  for select to authenticated using (profile_id = auth.uid());

-- Niezmienność: dowodu nie poprawia nikt (także service_role i właściciel tabel).
-- DELETE zostaje tylko jako kaskada usunięcia konta (klienci nie mają grantu).
create or replace function public.guard_email_consent_events()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'PERMISSION_DENIED: dowód zgody jest niezmienny' using errcode = '42501';
end $$;
drop trigger if exists email_consent_events_immutable on public.email_consent_events;
create trigger email_consent_events_immutable
  before update on public.email_consent_events
  for each row execute function public.guard_email_consent_events();

-- Kontekst zapisu (ustawiany przez RPC na czas transakcji). Nieznane wartości = brak.
create or replace function public.email_consent_context(p_key text)
returns text language sql stable set search_path = public, pg_temp as $$
  select nullif(current_setting('pracujbe.email_consent_' || p_key, true), '');
$$;
revoke all on function public.email_consent_context(text) from public;

create or replace function public.record_email_consent_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_source text := public.email_consent_context('source');
  v_locale text := public.email_consent_context('locale');
  v_wording text := public.email_consent_context('wording');
  v_cat text;
  v_old boolean;
  v_new boolean;
begin
  if v_source is null or v_source not in ('settings', 'unsubscribe_page', 'one_click') then
    v_source := 'direct';
  end if;
  if v_locale is null or not public.is_supported_locale(v_locale) then
    v_locale := public.resolve_recipient_locale(new.profile_id);
  end if;
  if v_wording is not null and v_wording !~ '^sha256:[0-9a-f]{64}$' then
    v_wording := null;
  end if;

  foreach v_cat in array array['applications', 'offers', 'messages', 'job_matches', 'marketing'] loop
    v_new := case v_cat
      when 'applications' then new.email_applications
      when 'offers'       then new.email_offers
      when 'messages'     then new.email_messages
      when 'job_matches'  then new.email_job_matches
      else new.email_marketing end;
    if tg_op = 'INSERT' then
      -- Wiersz startowy (handle_new_user) ma wartości domyślne kolumn — to nie jest zgoda.
      v_old := v_cat <> 'marketing';
    else
      v_old := case v_cat
        when 'applications' then old.email_applications
        when 'offers'       then old.email_offers
        when 'messages'     then old.email_messages
        when 'job_matches'  then old.email_job_matches
        else old.email_marketing end;
    end if;
    if v_new is distinct from v_old then
      insert into public.email_consent_events (profile_id, category, granted, source, locale, wording_version)
      values (new.profile_id, v_cat, v_new, v_source, v_locale,
              case when v_new then v_wording end);
    end if;
  end loop;
  return null;
end $$;
revoke all on function public.record_email_consent_change() from public;

drop trigger if exists notification_preferences_consent_events on public.notification_preferences;
create trigger notification_preferences_consent_events
  after insert or update on public.notification_preferences
  for each row execute function public.record_email_consent_change();

-- --- 2. Zapis preferencji z dowodem (zalogowany użytkownik) ---------------------------
create or replace function public.set_notification_preferences(
  p_prefs jsonb,
  p_locale text,
  p_wording_version text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then
    raise exception 'VALIDATION_FAILED: prefs' using errcode = '22023';
  end if;
  foreach v_key in array array['email_applications', 'email_offers', 'email_messages',
      'email_job_matches', 'email_marketing', 'push_enabled', 'in_app_enabled'] loop
    if jsonb_typeof(p_prefs -> v_key) is distinct from 'boolean' then
      raise exception 'VALIDATION_FAILED: %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_locale is null or not public.is_supported_locale(p_locale) then
    raise exception 'VALIDATION_FAILED: locale' using errcode = '22023';
  end if;
  if p_wording_version is not null and p_wording_version !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'VALIDATION_FAILED: wording_version' using errcode = '22023';
  end if;

  perform set_config('pracujbe.email_consent_source', 'settings', true);
  perform set_config('pracujbe.email_consent_locale', p_locale, true);
  perform set_config('pracujbe.email_consent_wording', coalesce(p_wording_version, ''), true);

  insert into public.notification_preferences as np
    (profile_id, email_applications, email_offers, email_messages, email_job_matches,
     email_marketing, push_enabled, in_app_enabled)
  values
    (v_uid, (p_prefs ->> 'email_applications')::boolean, (p_prefs ->> 'email_offers')::boolean,
     (p_prefs ->> 'email_messages')::boolean, (p_prefs ->> 'email_job_matches')::boolean,
     (p_prefs ->> 'email_marketing')::boolean, (p_prefs ->> 'push_enabled')::boolean,
     (p_prefs ->> 'in_app_enabled')::boolean)
  on conflict (profile_id) do update
    set email_applications = excluded.email_applications,
        email_offers       = excluded.email_offers,
        email_messages     = excluded.email_messages,
        email_job_matches  = excluded.email_job_matches,
        email_marketing    = excluded.email_marketing,
        push_enabled       = excluded.push_enabled,
        in_app_enabled     = excluded.in_app_enabled,
        updated_at         = now();

  -- Kontekst tylko dla tego zapisu (kolejne instrukcje transakcji mają źródło 'direct').
  perform set_config('pracujbe.email_consent_source', '', true);
  perform set_config('pracujbe.email_consent_locale', '', true);
  perform set_config('pracujbe.email_consent_wording', '', true);
end $$;
revoke all on function public.set_notification_preferences(jsonb, text, text) from public;
grant execute on function public.set_notification_preferences(jsonb, text, text) to authenticated;

-- --- 3. Wypisanie z dowodem ----------------------------------------------------------
drop function if exists public.email_unsubscribe(uuid, text);
create or replace function public.email_unsubscribe(
  p_profile_id uuid,
  p_category text,
  p_source text default 'unsubscribe_page',
  p_locale text default null
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_column text; v_changed integer;
begin
  if p_category is null
     or p_category not in ('applications', 'offers', 'messages', 'job_matches', 'marketing') then
    raise exception 'VALIDATION_FAILED: nieznana kategoria' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('unsubscribe_page', 'one_click') then
    raise exception 'VALIDATION_FAILED: source' using errcode = '22023';
  end if;
  if p_profile_id is null or not exists (select 1 from public.profiles where id = p_profile_id) then
    return false;
  end if;

  perform set_config('pracujbe.email_consent_source', p_source, true);
  perform set_config('pracujbe.email_consent_locale',
    case when public.is_supported_locale(p_locale) then p_locale else '' end, true);
  perform set_config('pracujbe.email_consent_wording', '', true);

  v_column := 'email_' || p_category;
  insert into public.notification_preferences (profile_id) values (p_profile_id)
    on conflict (profile_id) do nothing;
  execute format(
    'update public.notification_preferences set %I = false, updated_at = now()
      where profile_id = $1 and %I is distinct from false', v_column, v_column)
    using p_profile_id;
  get diagnostics v_changed = row_count;

  perform set_config('pracujbe.email_consent_source', '', true);
  perform set_config('pracujbe.email_consent_locale', '', true);

  if v_changed > 0 then
    perform public.write_audit('email.unsubscribed', 'profile', p_profile_id, null,
                               jsonb_build_object('category', p_category));
  end if;
  return v_changed > 0;
end $$;
revoke all on function public.email_unsubscribe(uuid, text, text, text) from public;
grant execute on function public.email_unsubscribe(uuid, text, text, text) to service_role;

-- Wypisanie ze wszystkich kategorii naraz (strona wypisania). Jeden UPDATE = jedna zmiana.
create or replace function public.email_unsubscribe_all(
  p_profile_id uuid,
  p_source text default 'unsubscribe_page',
  p_locale text default null
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_changed integer;
begin
  if p_source is null or p_source not in ('unsubscribe_page', 'one_click') then
    raise exception 'VALIDATION_FAILED: source' using errcode = '22023';
  end if;
  if p_profile_id is null or not exists (select 1 from public.profiles where id = p_profile_id) then
    return false;
  end if;

  perform set_config('pracujbe.email_consent_source', p_source, true);
  perform set_config('pracujbe.email_consent_locale',
    case when public.is_supported_locale(p_locale) then p_locale else '' end, true);
  perform set_config('pracujbe.email_consent_wording', '', true);

  insert into public.notification_preferences (profile_id) values (p_profile_id)
    on conflict (profile_id) do nothing;
  update public.notification_preferences
     set email_applications = false, email_offers = false, email_messages = false,
         email_job_matches = false, email_marketing = false, updated_at = now()
   where profile_id = p_profile_id
     and (email_applications or email_offers or email_messages or email_job_matches or email_marketing);
  get diagnostics v_changed = row_count;

  perform set_config('pracujbe.email_consent_source', '', true);
  perform set_config('pracujbe.email_consent_locale', '', true);

  if v_changed > 0 then
    perform public.write_audit('email.unsubscribed', 'profile', p_profile_id, null,
                               jsonb_build_object('category', 'all'));
  end if;
  return v_changed > 0;
end $$;
revoke all on function public.email_unsubscribe_all(uuid, text, text) from public;
grant execute on function public.email_unsubscribe_all(uuid, text, text) to service_role;

-- --- 4. Budżet na odbiorcę przy kolejkowaniu ------------------------------------------
create table if not exists public.email_recipient_budget_config (
  scope             text primary key,
  window_seconds    integer not null check (window_seconds between 60 and 2592000),
  max_per_recipient integer not null check (max_per_recipient > 0),
  updated_at        timestamptz not null default now(),
  constraint email_recipient_budget_scope check (
    scope ~ '^(pool:(transactional|marketing)|template:[A-Za-z]{1,60})$')
);
-- Domyślnie: newsletter najwyżej 1 na dobę, cała pula marketingowa (newsletter + digesty
-- zapisanych wyszukiwań) najwyżej 10 na dobę. Pula transakcyjna bez limitu na odbiorcę
-- (operator może dodać wiersz, np. `template:newMessage`). E-maile Auth nie idą przez kolejkę.
insert into public.email_recipient_budget_config (scope, window_seconds, max_per_recipient) values
  ('template:newsletter', 86400, 1),
  ('pool:marketing', 86400, 10)
on conflict (scope) do nothing;

create table if not exists public.email_recipient_windows (
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  scope        text not null,
  window_start timestamptz not null,
  used         integer not null default 0 check (used >= 0),
  primary key (profile_id, scope, window_start)
);
create index if not exists idx_email_recipient_windows_start
  on public.email_recipient_windows (window_start);

alter table public.email_recipient_budget_config enable row level security;
alter table public.email_recipient_budget_config force row level security;
alter table public.email_recipient_windows enable row level security;
alter table public.email_recipient_windows force row level security;
revoke all on public.email_recipient_budget_config from public, anon, authenticated;
revoke all on public.email_recipient_windows from public, anon, authenticated;

-- Pobiera po jednym miejscu z każdego pasującego zakresu (pula, typ). Odmowa któregokolwiek
-- cofa już pobrane (ta sama transakcja trzyma blokady wierszy). Zwraca true = przyznano.
create or replace function public.take_email_recipient_budget(p_profile_id uuid, p_template text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cfg record;
  v_start timestamptz;
  v_used integer;
  v_taken text[] := '{}';
  v_starts timestamptz[] := '{}';
  i integer;
begin
  if p_profile_id is null then return true; end if;
  for v_cfg in
    select c.scope, c.window_seconds, c.max_per_recipient
      from public.email_recipient_budget_config c
     where c.scope in ('pool:' || public.email_send_pool(p_template), 'template:' || p_template)
     order by c.scope
  loop
    v_start := to_timestamp(
      floor(extract(epoch from now()) / v_cfg.window_seconds) * v_cfg.window_seconds);
    v_used := null;
    insert into public.email_recipient_windows as w (profile_id, scope, window_start, used)
    values (p_profile_id, v_cfg.scope, v_start, 1)
    on conflict (profile_id, scope, window_start) do update
      set used = w.used + 1
      where w.used < v_cfg.max_per_recipient
    returning w.used into v_used;
    if v_used is null then
      for i in 1 .. coalesce(array_length(v_taken, 1), 0) loop
        update public.email_recipient_windows
           set used = used - 1
         where profile_id = p_profile_id and scope = v_taken[i] and window_start = v_starts[i];
      end loop;
      return false;
    end if;
    v_taken := v_taken || v_cfg.scope;
    v_starts := v_starts || v_start;
  end loop;
  -- Sprzątanie liczników starszych niż najdłuższe dozwolone okno (30 dni) + zapas.
  delete from public.email_recipient_windows
   where profile_id = p_profile_id and window_start < now() - interval '31 days';
  return true;
end $$;
revoke all on function public.take_email_recipient_budget(uuid, text) from public;
grant execute on function public.take_email_recipient_budget(uuid, text) to service_role;

-- Zwrot miejsca, gdy zakolejkowany list zostaje wygaszony przed wysyłką (wypisanie,
-- blokada adresu, nieaktywna rewizja kampanii): odbiorca nie dostał listu, więc limit nie
-- może blokować np. poprawionej rewizji newslettera. Okno liczone od queued_at (= chwila
-- pobrania budżetu w enqueue_email_outcome).
create or replace function public.refund_email_recipient_budget()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cfg record;
begin
  if new.profile_id is null or old.status <> 'queued' or new.status <> 'failed'
     or new.suppressed_at is null or new.error_message = 'suppressed_recipient_budget' then
    return null;
  end if;
  for v_cfg in
    select c.scope, c.window_seconds
      from public.email_recipient_budget_config c
     where c.scope in ('pool:' || public.email_send_pool(new.template), 'template:' || new.template)
  loop
    update public.email_recipient_windows w
       set used = w.used - 1
     where w.profile_id = new.profile_id and w.scope = v_cfg.scope and w.used > 0
       and w.window_start = to_timestamp(
             floor(extract(epoch from new.queued_at) / v_cfg.window_seconds) * v_cfg.window_seconds);
  end loop;
  return null;
end $$;
revoke all on function public.refund_email_recipient_budget() from public;

drop trigger if exists email_deliveries_refund_recipient_budget on public.email_deliveries;
create trigger email_deliveries_refund_recipient_budget
  after update of status on public.email_deliveries
  for each row execute function public.refund_email_recipient_budget();

-- --- 5. Kolejkowanie z wynikiem --------------------------------------------------------
alter table public.email_deliveries
  add column if not exists campaign_id uuid;

create or replace function public.enqueue_email_outcome(
  p_profile_id uuid,
  p_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_campaign_id uuid default null,
  out outcome text,
  out delivery_id uuid
) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email public.citext; v_locale text;
begin
  select u.email into v_email from auth.users u where u.id = p_profile_id;
  if v_email is null then outcome := 'no_email'; return; end if;

  -- Opt-out: nie kolejkujemy. Worker sprawdza zgodę ponownie przy claimie.
  if not public.email_allowed(p_profile_id, p_type) then outcome := 'opted_out'; return; end if;
  -- #44: trwałe odbicie albo skarga na ten adres — nie kolejkujemy.
  if public.email_address_suppressed(v_email::text) then outcome := 'suppressed_address'; return; end if;

  v_locale := public.resolve_recipient_locale(p_profile_id);
  insert into public.email_deliveries
    (profile_id, to_email, template, locale, subject, status, entity_type, entity_id,
     idempotency_key, payload, queued_at, next_attempt_at, attempts, campaign_id)
  values
    (p_profile_id, v_email, p_type, v_locale, p_type, 'queued', p_entity_type, p_entity_id,
     p_idempotency_key, coalesce(p_payload, '{}'::jsonb), now(), now(), 0, p_campaign_id)
  on conflict (idempotency_key) where idempotency_key is not null
    do nothing
  returning id into delivery_id;

  if delivery_id is null then
    -- Ponowienie z tym samym kluczem: bez drugiego listu i bez zużycia budżetu.
    select d.id into delivery_id from public.email_deliveries d
     where d.idempotency_key = p_idempotency_key;
    outcome := 'duplicate';
    return;
  end if;

  if not public.take_email_recipient_budget(p_profile_id, p_type) then
    update public.email_deliveries
       set status = 'failed', suppressed_at = now(), error_message = 'suppressed_recipient_budget',
           updated_at = now()
     where id = delivery_id;
    outcome := 'recipient_budget';
    return;
  end if;
  outcome := 'queued';
end $$;
revoke all on function public.enqueue_email_outcome(uuid, text, text, uuid, text, jsonb, uuid) from public;
grant execute on function public.enqueue_email_outcome(uuid, text, text, uuid, text, jsonb, uuid) to service_role;

create or replace function public.enqueue_email(
  p_profile_id uuid,
  p_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.enqueue_email_outcome(p_profile_id, p_type, p_entity_type, p_entity_id,
                                       p_idempotency_key, p_payload, null);
end $$;

-- --- 6. Kampanie --------------------------------------------------------------------
-- Kształt treści: obiekt `{ "<język>": { "jobs": [1–3 ofert] } }`. Komplet języków
-- (supported_locales) sprawdza create_email_campaign_revision.
create or replace function public.email_campaign_content_ok(p_content jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select jsonb_typeof(p_content) = 'object'
     and coalesce((
       select bool_and(case when jsonb_typeof(v -> 'jobs') = 'array'
                            then jsonb_array_length(v -> 'jobs') between 1 and 3
                            else false end)
         from jsonb_each(p_content) e(k, v)), false);
$$;

create table if not exists public.email_campaigns (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null,
  revision     integer not null check (revision > 0),
  template     text not null default 'newsletter',
  status       text not null default 'draft',
  content      jsonb not null,
  created_at   timestamptz not null default now(),
  activated_at timestamptz,
  closed_at    timestamptz,
  constraint email_campaigns_slug check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  constraint email_campaigns_template check (template in ('newsletter')),
  constraint email_campaigns_status check (
    status in ('draft', 'active', 'completed', 'superseded', 'cancelled')),
  -- Treść w każdym obsługiwanym języku (list idzie w języku odbiorcy, Invariant #1).
  constraint email_campaigns_content check (public.email_campaign_content_ok(content)),
  constraint email_campaigns_content_size check (pg_column_size(content) <= 65536),
  unique (slug, revision)
);
create unique index if not exists uq_email_campaigns_active_slug
  on public.email_campaigns (slug) where status = 'active';

do $$ begin
  alter table public.email_deliveries
    add constraint email_deliveries_campaign_fk
    foreign key (campaign_id) references public.email_campaigns(id) on delete set null;
exception when duplicate_object then null; end $$;
create index if not exists idx_email_deliveries_campaign
  on public.email_deliveries (campaign_id) where campaign_id is not null;

create table if not exists public.email_campaign_recipients (
  campaign_id  uuid not null references public.email_campaigns(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'reserved',
  delivery_id  uuid references public.email_deliveries(id) on delete set null,
  reason       text,
  reserved_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (campaign_id, profile_id),
  constraint email_campaign_recipients_status check (
    status in ('reserved', 'queued', 'accepted', 'delivered', 'skipped_consent', 'failed', 'cancelled')),
  constraint email_campaign_recipients_reason check (
    reason is null or reason in ('opted_out', 'suppressed_address', 'recipient_budget', 'no_email',
                                 'send_failed', 'bounced', 'complained', 'superseded', 'cancelled'))
);
create index if not exists idx_email_campaign_recipients_profile
  on public.email_campaign_recipients (profile_id);

alter table public.email_campaigns enable row level security;
alter table public.email_campaigns force row level security;
alter table public.email_campaign_recipients enable row level security;
alter table public.email_campaign_recipients force row level security;
revoke all on public.email_campaigns from public, anon, authenticated;
revoke all on public.email_campaign_recipients from public, anon, authenticated;

create or replace function public.create_email_campaign_revision(p_slug text, p_content jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_rev integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('email_campaign:' || coalesce(p_slug, ''), 0));
  -- List idzie w języku odbiorcy (Invariant #1): treść musi istnieć w każdym języku serwisu.
  if p_content is null or jsonb_typeof(p_content) <> 'object'
     or exists (select 1 from public.supported_locales l where not (p_content ? l.code))
     or exists (select 1 from jsonb_object_keys(p_content) k where not coalesce(public.is_supported_locale(k), false)) then
    raise exception 'VALIDATION_FAILED: kampania' using errcode = '22023';
  end if;
  select coalesce(max(revision), 0) + 1 into v_rev from public.email_campaigns where slug = p_slug;
  insert into public.email_campaigns (slug, revision, content)
  values (p_slug, v_rev, p_content)
  returning id into v_id;
  return v_id;
exception when check_violation or not_null_violation then
  raise exception 'VALIDATION_FAILED: kampania' using errcode = '22023';
end $$;
revoke all on function public.create_email_campaign_revision(text, jsonb) from public;
grant execute on function public.create_email_campaign_revision(text, jsonb) to service_role;

-- Aktywuje rewizję: poprzednie rewizje tego sluga → superseded, ich niewysłane listy
-- (niezadzierżawione) są wygaszane, a odbiorcy → cancelled. Starsza rewizja niż już
-- użyta nigdy nie wraca (STALE_STATE).
create or replace function public.activate_email_campaign(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.email_campaigns;
begin
  select * into v_row from public.email_campaigns where id = p_campaign_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('email_campaign:' || v_row.slug, 0));
  select * into v_row from public.email_campaigns where id = p_campaign_id for update;
  if v_row.status = 'active' then return; end if;
  if v_row.status <> 'draft' then
    raise exception 'STALE_STATE: rewizja nie jest szkicem' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.email_campaigns c
              where c.slug = v_row.slug and c.revision > v_row.revision
                and c.status <> 'draft') then
    raise exception 'STALE_STATE: istnieje nowsza rewizja' using errcode = 'P0001';
  end if;

  with old as (
    update public.email_campaigns c
       set status = 'superseded', closed_at = now()
     where c.slug = v_row.slug and c.id <> v_row.id and c.status in ('draft', 'active', 'completed')
    returning c.id
  )
  update public.email_deliveries d
     set status = 'failed', suppressed_at = now(), error_message = 'suppressed_campaign_inactive',
         updated_at = now()
   where d.campaign_id in (select id from old)
     and d.status = 'queued'
     and (d.locked_at is null or d.locked_at < now() - interval '300 seconds');

  update public.email_campaigns set status = 'active', activated_at = now() where id = v_row.id;
end $$;
revoke all on function public.activate_email_campaign(uuid) from public;
grant execute on function public.activate_email_campaign(uuid) to service_role;

create or replace function public.cancel_email_campaign(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.email_campaigns
     set status = 'cancelled', closed_at = now()
   where id = p_campaign_id and status in ('draft', 'active', 'completed');
  if not found then
    if not exists (select 1 from public.email_campaigns where id = p_campaign_id) then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    return;
  end if;
  update public.email_deliveries d
     set status = 'failed', suppressed_at = now(), error_message = 'suppressed_campaign_inactive',
         updated_at = now()
   where d.campaign_id = p_campaign_id
     and d.status = 'queued'
     and (d.locked_at is null or d.locked_at < now() - interval '300 seconds');
end $$;
revoke all on function public.cancel_email_campaign(uuid) from public;
grant execute on function public.cancel_email_campaign(uuid) to service_role;

-- Rezerwacja i kolejkowanie paczki odbiorców aktywnej rewizji. Rezerwacja (INSERT … ON
-- CONFLICT DO NOTHING na PK rewizja + odbiorca) poprzedza kolejkowanie, więc restart
-- harmonogramu, równoległe wywołania i ponowienie po timeoucie nie tworzą drugiego listu.
-- Odbiorcy, którzy dostali albo mają w drodze list z wcześniejszej rewizji tego sluga, nie
-- są rezerwowani ponownie. Zgoda jest sprawdzana teraz, dla tej rewizji.
create or replace function public.enqueue_campaign_batch(p_campaign_id uuid, p_limit integer default 500)
returns table (reserved integer, queued integer, skipped integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_c public.email_campaigns;
  v_pid uuid;
  v_ok uuid;
  v_res record;
  v_locale text;
  v_reserved integer := 0;
  v_queued integer := 0;
  v_skipped integer := 0;
begin
  select * into v_c from public.email_campaigns where id = p_campaign_id for share;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_c.status <> 'active' then
    return query select 0, 0, 0;
    return;
  end if;

  for v_pid in
    select np.profile_id
      from public.notification_preferences np
     where np.email_marketing
       and not exists (select 1 from public.email_campaign_recipients r
                        where r.campaign_id = v_c.id and r.profile_id = np.profile_id)
       and not exists (select 1 from public.email_campaign_recipients r
                         join public.email_campaigns c on c.id = r.campaign_id
                        where r.profile_id = np.profile_id and c.slug = v_c.slug
                          and c.revision < v_c.revision
                          and r.status in ('queued', 'accepted', 'delivered'))
     order by np.profile_id
     limit greatest(least(coalesce(p_limit, 500), 5000), 0)
  loop
    v_ok := null;
    insert into public.email_campaign_recipients (campaign_id, profile_id, status)
    values (v_c.id, v_pid, 'reserved')
    on conflict (campaign_id, profile_id) do nothing
    returning profile_id into v_ok;
    if v_ok is null then continue; end if;  -- inny harmonogram zarezerwował pierwszy
    v_reserved := v_reserved + 1;

    v_locale := public.resolve_recipient_locale(v_pid);
    select * into v_res from public.enqueue_email_outcome(
      v_pid, v_c.template, 'email_campaign', v_c.id,
      'campaign:' || v_c.id || ':' || v_pid,
      jsonb_build_object('campaignId', v_c.id, 'jobs', v_c.content -> v_locale -> 'jobs'),
      v_c.id);

    if v_res.outcome in ('queued', 'duplicate') then
      update public.email_campaign_recipients
         set status = 'queued', delivery_id = v_res.delivery_id, updated_at = now()
       where campaign_id = v_c.id and profile_id = v_pid and status = 'reserved';
      v_queued := v_queued + 1;
    else
      update public.email_campaign_recipients
         set status = case when v_res.outcome = 'opted_out' then 'skipped_consent' else 'failed' end,
             reason = v_res.outcome, delivery_id = v_res.delivery_id, updated_at = now()
       where campaign_id = v_c.id and profile_id = v_pid and status = 'reserved';
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  if v_reserved = 0 then
    -- Wszyscy odbiorcy z chwili wysyłki zarezerwowani: kampania zakończona (nowe zgody
    -- nie dostaną starej edycji). Zakolejkowane listy nadal wychodzą.
    update public.email_campaigns set status = 'completed', closed_at = now()
     where id = v_c.id and status = 'active';
  end if;
  return query select v_reserved, v_queued, v_skipped;
end $$;
revoke all on function public.enqueue_campaign_batch(uuid, integer) from public;
grant execute on function public.enqueue_campaign_batch(uuid, integer) to service_role;

-- Harmonogram (/api/maintenance): po jednej paczce każdej aktywnej kampanii.
create or replace function public.process_email_campaigns(p_limit integer default 500)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_total integer := 0; v_q integer;
begin
  for v_id in select id from public.email_campaigns where status = 'active' order by activated_at loop
    select b.queued into v_q from public.enqueue_campaign_batch(v_id, p_limit) b;
    v_total := v_total + coalesce(v_q, 0);
  end loop;
  return v_total;
end $$;
revoke all on function public.process_email_campaigns(integer) from public;
grant execute on function public.process_email_campaigns(integer) to service_role;

-- Status odbiorcy kampanii idzie za statusem wysyłki (bez treści i bez adresu).
create or replace function public.sync_email_campaign_recipient()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text; v_reason text;
begin
  if new.campaign_id is null or new.status is not distinct from old.status then return null; end if;
  if new.status in ('sent') then
    v_status := 'accepted';
  elsif new.status in ('delivered', 'opened', 'clicked') then
    v_status := 'delivered';
  elsif new.status = 'complained' then
    v_status := 'delivered'; v_reason := 'complained';
  elsif new.status = 'bounced' then
    v_status := 'failed'; v_reason := 'bounced';
  elsif new.status = 'failed' then
    case new.error_message
      when 'suppressed_opt_out' then v_status := 'skipped_consent'; v_reason := 'opted_out';
      when 'suppressed_address' then v_status := 'failed'; v_reason := 'suppressed_address';
      when 'suppressed_recipient_budget' then v_status := 'failed'; v_reason := 'recipient_budget';
      when 'suppressed_campaign_inactive' then
        v_status := 'cancelled';
        v_reason := case when exists (select 1 from public.email_campaigns c
                                        where c.id = new.campaign_id and c.status = 'cancelled')
                         then 'cancelled' else 'superseded' end;
      else v_status := 'failed'; v_reason := 'send_failed';
    end case;
  else
    return null;
  end if;

  update public.email_campaign_recipients r
     set status = v_status, reason = v_reason, updated_at = now()
   where r.delivery_id = new.id
     and r.status is distinct from v_status;
  return null;
end $$;
revoke all on function public.sync_email_campaign_recipient() from public;

drop trigger if exists email_deliveries_campaign_sync on public.email_deliveries;
create trigger email_deliveries_campaign_sync
  after update of status on public.email_deliveries
  for each row execute function public.sync_email_campaign_recipient();

-- --- 7. claim_email_batch (0098) — także nieaktywna rewizja kampanii -------------------
create or replace function public.claim_email_batch(
  p_limit integer default 20,
  p_lease_seconds integer default 300
) returns setof public.email_deliveries language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with picked as (
    select e.id,
           public.email_allowed(e.profile_id, e.template) as allowed,
           public.email_address_suppressed(e.to_email::text) as blocked,
           (e.campaign_id is not null and not exists (
              select 1 from public.email_campaigns c
               where c.id = e.campaign_id and c.status in ('active', 'completed'))) as stale
      from public.email_deliveries e
     where e.status = 'queued'
       and e.next_attempt_at <= now()
       and (e.locked_at is null or e.locked_at < now() - make_interval(secs => p_lease_seconds))
     order by e.queued_at asc
     for update skip locked
     limit greatest(p_limit, 0)
  ), suppressed as (
    -- Odbiorca wypisał się, adres dostał blokadę albo rewizja kampanii nie jest już
    -- aktywna: wiersz zostaje (ślad), ale nie wychodzi.
    update public.email_deliveries d
       set status = 'failed', suppressed_at = now(),
           error_message = case
             when p.blocked then 'suppressed_address'
             when p.allowed is not true then 'suppressed_opt_out'
             else 'suppressed_campaign_inactive' end,
           locked_at = null, updated_at = now()
      from picked p
     where d.id = p.id and (p.allowed is not true or p.blocked or p.stale)
    returning d.id
  )
  update public.email_deliveries d
     set locked_at = now(), updated_at = now()
    from picked p
   where d.id = p.id and p.allowed is true and not p.blocked and not p.stale
  returning d.*;
end $$;
