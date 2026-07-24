-- =============================================================================
-- 0036_processed_webhooks.sql
-- Remediacja audytu 2026-07-24 — SEC-14 (P2): trwała ochrona przed replayem webhooków.
-- Weryfikacja podpisu + świeżość znacznika czasu ograniczają okno replay, ale nie eliminują
-- ponownego przetworzenia w tym oknie. Tabela dedup po ID zdarzenia (Standard Webhooks
-- webhook-id / Stripe event.id) — pierwszy insert wygrywa, duplikat jest odrzucany (unique).
-- Dostęp wyłącznie service_role (webhook backendu); brak polityk = deny dla anon/authenticated.
-- =============================================================================

create table if not exists public.processed_webhooks (
  id      text primary key,
  source  text not null,
  seen_at timestamptz not null default now()
);

alter table public.processed_webhooks enable row level security;
revoke all on public.processed_webhooks from anon, authenticated;

-- Retencja: pomocnicza funkcja GC (stare wpisy dedup nie są już potrzebne). Wołana z crona.
create or replace function public.processed_webhooks_gc(p_older_than_days integer default 30)
returns integer language plpgsql security definer set search_path = public as $$
declare v_deleted integer;
begin
  delete from public.processed_webhooks
    where seen_at < now() - make_interval(days => greatest(p_older_than_days, 1));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;
revoke all on function public.processed_webhooks_gc(integer) from public;
