-- =============================================================================
-- 0114_ai_budget.sql — #36: globalny budżet kosztów funkcji AI (dzienny i miesięczny).
--
-- Numer migracji tymczasowy — ostateczny nada koordynator.
--
-- 1. ai_budget_limits — limity globalne w mikro-USD (1 USD = 1 000 000) na dobę i miesiąc
--    kalendarzowy w strefie Europe/Brussels. Wartości startowe są zachowawcze (10 USD/dobę,
--    100 USD/miesiąc); limit 0 = wyłącznik (każda rezerwacja odrzucona). Zmiana wyłącznie
--    przez właściciela bazy / service_role (UPDATE wiersza), bez UI.
-- 2. ai_usage_ledger — jeden wiersz na wywołanie modelu: funkcja z inwentarza
--    (src/lib/ai/inventory.ts), model, wynik (enum), tokeny, koszt, doba. BEZ treści, promptu,
--    odpowiedzi, adresu, identyfikatora osoby i firmy — to liczniki, nie dziennik zdarzeń.
-- 3. ai_budget_reserve — rezerwacja PRZED wywołaniem API: pod blokadą doradczą sumuje
--    wydatki doby i miesiąca (rozliczone = koszt rzeczywisty, nierozliczone = kwota
--    rezerwacji) i odrzuca rezerwację, która przekroczyłaby którykolwiek limit
--    (AI_BUDGET_EXCEEDED). Brak limitu = odmowa (AI_BUDGET_UNCONFIGURED) — fail-closed.
-- 4. ai_budget_settle — rozliczenie po wywołaniu (idempotentne). Nieznany koszt = kwota
--    rezerwacji (zachowawczo). Rezerwacja nigdy nierozliczona liczy się dalej w całości.
-- 5. ai_budget_status (monitoring: pracujbe_ops + service_role) — same liczby dla
--    /api/health/ops. ai_cost_report (service_role) — raport dla panelu admina.
--
-- Dostęp: RLS włączone i wymuszone, bez polityk; anon/authenticated bez grantów na tabele
-- i funkcje. Aplikacja woła RPC z puli service-role (src/lib/ai/budget.ts), panel admina
-- po potwierdzeniu roli (src/lib/data/admin-ai-costs.ts).
--
-- Rollback: drop funkcji ai_cost_report, ai_budget_status, ai_budget_settle,
-- ai_budget_reserve, ai_budget_spent; drop tabel ai_usage_ledger, ai_budget_limits.
-- Migracja nie zmienia istniejących danych.
-- =============================================================================

-- --- 1. Limity -----------------------------------------------------------------------
create table if not exists public.ai_budget_limits (
  period           text primary key,
  limit_micro_usd  bigint not null,
  updated_at       timestamptz not null default now(),
  constraint ai_budget_limits_period check (period in ('day', 'month')),
  constraint ai_budget_limits_value check (limit_micro_usd >= 0 and limit_micro_usd <= 100000000000)
);

insert into public.ai_budget_limits (period, limit_micro_usd) values
  ('day', 10000000),
  ('month', 100000000)
on conflict (period) do nothing;

alter table public.ai_budget_limits enable row level security;
alter table public.ai_budget_limits force row level security;
revoke all on public.ai_budget_limits from public, anon, authenticated;
grant select, update on public.ai_budget_limits to service_role;

-- --- 2. Rejestr wywołań -------------------------------------------------------------
create table if not exists public.ai_usage_ledger (
  id                  uuid primary key default gen_random_uuid(),
  feature             text not null,
  model               text not null,
  status              text not null default 'reserved',
  outcome             text,
  reserved_micro_usd  bigint not null,
  cost_micro_usd      bigint,
  input_tokens        integer,
  output_tokens       integer,
  usage_day           date not null,
  created_at          timestamptz not null default now(),
  settled_at          timestamptz,
  constraint ai_usage_ledger_feature check (feature in ('job_listing_import', 'content_translation', 'job_offer_assist')),
  constraint ai_usage_ledger_model check (model ~ '^[a-z0-9][a-z0-9.-]{2,63}$'),
  constraint ai_usage_ledger_status check (status in ('reserved', 'settled')),
  constraint ai_usage_ledger_outcome check (
    outcome is null or outcome in ('ok', 'refused', 'failed', 'rate_limited', 'rejected_input')),
  constraint ai_usage_ledger_amounts check (
    reserved_micro_usd > 0 and (cost_micro_usd is null or cost_micro_usd >= 0)
    and (input_tokens is null or input_tokens >= 0) and (output_tokens is null or output_tokens >= 0)),
  constraint ai_usage_ledger_settled check (
    (status = 'reserved' and settled_at is null and outcome is null and cost_micro_usd is null)
    or (status = 'settled' and settled_at is not null and outcome is not null and cost_micro_usd is not null))
);

