-- =============================================================================
-- 0193 (numer tymczasowy) — poczta: czujki bez szumu wygaszeń, błąd konfiguracji nadawcy
-- i ponowne zakolejkowanie nieudanych listów (#1227 OPS-2, #1214 OPS-1).
--
-- 1. ops_metrics() — bazuje na NAJNOWSZEJ definicji z 0177 (0180–0183 jej nie zmieniają; żadna
--    gałąź w kolejce na dzień 29.09 — w tym 0184 — nie nadpisuje ops_metrics). Sekcja `email`:
--    * `failedLast24h` liczy tylko porażki wysyłki (`suppressed_at is null`) — wygaszenie
--      (wypisanie po zakolejkowaniu, blokada adresu #44, funkcja wyłączona 0175, wyłączony alert)
--      ustawia `status='failed', suppressed_at=now()` (claim_email_batch/email_delivery_send_check)
--      i dotąd zawyżało ostrzeżenie `email_failed` (#1227);
--    * `suppressedLast24h` — wygaszone w 24 h (informacyjnie, bez progu);
--    * `configBlocked` — listy czekające po błędzie konfiguracji nadawcy/dostawcy (worker odkłada
--      je bez zużycia próby z kodem `EMAIL_PROVIDER_CONFIG`, #1214) → alarm `email_provider_config`.
--    Reszta funkcji bez zmian. Gdy inna migracja w kolejce zmieni ops_metrics, musi przejąć te pola.
-- 2. requeue_failed_email_deliveries(p_since_days, p_dry_run, p_templates, p_error_messages) —
--    tylko service_role (skrypt operatora scripts/db/requeue-failed-emails.mjs, bez UI). Wraca do
--    kolejki listy `failed` z ostatnich N dni (1–30), które NIE zostały wygaszone (suppressed_at),
--    nie należą do kampanii (kampanie mają własne rewizje) i nie zostały przyjęte przez dostawcę
--    (provider_message_id/sent_at puste). attempts = 0, bez dzierżawy; claim_email_batch ponownie
--    sprawdza zgodę, blokadę adresu i uprawnienie odbiorcy, więc wypisany nie dostanie listu.
--    Domyślnie dry-run (same liczby). Audyt `email_delivery.requeued` z liczbami, bez adresów.
-- Rollback: supabase/rollback/0193_email_ops_config_requeue.down.sql.
-- =============================================================================

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
    -- #1227: same porażki wysyłki; wiersze wygaszone (suppressed_at) liczone osobno, bez alarmu.
    'failedLast24h', count(*) filter (where status = 'failed' and suppressed_at is null
      and updated_at > now() - interval '24 hours'),
    'suppressedLast24h', count(*) filter (where status = 'failed' and suppressed_at is not null
      and updated_at > now() - interval '24 hours'),
    -- #1214: listy odłożone po błędzie konfiguracji nadawcy/dostawcy (worker bez zużycia próby).
    'configBlocked', count(*) filter (where status = 'queued' and error_message = 'EMAIL_PROVIDER_CONFIG')
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

revoke all on function public.ops_metrics() from public, anon, authenticated;
grant execute on function public.ops_metrics() to pracujbe_ops, service_role;


create or replace function public.requeue_failed_email_deliveries(
  p_since_days integer,
  p_dry_run boolean default true,
  p_templates text[] default null,
  p_error_messages text[] default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_dry boolean := coalesce(p_dry_run, true);
  v_matched integer;
  v_requeued integer := 0;
begin
  if p_since_days is null or p_since_days < 1 or p_since_days > 30
     or coalesce(cardinality(p_templates), 0) > 50 or coalesce(cardinality(p_error_messages), 0) > 20 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  select count(*) into v_matched
    from public.email_deliveries d
   where d.status = 'failed'
     and d.suppressed_at is null
     and d.campaign_id is null
     and d.provider_message_id is null
     and d.sent_at is null
     and d.updated_at > now() - make_interval(days => p_since_days)
     and (p_templates is null or d.template = any(p_templates))
     and (p_error_messages is null or d.error_message = any(p_error_messages));

  if not v_dry and v_matched > 0 then
    update public.email_deliveries d
       set status = 'queued', attempts = 0, next_attempt_at = now(), error_message = null,
           locked_at = null, lock_token = null
     where d.status = 'failed'
     and d.suppressed_at is null
     and d.campaign_id is null
     and d.provider_message_id is null
     and d.sent_at is null
     and d.updated_at > now() - make_interval(days => p_since_days)
     and (p_templates is null or d.template = any(p_templates))
     and (p_error_messages is null or d.error_message = any(p_error_messages));
    get diagnostics v_requeued = row_count;
    perform public.write_audit('email_delivery.requeued', 'email_delivery', null, null,
      jsonb_build_object('sinceDays', p_since_days, 'requeued', v_requeued,
        'templates', coalesce(to_jsonb(p_templates), 'null'::jsonb),
        'errorMessages', coalesce(to_jsonb(p_error_messages), 'null'::jsonb)));
  end if;

  return jsonb_build_object('matched', v_matched, 'requeued', v_requeued, 'dryRun', v_dry);
end $$;
revoke all on function public.requeue_failed_email_deliveries(integer, boolean, text[], text[])
  from public, anon, authenticated;
grant execute on function public.requeue_failed_email_deliveries(integer, boolean, text[], text[]) to service_role;
