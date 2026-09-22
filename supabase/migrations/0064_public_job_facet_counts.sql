-- Grupowane liczniki kafli /praca. Tabele jobs/companies pozostają niedostępne dla anon;
-- SECURITY DEFINER ujawnia wyłącznie klucz filtra i liczbę publicznych ofert.

create or replace function public.get_public_job_category_counts(p_categories text[])
returns table (key text, total bigint)
language sql stable security definer set search_path = public as $$
  with requested(key) as (
    select distinct left(value, 100)
    from unnest(coalesce(p_categories, '{}'::text[])) value
    where value is not null and value <> ''
    limit 100
  )
  select requested.key, count(c.id)::bigint
  from requested
  left join public.jobs j
    on j.category::text = requested.key
   and j.status = 'active' and j.deleted_at is null
   and (j.expires_at is null or j.expires_at > now())
  left join public.companies c
    on c.id = j.company_id and c.status = 'verified' and c.deleted_at is null
  group by requested.key;
$$;

create or replace function public.get_public_job_city_counts(p_cities text[])
returns table (key text, total bigint)
language sql stable security definer set search_path = public as $$
  with requested(key) as (
    select distinct left(value, 100)
    from unnest(coalesce(p_cities, '{}'::text[])) value
    where value is not null and value <> ''
    limit 100
  )
  select requested.key, count(c.id)::bigint
  from requested
  left join public.jobs j
    on j.city ilike '%' || requested.key || '%'
   and j.status = 'active' and j.deleted_at is null
   and (j.expires_at is null or j.expires_at > now())
  left join public.companies c
    on c.id = j.company_id and c.status = 'verified' and c.deleted_at is null
  group by requested.key;
$$;

revoke all on function public.get_public_job_category_counts(text[]) from public;
revoke all on function public.get_public_job_city_counts(text[]) from public;
grant execute on function public.get_public_job_category_counts(text[]) to anon, authenticated;
grant execute on function public.get_public_job_city_counts(text[]) to anon, authenticated;
