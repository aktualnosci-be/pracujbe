-- =============================================================================
-- 0980 — usunięcie martwego schematu billingu (płatności wyłączone w bezpłatnym MVP, #51;
-- decyzja właściciela 28.09.2026). NUMER TYMCZASOWY — ostateczny nada integrator.
--
-- Portal nie sprzedaje planów, nie przyjmuje płatności ani nie wystawia faktur, a billing nigdy
-- nie był włączony (brak danych produkcyjnych). Tabele i RPC po dawnym checkoucie Stripe były
-- martwym schematem bez żadnego przepływu.
--
-- Usuwane obiekty (jawnie, bez CASCADE):
--   * funkcje: reserve_discount(text, uuid), finalize_discount(uuid, uuid, text),
--     release_stale_discount_reservations(integer), begin_checkout(uuid, text),
--     complete_checkout(uuid, text), release_checkout_intent(uuid),
--     release_stale_checkout_intents(integer);
--   * tabele (w kolejności zależności, wraz z własnymi indeksami, triggerami updated_at,
--     politykami RLS i kolumnami is_demo): discount_redemptions, checkout_intents, payments,
--     invoices, subscriptions, discount_codes;
--   * kolumna companies.provider_customer_id i jej indeks idx_companies_provider_customer (0042);
--   * typy enum subscription_status, payment_status, invoice_status (0001).
--
-- Zmieniane funkcje (bez tabel billingowych):
--   * company_plan(uuid) (0055) — dotąd czytała subscriptions; teraz zawsze 'free'. Katalog
--     plan_entitlements, company_max_active_jobs, get_company_entitlements i limit aktywnych ofert
--     w publish_job / set_job_status (ENTITLEMENT_LIMIT) zostają bez zmian: przy braku
--     jakiejkolwiek subskrypcji plan efektywny był 'free', więc zachowanie jest identyczne.
--   * ops_metrics() (0171) — sekcja maintenance bez liczników staleDiscountReservations
--     i staleCheckoutIntents (czujka maintenance_lag zostaje dla przeterminowanych ofert).
--
-- Zostaje: plan_entitlements, processed_webhooks (inbox webhooków poczty, 0036/0038).
-- Rollback: supabase/rollback/0980_drop_dead_billing_schema.down.sql (odtwarza schemat
-- z definicji migracji 0001, 0007–0009, 0022, 0042, 0045, 0050, 0055, 0171).
-- =============================================================================

-- --- 1. Funkcje billingu ---------------------------------------------------------------------
drop function if exists public.reserve_discount(text, uuid);
drop function if exists public.finalize_discount(uuid, uuid, text);
drop function if exists public.release_stale_discount_reservations(integer);
drop function if exists public.begin_checkout(uuid, text);
drop function if exists public.complete_checkout(uuid, text);
drop function if exists public.release_checkout_intent(uuid);
drop function if exists public.release_stale_checkout_intents(integer);

-- --- 2. company_plan bez tabeli subscriptions ---------------------------------------------------
create or replace function public.company_plan(p_company_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select 'free'::text;
$$;
revoke all on function public.company_plan(uuid) from public;
grant execute on function public.company_plan(uuid) to authenticated, service_role;

-- --- 3. ops_metrics bez liczników checkoutu i rabatów (0171) ---------------------------------
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
      where status = 'active' and expires_at is not null and expires_at <= now() - interval '2 hours')
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

-- --- 4. Tabele billingu (kolejność: zależne od kodów rabatowych i subskrypcji najpierw) -----------
drop table if exists public.discount_redemptions;
drop table if exists public.checkout_intents;
drop table if exists public.payments;
drop table if exists public.invoices;
drop table if exists public.subscriptions;
drop table if exists public.discount_codes;

-- --- 5. Kolumna klienta płatności na firmie (0042) ------------------------------------------------
drop index if exists public.idx_companies_provider_customer;
alter table public.companies drop column if exists provider_customer_id;

-- --- 6. Typy enum billingu (0001) — po tabelach, które ich używały --------------------------------
drop type if exists public.payment_status;
drop type if exists public.invoice_status;
drop type if exists public.subscription_status;