create index if not exists idx_ai_usage_ledger_day on public.ai_usage_ledger (usage_day);
create index if not exists idx_ai_usage_ledger_open on public.ai_usage_ledger (created_at)
  where status = 'reserved';

alter table public.ai_usage_ledger enable row level security;
alter table public.ai_usage_ledger force row level security;
revoke all on public.ai_usage_ledger from public, anon, authenticated;
grant select on public.ai_usage_ledger to service_role;

-- Doba budżetu = dzień kalendarzowy w Brukseli (jak reszta raportów panelu).
create or replace function public.ai_budget_day(p_at timestamptz default now())
returns date
language sql
stable
set search_path = public, pg_temp
as $$ select (p_at at time zone 'Europe/Brussels')::date $$;

revoke all on function public.ai_budget_day(timestamptz) from public, anon, authenticated;

-- Wydatek od dnia p_from (włącznie): rozliczone = koszt, otwarte rezerwacje = kwota rezerwacji.
create or replace function public.ai_budget_spent(p_from date, p_to date)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(case when status = 'settled' then cost_micro_usd else reserved_micro_usd end), 0)::bigint
    from public.ai_usage_ledger
   where usage_day >= p_from and usage_day <= p_to
$$;

revoke all on function public.ai_budget_spent(date, date) from public, anon, authenticated;

