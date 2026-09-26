-- =============================================================================
-- 0206_applied_job_availability.sql — stan oferty w historii zgłoszeń i propozycji kandydata.
--
-- Numer tymczasowy — ostateczny nada integrator.
--
-- `get_applied_jobs_display` (0023/0113) i `get_offered_jobs_display` (0090) zwracają dane
-- oferty NIEZALEŻNIE od jej statusu (kandydat nie traci tytułu po zamknięciu oferty), ale
-- zwracały też `slug`, więc panel linkował „Zobacz ofertę” do strony publicznej, która dla
-- oferty zamkniętej, wygasłej, wstrzymanej albo firmy niezweryfikowanej odpowiada 404.
--
-- Teraz obie funkcje zwracają dodatkowo `job_availability`:
--   available   — oferta jest publiczna (te same warunki co `get_public_job`, 0140),
--   expired     — status `expired` albo termin `expires_at` minął,
--   closed      — status `closed` albo oferta usunięta,
--   unavailable — inaczej (wstrzymana, szkic, firma niezweryfikowana/zawieszona).
-- `slug` jest zwracany WYŁĄCZNIE dla `available` — link do strony publicznej istnieje tylko,
-- gdy strona istnieje. Zmiana typu wyniku wymaga DROP + CREATE; granty jak wcześniej.
--
-- Rollback: odtworzyć definicje z 0113 (get_applied_jobs_display) i 0090
-- (get_offered_jobs_display) — obie po `drop function`.
-- =============================================================================

-- Ten sam predykat „oferta publiczna” co `get_public_job` (0140) + klasyfikacja pozostałych.
create or replace function public.candidate_job_availability(
  p_status public.job_status,
  p_deleted_at timestamptz,
  p_expires_at timestamptz,
  p_company_status public.company_status,
  p_company_deleted_at timestamptz
) returns text language sql stable set search_path = public, pg_temp as $$
  select case
    when p_deleted_at is null and p_status = 'active'
         and (p_expires_at is null or p_expires_at > now())
         and p_company_status = 'verified' and p_company_deleted_at is null
      then 'available'
    when p_deleted_at is not null or p_status = 'closed'
      then 'closed'
    when p_status = 'expired'
         or (p_status in ('active', 'paused') and p_expires_at is not null and p_expires_at <= now())
      then 'expired'
    else 'unavailable'
  end;
$$;
revoke all on function public.candidate_job_availability(public.job_status, timestamptz, timestamptz,
  public.company_status, timestamptz) from public, anon;
grant execute on function public.candidate_job_availability(public.job_status, timestamptz, timestamptz,
  public.company_status, timestamptz) to authenticated;

-- --- get_applied_jobs_display(p_locale, p_job_ids) (0113) + job_availability ---------------
drop function if exists public.get_applied_jobs_display(text, uuid[]);

create function public.get_applied_jobs_display(
  p_locale text default 'pl',
  p_job_ids uuid[] default null
)
returns table (
  job_id uuid,
  slug text,
  title text,
  company_name text,
  city text,
  job_availability text
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_job_ids is not null and coalesce(cardinality(p_job_ids), 0) > 100 then
    raise exception 'VALIDATION_FAILED: za dużo identyfikatorów ofert' using errcode = '22023';
  end if;

  return query
  select distinct on (j.id)
    j.id,
    case when v.availability = 'available' then j.slug end as slug,
    coalesce(t.title, j.title) as title,
    coalesce(c.name, '') as company_name,
    j.city,
    v.availability
  from public.applications a
  join public.jobs j on j.id = a.job_id
  left join public.companies c on c.id = j.company_id
  cross join lateral (
    select public.candidate_job_availability(j.status, j.deleted_at, j.expires_at,
                                             c.status, c.deleted_at) as availability
  ) v
  left join lateral (
    select jt.title
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = p_locale) desc, (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where a.candidate_id = auth.uid()
    and a.deleted_at is null
    and (p_job_ids is null or a.job_id = any(p_job_ids));
end $$;

revoke all on function public.get_applied_jobs_display(text, uuid[]) from public, anon;
grant execute on function public.get_applied_jobs_display(text, uuid[]) to authenticated;

-- --- get_offered_jobs_display(p_locale) (0090) + job_availability ---------------------------
drop function if exists public.get_offered_jobs_display(text);

create function public.get_offered_jobs_display(p_locale text default 'pl')
returns table (job_id uuid, slug text, title text, company_name text, city text, job_availability text)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct on (j.id)
    j.id,
    case when v.availability = 'available' then j.slug end as slug,
    coalesce(t.title, j.title) as title,
    coalesce(c.name, '') as company_name,
    j.city,
    v.availability
  from public.offers o
  join public.jobs j on j.id = o.job_id
  left join public.companies c on c.id = j.company_id
  cross join lateral (
    select public.candidate_job_availability(j.status, j.deleted_at, j.expires_at,
                                             c.status, c.deleted_at) as availability
  ) v
  left join lateral (
    select jt.title
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = case when public.is_supported_locale(p_locale) then p_locale else 'pl' end) desc,
             (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where o.candidate_id = auth.uid()
    and o.deleted_at is null
  order by j.id;
$$;

revoke all on function public.get_offered_jobs_display(text) from public, anon;
grant execute on function public.get_offered_jobs_display(text) to authenticated;
