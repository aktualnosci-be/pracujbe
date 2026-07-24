-- =============================================================================
-- 0053_webhook_lease.sql
-- Remediacja audytu 2026-07-24 (AUDIT_REPORT) — P2-06: inbox webhooków dopuszcza współbieżne
-- przetwarzanie tego samego zdarzenia.
--
-- Problem: przy konflikcie na wpisie 'processing' claimWebhook zwracał 'claimed' dla KAŻDEGO
-- wołającego → dwie równoległe dostawy tego samego eventu wykonywały skutki uboczne dwukrotnie
-- (na ścieżkach bez twardych unique constraints). Brak modelu lease/ownership.
--
-- Naprawa: dzierżawa (lease) z `locked_until` + atomowy claim w JEDNEJ funkcji (FOR UPDATE):
--   - 'duplicate' → wpis 'completed' (pomiń),
--   - 'locked'    → inny worker trzyma świeżą dzierżawę (pomiń — bez podwójnych skutków),
--   - 'claimed'   → nowy event LUB dzierżawa wygasła (bezpieczny reprocessing).
-- complete_webhook zwraca, czy oznaczył wpis (wołający traktuje błąd/false jako powód do 500).
-- Dostęp wyłącznie service_role (jak cała tabela).
-- =============================================================================

alter table public.processed_webhooks
  add column if not exists locked_until timestamptz,
  add column if not exists attempts     integer not null default 0;

-- --- claim_webhook: atomowa dzierżawa --------------------------------------------------------
create or replace function public.claim_webhook(
  p_id text, p_source text, p_lock_seconds integer default 300
) returns text language plpgsql security definer set search_path = public as $$
declare v_status text; v_locked timestamptz; v_lock interval := make_interval(secs => greatest(coalesce(p_lock_seconds, 300), 1));
begin
  -- Szybka ścieżka: nowy event (brak wiersza) → wstaw z dzierżawą.
  insert into public.processed_webhooks (id, source, status, locked_until, attempts)
    values (p_id, p_source, 'processing', now() + v_lock, 1)
  on conflict (id) do nothing;
  if found then return 'claimed'; end if;

  -- Istniejący wiersz: zablokuj i oceń stan pod blokadą (serializacja współbieżnych dostaw).
  select status, locked_until into v_status, v_locked
    from public.processed_webhooks where id = p_id for update;
  if v_status = 'completed' then return 'duplicate'; end if;
  if v_locked is not null and v_locked > now() then return 'locked'; end if;

  -- Dzierżawa wygasła / nieustawiona → przejmij (reprocessing po awarii).
  update public.processed_webhooks
    set status = 'processing', locked_until = now() + v_lock,
        attempts = attempts + 1, updated_at = now()
    where id = p_id;
  return 'claimed';
end $$;
revoke all on function public.claim_webhook(text, text, integer) from public;
grant execute on function public.claim_webhook(text, text, integer) to service_role;

-- --- complete_webhook: oznacz zakończone (zwraca czy istniał wiersz) --------------------------
create or replace function public.complete_webhook(p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update public.processed_webhooks
    set status = 'completed', locked_until = null, updated_at = now()
    where id = p_id;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.complete_webhook(text) from public;
grant execute on function public.complete_webhook(text) to service_role;
