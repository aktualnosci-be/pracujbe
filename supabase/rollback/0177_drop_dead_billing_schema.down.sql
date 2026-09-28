-- =============================================================================
-- Rollback 0177 (usunięcie martwego schematu billingu) — odtwarza schemat z definicji migracji
-- 0001 (typy), 0007 (tabele), 0008 (triggery updated_at), 0009 (RLS i polityki), 0022 (is_demo),
-- 0042 (companies.provider_customer_id), 0045, 0050 (rabaty i checkout), 0055 (company_plan)
-- oraz 0171 (ops_metrics). Tabele wracają PUSTE (danych nie było). Uruchamiać przed rollbackiem
-- migracji, które zależą od stanu po 0177 (kolejność odwrotna do nakładania).
-- =============================================================================

-- --- 1. Typy enum (0001) -------------------------------------------------------------------
do $$ begin
  create type subscription_status as enum (
    'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'expired'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('pending', 'succeeded', 'failed', 'refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invoice_status as enum ('draft', 'open', 'paid', 'void', 'uncollectible');
exception when duplicate_object then null; end $$;

-- --- 2. Kolumna klienta płatności na firmie (0042) -----------------------------------------
alter table public.companies add column if not exists provider_customer_id text;
create index if not exists idx_companies_provider_customer
  on public.companies (provider_customer_id) where provider_customer_id is not null;

-- --- 3. Tabele billingu (0007) -------------------------------------------------------------
-- --- discount_codes ---------------------------------------------------------
create table if not exists discount_codes (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  description      text,
  percent_off      integer check (percent_off >= 0 and percent_off <= 100),
  amount_off_cents integer check (amount_off_cents >= 0),
  currency         text default 'EUR' check (currency is null or currency ~ '^[A-Z]{3}$'),
  max_redemptions  integer check (max_redemptions is null or max_redemptions >= 0),
  times_redeemed   integer not null default 0 check (times_redeemed >= 0),
  valid_from       timestamptz,
  valid_until      timestamptz,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_discount_codes_active on discount_codes(code) where is_active = true;

-- --- subscriptions: plany firm ---------------------------------------------
create table if not exists subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id) on delete cascade,
  plan                   text not null,
  status                 subscription_status not null default 'trialing',
  discount_code_id       uuid references discount_codes(id) on delete set null,
  provider               text,
  provider_customer_id   text,
  provider_subscription_id text,
  quantity               integer not null default 1 check (quantity >= 0),
  trial_ends_at          timestamptz,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at              timestamptz,
  canceled_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

create index if not exists idx_subscriptions_company on subscriptions(company_id);
create index if not exists idx_subscriptions_status on subscriptions(status);
create unique index if not exists uq_subscriptions_provider_id
  on subscriptions(provider_subscription_id) where provider_subscription_id is not null;

-- --- invoices ---------------------------------------------------------------
create table if not exists invoices (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  number        text unique,
  status        invoice_status not null default 'draft',
  amount_cents  integer not null default 0 check (amount_cents >= 0),
  tax_cents     integer not null default 0 check (tax_cents >= 0),
  currency      text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  pdf_file_id   uuid references files(id) on delete set null,
  issued_at     timestamptz,
  due_at        timestamptz,
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_invoices_company on invoices(company_id);
create index if not exists idx_invoices_subscription on invoices(subscription_id);
create index if not exists idx_invoices_status on invoices(status);

-- --- payments ---------------------------------------------------------------
create table if not exists payments (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  subscription_id    uuid references subscriptions(id) on delete set null,
  invoice_id         uuid references invoices(id) on delete set null,
  status             payment_status not null default 'pending',
  amount_cents       integer not null default 0 check (amount_cents >= 0),
  currency           text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  provider           text,
  provider_payment_id text,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_payments_company on payments(company_id);
create index if not exists idx_payments_invoice on payments(invoice_id);
create index if not exists idx_payments_status on payments(status);
create unique index if not exists uq_payments_provider_id
  on payments(provider_payment_id) where provider_payment_id is not null;


-- is_demo (0022)
alter table public.subscriptions add column if not exists is_demo boolean not null default false;
alter table public.invoices      add column if not exists is_demo boolean not null default false;
alter table public.payments      add column if not exists is_demo boolean not null default false;

-- Realizacje kodów rabatowych (0045) i otwarte checkouty (0050).
create table if not exists public.discount_redemptions (
  id               uuid primary key default gen_random_uuid(),
  discount_code_id uuid not null references public.discount_codes(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete cascade,
  session_id       text,
  status           text not null default 'reserved'
                     check (status in ('reserved', 'finalized', 'released')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (discount_code_id, company_id)
);

alter table public.discount_redemptions enable row level security;
revoke all on public.discount_redemptions from anon, authenticated; -- brak polityk = deny; RPC pisze

create table if not exists public.checkout_intents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  plan        text not null,
  status      text not null default 'pending'
                check (status in ('pending', 'completed', 'released')),
  session_id  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Najwyżej jeden OTWARTY checkout na firmę (rdzeń serializacji współbieżnych żądań).
create unique index if not exists checkout_intents_one_pending_per_company
  on public.checkout_intents (company_id) where status = 'pending';
create index if not exists checkout_intents_company_idx on public.checkout_intents (company_id);

alter table public.checkout_intents enable row level security;
revoke all on public.checkout_intents from anon, authenticated; -- brak polityk = deny; RPC pisze


-- --- 4. Trigger updated_at (0008) i RLS (0009) -----------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['discount_codes', 'subscriptions', 'invoices', 'payments'] loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I;', t);
    execute format(
      'create trigger trg_set_updated_at before update on public.%I
         for each row execute function public.set_updated_at();',
      t
    );
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

revoke all on table public.discount_codes from anon, authenticated;

drop policy if exists subscriptions_select_admin on public.subscriptions;
create policy subscriptions_select_admin on public.subscriptions
  for select to authenticated
  using (public.is_company_admin(company_id));

drop policy if exists invoices_select_admin on public.invoices;
create policy invoices_select_admin on public.invoices
  for select to authenticated
  using (public.is_company_admin(company_id));

drop policy if exists payments_select_admin on public.payments;
create policy payments_select_admin on public.payments
  for select to authenticated
  using (public.is_company_admin(company_id));

-- --- 5. RPC rabatów (0045) i checkoutu (0050) --------------------------------------------------
-- --- reserve_discount: atomowa rezerwacja (limit + per-firma unikat + idempotentny retry) ---
create or replace function public.reserve_discount(p_code text, p_company_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code public.discount_codes%rowtype; v_existing text; v_used integer;
begin
  if p_company_id is null then raise exception 'VALIDATION_FAILED' using errcode = '42501'; end if;

  -- Blokada wiersza kodu — serializuje liczenie limitu (koniec równoległego przekroczenia).
  select * into v_code from public.discount_codes where upper(code) = upper(btrim(p_code)) for update;
  if not found or not v_code.is_active then raise exception 'NOT_FOUND: kod nieprawidłowy' using errcode = 'P0002'; end if;
  if v_code.valid_from is not null and now() < v_code.valid_from then
    raise exception 'NOT_FOUND: kod nieaktywny' using errcode = 'P0002'; end if;
  if v_code.valid_until is not null and now() > v_code.valid_until then
    raise exception 'NOT_FOUND: kod wygasł' using errcode = 'P0002'; end if;
  if coalesce(v_code.percent_off, 0) <= 0 and coalesce(v_code.amount_off_cents, 0) <= 0 then
    raise exception 'NOT_FOUND: kod bez zniżki' using errcode = 'P0002'; end if;

  -- Stan realizacji tej firmy: finalized → już użyty; reserved → idempotentny retry.
  select status into v_existing from public.discount_redemptions
    where discount_code_id = v_code.id and company_id = p_company_id;
  if v_existing = 'finalized' then
    raise exception 'VALIDATION_FAILED: kod już zrealizowany przez tę firmę' using errcode = '42501';
  elsif v_existing = 'reserved' then
    return jsonb_build_object('percent_off', v_code.percent_off, 'amount_off_cents',
                              v_code.amount_off_cents, 'currency', v_code.currency, 'code_id', v_code.id);
  end if;

  -- Limit globalny liczony z aktywnych realizacji (reserved+finalized).
  if v_code.max_redemptions is not null then
    select count(*) into v_used from public.discount_redemptions
      where discount_code_id = v_code.id and status in ('reserved', 'finalized');
    if v_used >= v_code.max_redemptions then
      raise exception 'VALIDATION_FAILED: limit wykorzystania kodu' using errcode = '42501';
    end if;
  end if;

  insert into public.discount_redemptions (discount_code_id, company_id, status)
    values (v_code.id, p_company_id, 'reserved');

  return jsonb_build_object('percent_off', v_code.percent_off, 'amount_off_cents',
                            v_code.amount_off_cents, 'currency', v_code.currency, 'code_id', v_code.id);
end $$;
revoke all on function public.reserve_discount(text, uuid) from public;
grant execute on function public.reserve_discount(text, uuid) to service_role;

-- --- finalize_discount: po opłaceniu (webhook) — 'finalized' + inkrementacja licznika ---
create or replace function public.finalize_discount(p_code_id uuid, p_company_id uuid, p_session_id text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_updated integer;
begin
  update public.discount_redemptions
    set status = 'finalized', session_id = coalesce(p_session_id, session_id), updated_at = now()
    where discount_code_id = p_code_id and company_id = p_company_id and status = 'reserved';
  get diagnostics v_updated = row_count;
  if v_updated > 0 then
    update public.discount_codes set times_redeemed = times_redeemed + 1, updated_at = now()
      where id = p_code_id;
  end if;
end $$;
revoke all on function public.finalize_discount(uuid, uuid, text) from public;
grant execute on function public.finalize_discount(uuid, uuid, text) to service_role;

-- --- GC: zwolnij porzucone rezerwacje (nieopłacony checkout) po p_older_than_hours ---
create or replace function public.release_stale_discount_reservations(p_older_than_hours integer default 24)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_released integer;
begin
  update public.discount_redemptions set status = 'released', updated_at = now()
    where status = 'reserved' and created_at < now() - make_interval(hours => greatest(p_older_than_hours, 1));
  get diagnostics v_released = row_count;
  return v_released;
end $$;
revoke all on function public.release_stale_discount_reservations(integer) from public;
grant execute on function public.release_stale_discount_reservations(integer) to service_role;

-- --- begin_checkout: serializuje start checkoutu, zwraca stabilny intent_id ------------------
create or replace function public.begin_checkout(p_company_id uuid, p_plan text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_intent_id uuid;
begin
  if p_company_id is null or coalesce(btrim(p_plan), '') = '' then
    raise exception 'VALIDATION_FAILED' using errcode = '42501';
  end if;

  -- Advisory lock per firma — serializuje read-then-insert (kontrola sub + wstawienie 'pending').
  perform pg_advisory_xact_lock(hashtext('checkout:' || p_company_id::text));

  -- Aktywna subskrypcja blokuje nowy checkout (spójnie z guardem aplikacji, ale pod blokadą).
  if exists (
    select 1 from public.subscriptions
    where company_id = p_company_id and status in ('active', 'trialing')
  ) then
    raise exception 'ACTIVE_SUBSCRIPTION: firma ma już aktywną subskrypcję' using errcode = '42501';
  end if;

  -- Najwyżej jeden otwarty checkout (partial unique). Współbieżny drugi → unique_violation.
  begin
    insert into public.checkout_intents (company_id, plan, status)
      values (p_company_id, p_plan, 'pending')
      returning id into v_intent_id;
  exception when unique_violation then
    raise exception 'CHECKOUT_IN_PROGRESS: otwarty checkout już istnieje' using errcode = '42501';
  end;

  return v_intent_id;
end $$;
revoke all on function public.begin_checkout(uuid, text) from public;
grant execute on function public.begin_checkout(uuid, text) to service_role;

-- --- complete_checkout: webhook oznacza ukończenie (idempotentnie) ---------------------------
create or replace function public.complete_checkout(p_intent_id uuid, p_session_id text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.checkout_intents
    set status = 'completed', session_id = coalesce(p_session_id, session_id), updated_at = now()
    where id = p_intent_id and status = 'pending';
  -- brak wiersza 'pending' → już ukończony/zwolniony: no-op (idempotencja przy reprocessingu webhooka).
end $$;
revoke all on function public.complete_checkout(uuid, text) from public;
grant execute on function public.complete_checkout(uuid, text) to service_role;

-- --- release_checkout_intent: zwolnij po błędzie API Stripe (natychmiastowy retry) -----------
create or replace function public.release_checkout_intent(p_intent_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.checkout_intents set status = 'released', updated_at = now()
    where id = p_intent_id and status = 'pending';
end $$;
revoke all on function public.release_checkout_intent(uuid) from public;
grant execute on function public.release_checkout_intent(uuid) to service_role;

-- --- GC: zwolnij porzucone otwarte checkouty (nieukończony flow) po p_older_than_minutes -----
create or replace function public.release_stale_checkout_intents(p_older_than_minutes integer default 30)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_released integer;
begin
  update public.checkout_intents set status = 'released', updated_at = now()
    where status = 'pending'
      and created_at < now() - make_interval(mins => greatest(p_older_than_minutes, 1));
  get diagnostics v_released = row_count;
  return v_released;
end $$;
revoke all on function public.release_stale_checkout_intents(integer) from public;
grant execute on function public.release_stale_checkout_intents(integer) to service_role;

-- --- 6. company_plan czytający subscriptions (0055) --------------------------------------------
create or replace function public.company_plan(p_company_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select s.plan from public.subscriptions s
       where s.company_id = p_company_id and s.status in ('active', 'trialing')
       order by s.created_at desc limit 1),
    'free'
  );
$$;
revoke all on function public.company_plan(uuid) from public;
grant execute on function public.company_plan(uuid) to authenticated, service_role;


-- --- 7. ops_metrics z licznikami checkoutu i rabatów (0171) ----------------------------------
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
    'storageDeletion', v_storage,
    -- #1143: sam tryb bazy (1 = RECRUITMENT); porównanie z env robi czujka w aplikacji.
    'portalLegalMode', jsonb_build_object(
      'recruitmentEnabled', case when public.recruitment_enabled() then 1 else 0 end)
  );
end $$;
revoke all on function public.ops_metrics() from public, anon, authenticated;
grant execute on function public.ops_metrics() to pracujbe_ops, service_role;
