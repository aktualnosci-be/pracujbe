-- =============================================================================
-- 0089_job_funnel.sql
-- Serwerowy lejek ofert bez śledzenia użytkowników (#99, Invariant #7).
--
-- 1. `job_funnel_daily` — agregat per oferta i dzień (Europe/Brussels) z trzema licznikami
--    zdarzeń, których nie da się wyprowadzić ze stanu domeny:
--      * search_appearances — oferta pokazana w wynikach listy ofert,
--      * detail_views       — wyświetlenie strony szczegółu oferty,
--      * apply_started      — otwarcie formularza „Aplikuj" na stronie oferty.
--    Brak kolumn z tekstem wyszukiwania, IP, identyfikatorem użytkownika, User-Agentem
--    ani danymi profilu. Surowych zdarzeń nie zapisujemy — tylko sumy.
-- 2. `applications_submitted` NIE jest licznikiem: `get_company_job_funnel` liczy je przy
--    odczycie z `applications` (status <> 'draft', deleted_at is null, dzień submitted_at
--    w Europe/Brussels). Ta część lejka jest więc zawsze deterministycznie przebudowywalna
--    ze stanu domeny; liczniki zdarzeń z pkt 1 z założenia nie mają logu źródłowego.
-- 3. Deduplikacja retry/refresh: każde zdarzenie niesie losowy `nonce` wygenerowany
--    w pamięci przeglądarki na jedno załadowanie widoku (nie jest zapisywany w cookies ani
--    storage, nie łączy odwiedzin). `job_funnel_receipts` (nonce, event) z ON CONFLICT DO
--    NOTHING: ponowienie tego samego żądania (retry sieci, podwójny efekt) = jedno
--    zliczenie; odświeżenie strony = nowe załadowanie = nowe zliczenie. Pokwitowania
--    starsze niż 2 dni są usuwane przy kolejnych zapisach (bez identyfikatorów osób).
-- 4. `record_job_funnel_event` — atomowy upsert (INSERT … ON CONFLICT DO UPDATE +
--    pokwitowanie w tej samej transakcji). Zlicza wyłącznie oferty publiczne
--    (`job_is_public`) zweryfikowanych firm. Woła go tylko serwerowy endpoint
--    `/api/job-funnel` (bramka `pracujbe.funnel_writer` ustawiana w transakcji serwera),
--    który odrzuca boty/prefetch i ogranicza liczbę żądań.
-- 5. `get_company_job_funnel(company, from, to)` — odczyt dla recruiter+ (`can_manage_jobs`)
--    danej firmy; zakres ≤ 366 dni. Tabele agregatu nie mają żadnego dostępu dla
--    anon/authenticated (RLS bez polityk + REVOKE).
--
-- Rollback: drop function get_company_job_funnel(uuid, date, date);
-- drop function record_job_funnel_event(text, uuid, uuid[]);
-- drop table job_funnel_receipts; drop table job_funnel_daily.
-- =============================================================================

create table if not exists public.job_funnel_daily (
  job_id             uuid    not null references public.jobs(id) on delete cascade,
  day                date    not null,
  search_appearances integer not null default 0 check (search_appearances >= 0),
  detail_views       integer not null default 0 check (detail_views >= 0),
  apply_started      integer not null default 0 check (apply_started >= 0),
  updated_at         timestamptz not null default now(),
  primary key (job_id, day)
);
create index if not exists idx_job_funnel_daily_day on public.job_funnel_daily(day);

create table if not exists public.job_funnel_receipts (
  nonce      uuid        not null,
  event      text        not null
    check (event in ('search_appearance', 'detail_view', 'apply_started')),
  created_at timestamptz not null default now(),
  primary key (nonce, event)
);
create index if not exists idx_job_funnel_receipts_created on public.job_funnel_receipts(created_at);

alter table public.job_funnel_daily enable row level security;
alter table public.job_funnel_receipts enable row level security;
-- Domyślne uprawnienia schematu dają anon SELECT na nowych tabelach — odbieramy jawnie.
revoke all on table public.job_funnel_daily from public, anon, authenticated;
revoke all on table public.job_funnel_receipts from public, anon, authenticated;
grant all on table public.job_funnel_daily to service_role;
grant all on table public.job_funnel_receipts to service_role;

-- --- 4. Zapis zdarzenia --------------------------------------------------------------
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

  -- Deduplikacja: to samo załadowanie widoku (nonce) liczy dane zdarzenie raz.
  insert into public.job_funnel_receipts(nonce, event) values (p_nonce, p_event)
    on conflict do nothing;
  if not found then
    return 0;
  end if;

  -- Sprzątanie pokwitowań poza oknem deduplikacji (ograniczone, bez blokowania zapisu).
  delete from public.job_funnel_receipts
   where ctid in (select ctid from public.job_funnel_receipts
                   where created_at < now() - interval '2 days' limit 200);

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

-- --- 5. Odczyt lejka firmy -------------------------------------------------------------
create or replace function public.get_company_job_funnel(
  p_company_id uuid,
  p_from       date,
  p_to         date
) returns table (
  job_id                 uuid,
  title                  text,
  slug                   text,
  status                 text,
  search_appearances     bigint,
  detail_views           bigint,
  apply_started          bigint,
  applications_submitted bigint
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or p_company_id is null or not public.can_manage_jobs(p_company_id) then
    raise exception 'PERMISSION_DENIED: lejek tylko dla rekrutera firmy' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception 'VALIDATION_FAILED: nieprawidłowy zakres dat' using errcode = '22023';
  end if;

  return query
  with counters as (
    select d.job_id,
           sum(d.search_appearances)::bigint as search_appearances,
           sum(d.detail_views)::bigint       as detail_views,
           sum(d.apply_started)::bigint      as apply_started
      from public.job_funnel_daily d
      join public.jobs j on j.id = d.job_id
     where j.company_id = p_company_id
       and d.day between p_from and p_to
     group by d.job_id
  ), submitted as (
    -- Stan domenowy: aplikacje złożone w zakresie (dzień w Europe/Brussels).
    select a.job_id, count(*)::bigint as applications_submitted
      from public.applications a
      join public.jobs j on j.id = a.job_id
     where j.company_id = p_company_id
       and a.deleted_at is null
       and a.status <> 'draft'
       and a.submitted_at >= (p_from::timestamp at time zone 'Europe/Brussels')
       and a.submitted_at <  ((p_to + 1)::timestamp at time zone 'Europe/Brussels')
     group by a.job_id
  )
  select j.id, j.title, j.slug, j.status::text,
         coalesce(c.search_appearances, 0),
         coalesce(c.detail_views, 0),
         coalesce(c.apply_started, 0),
         coalesce(s.applications_submitted, 0)
    from public.jobs j
    left join counters c on c.job_id = j.id
    left join submitted s on s.job_id = j.id
   where j.company_id = p_company_id
     and j.deleted_at is null
     and (j.status in ('active', 'paused') or c.job_id is not null or s.job_id is not null)
   order by coalesce(c.detail_views, 0) desc, j.created_at desc, j.id;
end $$;

revoke all on function public.get_company_job_funnel(uuid, date, date) from public, anon;
grant execute on function public.get_company_job_funnel(uuid, date, date) to authenticated, service_role;
