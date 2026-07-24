-- =============================================================================
-- 0045_discount_redemptions.sql
-- Remediacja audytu produkcyjnego 2026-07-24 — P1-15: bezpieczna realizacja kodów rabatowych.
--
-- Problem: applyDiscount tylko WALIDOWAŁ kod (nie rezerwował ani nie liczył wykorzystania),
-- brak unikatu per firma → ten sam kod działał równolegle i wielokrotnie; nieprawidłowy kod
-- był cicho ignorowany (checkout pełnopłatny mimo „rabatu").
--
-- Naprawa: tabela realizacji z unikatem (kod, firma) + atomowe RPC:
--  - reserve_discount  — rezerwuje (FOR UPDATE na kodzie, limit reserved+finalized, per-firma
--                        unikat, idempotentny retry dla tej samej firmy) i zwraca zniżkę;
--  - finalize_discount — po opłaceniu (webhook) oznacza 'finalized' + inkrementuje times_redeemed;
--  - release_stale_discount_reservations — GC porzuconych rezerwacji (zwalnia limit).
-- Tabela dostępna wyłącznie service_role/RPC (klient nie liczy sobie rabatów).
-- =============================================================================

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

-- --- reserve_discount: atomowa rezerwacja (limit + per-firma unikat + idempotentny retry) ---
create or replace function public.reserve_discount(p_code text, p_company_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
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
returns void language plpgsql security definer set search_path = public as $$
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
returns integer language plpgsql security definer set search_path = public as $$
declare v_released integer;
begin
  update public.discount_redemptions set status = 'released', updated_at = now()
    where status = 'reserved' and created_at < now() - make_interval(hours => greatest(p_older_than_hours, 1));
  get diagnostics v_released = row_count;
  return v_released;
end $$;
revoke all on function public.release_stale_discount_reservations(integer) from public;
grant execute on function public.release_stale_discount_reservations(integer) to service_role;