-- --- 3. Rezerwacja -------------------------------------------------------------------
create or replace function public.ai_budget_reserve(
  p_feature text,
  p_model text,
  p_estimate_micro_usd bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := public.ai_budget_day();
  v_month date := date_trunc('month', v_day)::date;
  v_day_limit bigint;
  v_month_limit bigint;
  v_id uuid;
begin
  if p_feature is null or p_feature not in ('job_listing_import', 'content_translation', 'job_offer_assist') then
    raise exception 'VALIDATION_FAILED: feature' using errcode = '22023';
  end if;
  if p_model is null or p_model !~ '^[a-z0-9][a-z0-9.-]{2,63}$' then
    raise exception 'VALIDATION_FAILED: model' using errcode = '22023';
  end if;
  -- Szacunek musi być dodatni: rezerwacja zerowa nie chroniłaby budżetu.
  if p_estimate_micro_usd is null or p_estimate_micro_usd <= 0 or p_estimate_micro_usd > 100000000 then
    raise exception 'VALIDATION_FAILED: estimate' using errcode = '22023';
  end if;

  -- Jedna rezerwacja naraz: równoległe wywołania nie przekroczą limitu wspólnie.
  perform pg_advisory_xact_lock(hashtext('pracujbe.ai_budget'));

  select limit_micro_usd into v_day_limit from public.ai_budget_limits where period = 'day';
  select limit_micro_usd into v_month_limit from public.ai_budget_limits where period = 'month';
  if v_day_limit is null or v_month_limit is null then
    raise exception 'AI_BUDGET_UNCONFIGURED' using errcode = 'P0001';
  end if;

  if public.ai_budget_spent(v_day, v_day) + p_estimate_micro_usd > v_day_limit
     or public.ai_budget_spent(v_month, v_day) + p_estimate_micro_usd > v_month_limit then
    raise exception 'AI_BUDGET_EXCEEDED' using errcode = 'P0001';
  end if;

  insert into public.ai_usage_ledger (feature, model, reserved_micro_usd, usage_day)
  values (p_feature, p_model, p_estimate_micro_usd, v_day)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.ai_budget_reserve(text, text, bigint) from public, anon, authenticated;
grant execute on function public.ai_budget_reserve(text, text, bigint) to service_role;

-- --- 4. Rozliczenie ------------------------------------------------------------------
create or replace function public.ai_budget_settle(
  p_id uuid,
  p_outcome text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cost_micro_usd bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  if p_outcome is null or p_outcome not in ('ok', 'refused', 'failed', 'rate_limited', 'rejected_input') then
    raise exception 'VALIDATION_FAILED: outcome' using errcode = '22023';
  end if;
  if (p_cost_micro_usd is not null and p_cost_micro_usd < 0)
     or (p_input_tokens is not null and p_input_tokens < 0)
     or (p_output_tokens is not null and p_output_tokens < 0) then
    raise exception 'VALIDATION_FAILED: usage' using errcode = '22023';
  end if;

  update public.ai_usage_ledger
     set status = 'settled',
         outcome = p_outcome,
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         -- Nieznany koszt (np. przerwane połączenie) = kwota rezerwacji — zachowawczo.
         cost_micro_usd = coalesce(p_cost_micro_usd, reserved_micro_usd),
         settled_at = now()
   where id = p_id and status = 'reserved';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.ai_budget_settle(uuid, text, integer, integer, bigint) from public, anon, authenticated;
grant execute on function public.ai_budget_settle(uuid, text, integer, integer, bigint) to service_role;

-- --- 5a. Stan dla monitoringu --------------------------------------------------------
create or replace function public.ai_budget_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with d as (select public.ai_budget_day() as day)
  select jsonb_build_object(
    'day', jsonb_build_object(
      'spentMicroUsd', public.ai_budget_spent(d.day, d.day),
      'limitMicroUsd', (select limit_micro_usd from public.ai_budget_limits where period = 'day')),
    'month', jsonb_build_object(
      'spentMicroUsd', public.ai_budget_spent(date_trunc('month', d.day)::date, d.day),
      'limitMicroUsd', (select limit_micro_usd from public.ai_budget_limits where period = 'month')),
    'staleReservations', (select count(*) from public.ai_usage_ledger
                           where status = 'reserved' and created_at < now() - interval '15 minutes'))
  from d
$$;

revoke all on function public.ai_budget_status() from public, anon, authenticated;
grant execute on function public.ai_budget_status() to pracujbe_ops, service_role;

-- --- 5b. Raport dla panelu admina ----------------------------------------------------
create or replace function public.ai_cost_report(p_days integer default 31)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with params as (
    select public.ai_budget_day() as today,
           least(greatest(coalesce(p_days, 31), 1), 93) as days
  ),
  charged as (
    select l.usage_day, l.feature, l.status, l.outcome, l.input_tokens, l.output_tokens,
           case when l.status = 'settled' then l.cost_micro_usd else l.reserved_micro_usd end as cost
      from public.ai_usage_ledger l, params p
     where l.usage_day > p.today - p.days
  ),
  daily as (
    select usage_day, feature,
           count(*) as calls,
           count(*) filter (where outcome = 'ok') as ok,
           count(*) filter (where status = 'settled' and outcome <> 'ok') as not_ok,
           count(*) filter (where status = 'reserved') as open,
           coalesce(sum(input_tokens), 0) as input_tokens,
           coalesce(sum(output_tokens), 0) as output_tokens,
           coalesce(sum(cost), 0) as cost
      from charged
     group by usage_day, feature
  ),
  monthly as (
    select date_trunc('month', l.usage_day)::date as month,
           count(*) as calls,
           coalesce(sum(case when l.status = 'settled' then l.cost_micro_usd else l.reserved_micro_usd end), 0) as cost
      from public.ai_usage_ledger l, params p
     where l.usage_day >= (date_trunc('month', p.today) - interval '11 months')::date
     group by 1
  )
  select jsonb_build_object(
    'status', public.ai_budget_status(),
    'days', (select days from params),
    'daily', coalesce((select jsonb_agg(jsonb_build_object(
        'day', usage_day, 'feature', feature, 'calls', calls, 'ok', ok, 'notOk', not_ok, 'open', open,
        'inputTokens', input_tokens, 'outputTokens', output_tokens, 'costMicroUsd', cost)
        order by usage_day desc, feature) from daily), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('month', month, 'calls', calls, 'costMicroUsd', cost)
        order by month desc) from monthly), '[]'::jsonb))
$$;

revoke all on function public.ai_cost_report(integer) from public, anon, authenticated;
grant execute on function public.ai_cost_report(integer) to service_role;
