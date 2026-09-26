-- =============================================================================
-- 0213_ops_maintenance_runs.sql — ostatni przebieg /api/maintenance dla czujek (#47).
--
-- Numer migracji tymczasowy (sesja potomna) — koordynator nadaje ostateczny.
--
-- Kontekst: ops_metrics() (0096) widzi skutki pominiętego maintenance tylko pośrednio
-- (oferty po terminie, porzucone rezerwacje). Przy pustej bazie albo braku crona nic nie
-- rośnie, więc brak przebiegów jest niewidoczny. Ta migracja zapisuje OSTATNI przebieg:
--
-- 1. public.ops_job_runs — jeden wiersz na zadanie (dziś tylko 'maintenance'): czas
--    zakończenia, wynik (ok/błąd), czas trwania i nazwa pierwszego zadania z błędem (stały
--    identyfikator z kodu, np. 'jobExpiry'). Bez danych osobowych, adresów i treści.
--    RLS + brak grantów dla anon/authenticated; zapis tylko przez RPC.
-- 2. record_ops_job_run(job, ok, duration_ms, failed_task) — upsert, tylko service_role
--    (woła go /api/maintenance na końcu przebiegu).
-- 3. ops_last_maintenance_run() → jsonb (SECURITY DEFINER, pracujbe_ops i service_role):
--    {finishedAt, ageSeconds, ok, durationMs, failedTask}; ageSeconds = null → nigdy.
--    Progi (stary/nieudany/brak) w aplikacji: src/lib/ops/sensors.ts.
--
-- Rollback: drop function public.ops_last_maintenance_run();
--           drop function public.record_ops_job_run(text, boolean, integer, text);
--           drop table public.ops_job_runs;
-- Migracja nie zmienia istniejących danych. Nie edytować po zastosowaniu.
-- =============================================================================

create table if not exists public.ops_job_runs (
  job              text primary key check (job in ('maintenance')),
  last_finished_at timestamptz not null,
  last_ok          boolean not null,
  last_duration_ms integer not null check (last_duration_ms >= 0),
  last_failed_task text check (last_failed_task is null or last_failed_task ~ '^[A-Za-z]{1,40}$'),
  check (last_ok = (last_failed_task is null))
);

alter table public.ops_job_runs enable row level security;
alter table public.ops_job_runs force row level security;
revoke all on public.ops_job_runs from public, anon, authenticated;

create or replace function public.record_ops_job_run(
  p_job text,
  p_ok boolean,
  p_duration_ms integer,
  p_failed_task text default null
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_job is distinct from 'maintenance' or p_ok is null
     or p_duration_ms is null or p_duration_ms < 0
     or (p_ok and p_failed_task is not null)
     or (not p_ok and (p_failed_task is null or p_failed_task !~ '^[A-Za-z]{1,40}$')) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  insert into public.ops_job_runs as r (job, last_finished_at, last_ok, last_duration_ms, last_failed_task)
  values (p_job, now(), p_ok, least(p_duration_ms, 2147483647), p_failed_task)
  on conflict (job) do update
    set last_finished_at = excluded.last_finished_at,
        last_ok = excluded.last_ok,
        last_duration_ms = excluded.last_duration_ms,
        last_failed_task = excluded.last_failed_task;
  return true;
end $$;

revoke all on function public.record_ops_job_run(text, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.record_ops_job_run(text, boolean, integer, text) to service_role;

create or replace function public.ops_last_maintenance_run()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    (select jsonb_build_object(
       'finishedAt', to_char(r.last_finished_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       'ageSeconds', greatest(0, floor(extract(epoch from now() - r.last_finished_at)))::bigint,
       'ok', r.last_ok,
       'durationMs', r.last_duration_ms,
       'failedTask', r.last_failed_task)
     from public.ops_job_runs r where r.job = 'maintenance'),
    jsonb_build_object('finishedAt', null, 'ageSeconds', null, 'ok', null, 'durationMs', null, 'failedTask', null)
  );
$$;

revoke all on function public.ops_last_maintenance_run() from public, anon, authenticated;
grant execute on function public.ops_last_maintenance_run() to pracujbe_ops, service_role;
