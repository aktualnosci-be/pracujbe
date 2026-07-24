-- =============================================================================
-- 0022_is_demo_and_retention.sql
-- Domknięcie odłożonych ustaleń audytu:
--   P3#10 (Invariant #12) — kolumna is_demo na tabelach procesowych/komunikacyjnych/
--         płatniczych, aby dane DEMO były łatwe do odfiltrowania/usunięcia. Dane realne
--         (przez RPC/RLS) mają domyślnie is_demo=false; seed oznacza swoje wiersze true.
--   P3#16 — retencja/minimalizacja PII w email_deliveries: funkcja GC usuwająca stare,
--         zakończone dostawy (RODO — nie trzymamy adresów/treści bezterminowo).
-- =============================================================================

-- --- P3#10: is_demo (domyślnie false = dane realne) ----------------------------
alter table public.applications              add column if not exists is_demo boolean not null default false;
alter table public.offers                    add column if not exists is_demo boolean not null default false;
alter table public.matches                   add column if not exists is_demo boolean not null default false;
alter table public.saved_jobs                add column if not exists is_demo boolean not null default false;
alter table public.conversations             add column if not exists is_demo boolean not null default false;
alter table public.conversation_members      add column if not exists is_demo boolean not null default false;
alter table public.messages                  add column if not exists is_demo boolean not null default false;
alter table public.notifications             add column if not exists is_demo boolean not null default false;
alter table public.application_status_history add column if not exists is_demo boolean not null default false;
alter table public.offer_status_history      add column if not exists is_demo boolean not null default false;
alter table public.subscriptions             add column if not exists is_demo boolean not null default false;
alter table public.invoices                  add column if not exists is_demo boolean not null default false;
alter table public.payments                  add column if not exists is_demo boolean not null default false;

-- Częściowe indeksy pod szybkie filtrowanie/usuwanie danych demo (małe — tylko wiersze demo).
create index if not exists idx_applications_demo on public.applications(id) where is_demo;
create index if not exists idx_offers_demo on public.offers(id) where is_demo;

-- --- P3#16: retencja e-maili (RODO — minimalizacja PII) ------------------------
-- Usuwa zakończone dostawy starsze niż p_older_than_days (domyślnie 90). Zachowuje
-- 'queued' (do wysłania). Wołane przez cron/worker (route /api/email/process) — service_role.
create or replace function public.email_deliveries_gc(p_older_than_days integer default 90)
returns integer language plpgsql security definer set search_path = public as $$
declare v_deleted integer;
begin
  delete from public.email_deliveries
    where status in ('sent','delivered','opened','clicked','bounced','complained','failed')
      and coalesce(updated_at, created_at) < now() - make_interval(days => greatest(p_older_than_days, 0));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;
revoke all on function public.email_deliveries_gc(integer) from public;
-- Tylko zaufany serwer (service_role omija RLS). Brak grantu dla anon/authenticated.
