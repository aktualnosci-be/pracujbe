-- =============================================================================
-- 0113_ops_mail_metrics.sql   (numer TYMCZASOWY — ostateczny nada integrator)
-- #44: alarmy poczty w czujkach operacyjnych (#47, 0096).
--
-- ops_metrics() dostaje sekcję `mail` — wyłącznie LICZBY:
--   * sentLast24h / hardBouncesLast24h / complaintsLast24h — kohorta listów przyjętych
--     przez dostawcę w ostatnich 24 h i ile z nich trwale odbiło się / dostało skargę
--     (zdarzenia z webhooka Resend, record_email_event, 0098);
--   * sentBaseline7d / hardBouncesBaseline7d / complaintsBaseline7d — to samo dla 7 dób
--     przed bieżącą dobą (odniesienie dla „wzrostu odsetka”);
--   * activeSuppressions — aktywne blokady adresów (email_suppressions, lifted_at null);
--   * newSuppressionsLast24h — blokady założone w ostatnich 24 h.
-- Wiek najstarszego gotowego wiersza obu kolejek (email_deliveries, auth.email_outbox)
-- jest już raportowany od 0096 (`email`/`authEmail.oldestReadyAgeSeconds`) — bez zmian.
-- Pozostałe klucze i ich znaczenie bez zmian (kod sprzed tej migracji działa dalej).
-- Odsetki, progi i minimalna próba są w aplikacji (src/lib/ops/sensors.ts), nie w bazie.
-- Dostęp bez zmian: EXECUTE tylko pracujbe_ops i service_role; pracujbe_ops nadal nie ma
-- praw do żadnej tabeli (SECURITY DEFINER).
--
-- idx_email_deliveries_sent_at — częściowy (sent_at not null) indeks pod okno 8 dób.
--
-- Rollback: NOWA migracja naprawcza z ciałem ops_metrics() z 0096 i
-- drop index public.idx_email_deliveries_sent_at. Aplikacja toleruje brak sekcji `mail`
-- (czujki poczty wtedy milczą). Migracja nie zmienia danych. Nie edytować po zastosowaniu.
-- =============================================================================

create index if not exists idx_email_deliveries_sent_at
  on public.email_deliveries (sent_at) where sent_at is not null;

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
begin
  -- Kolejka domenowa: gotowe = queued i termin minął; dzierżawa worker/claim = 300 s (0021).
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

  -- Maintenance co godzinę: oferta aktywna > 2 h po terminie = pominięte co najmniej jedno
  -- wywołanie; rezerwacje (24 h) i checkouty (30 min) — z zapasem na jeden przebieg.
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

  return jsonb_build_object(
    'email', v_email,
    'authEmail', v_auth_email,
    'webhooks', v_webhooks,
    'maintenance', v_maintenance,
    'connections', v_connections,
    'mail', v_mail
  );
end $$;

revoke all on function public.ops_metrics() from public, anon, authenticated;
grant execute on function public.ops_metrics() to pracujbe_ops, service_role;
