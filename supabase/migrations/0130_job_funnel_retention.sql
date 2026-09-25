-- =============================================================================
-- 0130_job_funnel_retention.sql — #575: twarde terminy danych lejka ofert
-- (numer tymczasowy — ostateczny nada integrator).
--
-- Decyzja właściciela (25.09.2026): lejek działa tylko po zgodzie analitycznej, a jego dane
-- mają absolutne terminy niezależne od ruchu:
--   * `job_funnel_receipts` (nonce deduplikacji) — najwyżej 48 h;
--   * `job_funnel_daily` (sumy dzienne) — bieżący miesiąc kalendarzowy i 12 poprzednich
--     (≤ 13 miesięcy kalendarzowych, dzień w Europe/Brussels jak w 0089).
--
-- 1. `job_funnel_retention_cutoff(now)` — pierwszy zachowany dzień agregatów (STABLE,
--    testowalny dla dowolnej chwili).
-- 2. `purge_job_funnel_data(p_limit)` — service_role; usuwa partiami (SKIP LOCKED) receipts
--    starsze niż 48 h i agregaty sprzed progu; zwraca liczniki (jsonb). Woła je
--    `/api/maintenance` co godzinę, więc termin nie zależy od kolejnych zdarzeń.
-- 3. `record_job_funnel_event` (ciało z 0089) — sprzątanie przy zapisie (48 h, jak dawne 2 dni)
--    PRZED wstawieniem receiptu: nonce starszy niż 48 h nie blokuje już zapisu (okno
--    deduplikacji = termin przechowywania).
--
-- Rollback: drop function public.purge_job_funnel_data(integer);
--           drop function public.job_funnel_retention_cutoff(timestamptz);
--           odtworzyć `record_job_funnel_event` z 0089.
-- Migracja nie zmienia danych (pierwsze usunięcie robi dopiero zadanie maintenance).
-- =============================================================================

create or replace function public.job_funnel_retention_cutoff(p_now timestamptz)
returns date
language sql stable set search_path = public, pg_temp as $$
  select (date_trunc('month', (p_now at time zone 'Europe/Brussels')) - interval '12 months')::date
$$;

revoke all on function public.job_funnel_retention_cutoff(timestamptz) from public, anon, authenticated;
grant execute on function public.job_funnel_retention_cutoff(timestamptz) to service_role;

create or replace function public.purge_job_funnel_data(p_limit integer default 5000)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_limit    integer := least(greatest(coalesce(p_limit, 5000), 1), 50000);
  v_receipts integer;
  v_daily    integer;
begin
  delete from public.job_funnel_receipts r
   where r.ctid in (select ctid from public.job_funnel_receipts
                     where created_at < now() - interval '48 hours'
                     limit v_limit for update skip locked);
  get diagnostics v_receipts = row_count;

  delete from public.job_funnel_daily d
   where d.ctid in (select ctid from public.job_funnel_daily
                     where day < public.job_funnel_retention_cutoff(now())
                     limit v_limit for update skip locked);
  get diagnostics v_daily = row_count;

  return jsonb_build_object('receipts', v_receipts, 'daily', v_daily);
end $$;

revoke all on function public.purge_job_funnel_data(integer) from public, anon, authenticated;
grant execute on function public.purge_job_funnel_data(integer) to service_role;

-- --- 3. Zapis zdarzenia (0089 + termin 48 h) -------------------------------------------------
create or replace function public.record_job_funnel_event(
  p_event   text,
  p_nonce   uuid,
  p_job_ids uuid[]
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_day   date := (now() at time zone 'Europe/Brussels')::date;
  v_max   integer;
  v_count integer;
begin
  if coalesce(current_setting('pracujbe.funnel_writer', true), '') <> 'on' then
    raise exception 'PERMISSION_DENIED: zapis lejka tylko przez endpoint serwera'
      using errcode = '42501';
  end if;
  if p_event is null or p_event not in ('search_appearance', 'detail_view', 'apply_started')
     or p_nonce is null or p_job_ids is null then
    raise exception 'VALIDATION_FAILED: nieprawidłowe zdarzenie lejka' using errcode = '22023';
  end if;
  v_max := case when p_event = 'search_appearance' then 50 else 1 end;
  if cardinality(p_job_ids) = 0 then
    return 0;
  end if;
  if cardinality(p_job_ids) > v_max then
    raise exception 'VALIDATION_FAILED: za dużo ofert w zdarzeniu' using errcode = '22023';
  end if;

  -- Sprzątanie pokwitowań poza oknem 48 h (ograniczone; twardy termin trzyma maintenance).
  delete from public.job_funnel_receipts
   where ctid in (select ctid from public.job_funnel_receipts
                   where created_at < now() - interval '48 hours' limit 200);

  -- Deduplikacja: to samo załadowanie widoku (nonce) liczy dane zdarzenie raz.
  insert into public.job_funnel_receipts(nonce, event) values (p_nonce, p_event)
    on conflict do nothing;
  if not found then
    return 0;
  end if;

  insert into public.job_funnel_daily as d (job_id, day, search_appearances, detail_views, apply_started)
  select j.id, v_day,
         (p_event = 'search_appearance')::integer,
         (p_event = 'detail_view')::integer,
         (p_event = 'apply_started')::integer
    from (select distinct unnest(p_job_ids) as id) ids
    join public.jobs j on j.id = ids.id
    join public.companies c on c.id = j.company_id
   where public.job_is_public(j.id)
     and c.status = 'verified'
     and c.deleted_at is null
  on conflict (job_id, day) do update set
    search_appearances = d.search_appearances + excluded.search_appearances,
    detail_views       = d.detail_views + excluded.detail_views,
    apply_started      = d.apply_started + excluded.apply_started,
    updated_at         = now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.record_job_funnel_event(text, uuid, uuid[]) from public;
grant execute on function public.record_job_funnel_event(text, uuid, uuid[]) to anon, service_role;
