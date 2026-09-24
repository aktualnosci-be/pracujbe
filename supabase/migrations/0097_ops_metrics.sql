-- =============================================================================
-- 0097_ops_metrics.sql
-- #47: czujki operacyjne i indeks wyszukiwania miasta.
--
-- 1. Rola pracujbe_ops (NOLOGIN, NOINHERIT, bez atrybutów). Osobny login monitoringu
--    operatora ma członkostwo WYŁĄCZNIE w tej roli (kontrola w src/lib/db/pool.ts, cel
--    'ops'). Rola nie ma żadnych praw do tabel — tylko EXECUTE na ops_metrics().
-- 2. ops_metrics() → jsonb (SECURITY DEFINER, tylko pracujbe_ops i service_role):
--    wyłącznie LICZBY — zaległości i wiek najstarszego gotowego zadania kolejek e-mail
--    (domenowej i auth), porzucone dzierżawy, nieudane wysyłki z 24 h, zawieszone webhooki,
--    opóźnienie maintenance (aktywne oferty po terminie, porzucone rezerwacje/checkouty)
--    oraz wykorzystanie połączeń PostgreSQL. Bez adresów, treści, identyfikatorów i tokenów.
--    Progi alarmowe są w aplikacji (src/lib/ops/sensors.ts), nie w bazie.
--    auth.email_outbox (0061) jest odczytywane tylko, gdy istnieje (ścieżka Supabase go
--    nie ma) — stąd dynamiczny SQL ze stałym tekstem, bez danych wejściowych.
-- 3. idx_jobs_city_trgm — częściowy (aktywne, nieusunięte) GIN gin_trgm_ops na jobs.city:
--    filtr miasta get_public_jobs / _count / facety (`j.city ilike '%…%'`, 0080). Na
--    PostgreSQL 18 (Railway) ciało funkcji SQL dostaje plan dla konkretnych wartości i
--    używa indeksu; na PG16 plan ogólny (`$3 IS NULL OR …`) go nie używa — koszt tylko
--    przy zapisie. Funkcji wyszukiwania NIE zmieniamy (rozłącznie z #188).
--    Pomiar EXPLAIN przed/po: scripts/db/search-benchmark.sh, docs/railway/OPERATIONS.md.
--
-- Rollback: NOWA migracja naprawcza — drop function public.ops_metrics(),
-- drop index public.idx_jobs_city_trgm, revoke usage on schema public from pracujbe_ops,
-- drop role pracujbe_ops (po odebraniu członkostwa loginowi monitoringu). Migracja nie
-- zmienia danych. Nie edytować po zastosowaniu.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pracujbe_ops') then
    create role pracujbe_ops nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
  if exists (select 1 from pg_roles where rolname = 'pracujbe_ops'
    and (rolcanlogin or rolinherit or rolsuper or rolbypassrls or rolcreatedb or rolcreaterole))
    or exists (select 1 from pg_auth_members where member = 'pracujbe_ops'::regrole)
  then
    raise exception 'Istniejąca rola monitoringu ma niezgodne uprawnienia.';
  end if;
end $$;

grant usage on schema public to pracujbe_ops;

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

  return jsonb_build_object(
    'email', v_email,
    'authEmail', v_auth_email,
    'webhooks', v_webhooks,
    'maintenance', v_maintenance,
    'connections', v_connections
  );
end $$;

revoke all on function public.ops_metrics() from public, anon, authenticated;
grant execute on function public.ops_metrics() to pracujbe_ops, service_role;

create index if not exists idx_jobs_city_trgm
  on public.jobs using gin (city gin_trgm_ops) where status = 'active' and deleted_at is null;
