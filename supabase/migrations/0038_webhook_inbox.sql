-- =============================================================================
-- 0038_webhook_inbox.sql
-- Remediacja audytu produkcyjnego 2026-07-24 — P0-01/P0-02: inbox webhooków ze stanem.
--
-- Wcześniej `processed_webhooks` służyło wyłącznie jako marker „widziany" wstawiany PRZED
-- przetworzeniem. Skutek: awaria w trakcie przetwarzania → 500 → Stripe/GoTrue ponawia →
-- ponowienie widzi wpis dedup → 200 „duplicate" → ZDARZENIE UTRACONE NA ZAWSZE (płatność bez
-- aktywacji planu; e-mail potwierdzający/reset nigdy nie wysłany).
--
-- Naprawa: dodajemy `status` (processing|completed). Duplikatem (do pominięcia) jest WYŁĄCZNIE
-- wpis `completed`. Claim wstawia `processing`; dopiero po udanym przetworzeniu → `completed`.
-- Awaria przed `completed` pozostawia wpis w `processing`, więc ponowienie PRZETWARZA PONOWNIE
-- (zapisy Stripe są idempotentne po stabilnych ID; dla e-maili ponowna wysyłka jest znacznie
-- mniejszym złem niż trwała utrata — okno ponowień GoTrue jest krótkie).
--
-- Dostęp wyłącznie service_role (jak w 0036) — brak polityk = deny dla anon/authenticated.
-- =============================================================================

alter table public.processed_webhooks
  add column if not exists status     text        not null default 'processing',
  add column if not exists updated_at timestamptz not null default now();

alter table public.processed_webhooks
  drop constraint if exists processed_webhooks_status_check;
alter table public.processed_webhooks
  add constraint processed_webhooks_status_check
  check (status in ('processing', 'completed', 'failed'));

-- Rekordy sprzed migracji (gdyby istniały) traktujemy jako zakończone — były wstawiane po
-- (best-effort) przetworzeniu w poprzednim modelu; nie chcemy ich reprocesować.
update public.processed_webhooks set status = 'completed' where status = 'processing' and seen_at < now();
