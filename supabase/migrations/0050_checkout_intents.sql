-- =============================================================================
-- 0050_checkout_intents.sql
-- Remediacja audytu 2026-07-24 (AUDIT_REPORT) — P0-02: współbieżne checkouty mogą utworzyć wiele
-- subskrypcji. Blokada drugiego zakupu sprawdzała wyłącznie lokalny rekord `subscriptions`
-- (status active/trialing), który powstaje DOPIERO po webhooku — dwa równoległe żądania widziały
-- brak subskrypcji i tworzyły po sesji Stripe → dwa obciążenia.
--
-- Naprawa: serwerowy stan „otwartego checkoutu" per firma, serializowany w BAZIE:
--  - tabela checkout_intents z PARTIAL UNIQUE (company_id) WHERE status='pending' — najwyżej
--    JEDEN otwarty checkout na firmę (drugi równoległy insert dostaje unique_violation);
--  - begin_checkout — advisory lock per firma + kontrola aktywnej subskrypcji + wstawienie
--    'pending'; zwraca intent_id (stabilny klucz idempotencji dla Stripe). Konflikt →
--    CHECKOUT_IN_PROGRESS;
--  - complete_checkout — webhook oznacza 'completed' (idempotentnie);
--  - release_checkout_intent — zwolnienie po błędzie API Stripe (natychmiastowy retry możliwy);
--  - release_stale_checkout_intents — GC porzuconych (nieukończony checkout) po p_older_than_minutes.
-- Tabela dostępna wyłącznie service_role/RPC (klient nie zarządza checkoutami).
-- =============================================================================

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

-- --- begin_checkout: serializuje start checkoutu, zwraca stabilny intent_id ------------------
create or replace function public.begin_checkout(p_company_id uuid, p_plan text)
returns uuid language plpgsql security definer set search_path = public as $$
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
returns void language plpgsql security definer set search_path = public as $$
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
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.checkout_intents set status = 'released', updated_at = now()
    where id = p_intent_id and status = 'pending';
end $$;
revoke all on function public.release_checkout_intent(uuid) from public;
grant execute on function public.release_checkout_intent(uuid) to service_role;

-- --- GC: zwolnij porzucone otwarte checkouty (nieukończony flow) po p_older_than_minutes -----
create or replace function public.release_stale_checkout_intents(p_older_than_minutes integer default 30)
returns integer language plpgsql security definer set search_path = public as $$
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
