-- 0180_company_profile_jobs_order.sql — #638: stronicowanie ofert na profilu firmy
-- (numer nadany przez integratora).
--
-- Profil `/pracodawcy/<slug>` pokazywał tylko pierwsze 50 aktywnych ofert (`p_offset = 0`),
-- bez informacji o obcięciu. Aplikacja dostaje kolejne strony pod stabilnym adresem
-- `/pracodawcy/<slug>/strona/<n>` (ISR, offset = (n − 1) × rozmiar strony). Offset jest
-- poprawny tylko przy DETERMINISTYCZNYM porządku: `get_public_company_jobs` (0140) sortowało
-- wyłącznie po `published_at desc`, więc oferty z identycznym czasem publikacji (import,
-- publikacja seryjna) mogły wrócić w innej kolejności między wywołaniami — grupa remisowa
-- cięta w innym miejscu na sąsiednich stronach = oferta pominięta albo zdublowana.
--
-- Naprawa: unikalny tie-breaker `j.id desc` na końcu ORDER BY (jak `get_public_jobs` w 0136,
-- #594). Kolumny, parametry, filtr (verified + aktywna + niewygasła), clampy limit/offset
-- i granty bez zmian — `active_jobs_count` z `get_public_company` liczy ten sam zbiór.
--
-- Rollback: odtworzyć definicję z 0140 (ORDER BY bez `j.id desc`). Migracja nie zmienia danych.

create or replace function public.get_public_company_jobs(
  p_slug   text,
  p_locale text default 'pl',
  p_limit  integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid, slug text, title text, company_name text, company_verified boolean,
  city text, region text, contract_type text, salary_min integer, salary_max integer,
  currency text, salary_period text, published_at timestamptz, highlights text[], category text,
  accommodation boolean, immediate boolean, no_language_required boolean
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    j.id, j.slug,
    coalesce(t.title, j.title) as title,
    c.name as company_name,
    true as company_verified,
    j.city, j.region, j.contract_type::text,
    j.salary_min, j.salary_max, coalesce(j.currency, 'EUR') as currency,
    j.salary_period::text as salary_period,
    j.published_at,
    coalesce(t.highlights, '{}'::text[]) as highlights,
    j.category::text,
    j.accommodation, j.immediate, j.no_language_required
  from public.jobs j
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title, jt.highlights
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = case when public.is_supported_locale(p_locale) then p_locale else 'pl' end) desc,
             (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where c.slug = p_slug
    and c.status = 'verified' and c.deleted_at is null
    and j.status = 'active' and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
  order by j.published_at desc, j.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;

revoke all on function public.get_public_company_jobs(text, text, integer, integer) from public;
grant execute on function public.get_public_company_jobs(text, text, integer, integer)
  to anon, authenticated, service_role;
