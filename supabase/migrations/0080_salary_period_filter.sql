-- #188: filtr, sortowanie i facety wynagrodzeń uwzględniają okres stawki.
--
-- Suwak listy ofert jest w EUR brutto/miesiąc. Wspólna reguła (lustrzana w
-- src/lib/salary.ts dla danych demonstracyjnych):
--   * month  → kwota bez zmian,
--   * year   → kwota / 12 (przeliczenie bez założeń o godzinach pracy),
--   * hour   → NIE przeliczamy: `working_hours` to wolny tekst, a 160 h/mies. nie
--              pasuje do pracy w niepełnym wymiarze ani zmiennych godzin.
-- Oferta bez porównywalnej kwoty (stawka godzinowa albo brak wynagrodzenia) nie jest
-- wykluczana przez filtr kwoty — tak jak dotąd oferta bez wynagrodzenia — i trafia na
-- koniec sortowania „najwyższe wynagrodzenie” (nulls last). Listing, licznik i facety
-- wołają te same funkcje, więc nie mogą się rozjechać.

create or replace function public.job_monthly_salary(
  p_amount integer, p_period public.salary_period
) returns numeric language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case p_period
    when 'month' then p_amount::numeric
    when 'year'  then p_amount::numeric / 12
    else null
  end;
$$;

create or replace function public.job_salary_in_monthly_range(
  p_job_min integer, p_job_max integer, p_period public.salary_period,
  p_filter_min integer, p_filter_max integer
) returns boolean language sql immutable parallel safe set search_path = public, pg_temp as $$
  select
    (p_filter_min is null and p_filter_max is null)
    or public.job_monthly_salary(coalesce(p_job_max, p_job_min), p_period) is null
    or (public.job_monthly_salary(coalesce(p_job_max, p_job_min), p_period)
          >= coalesce(p_filter_min, 0)
        and public.job_monthly_salary(coalesce(p_job_min, p_job_max), p_period)
          <= coalesce(p_filter_max, 2147483647));
$$;

create or replace function public.job_monthly_salary_sort_key(
  p_job_min integer, p_job_max integer, p_period public.salary_period
) returns numeric language sql immutable parallel safe set search_path = public, pg_temp as $$
  select public.job_monthly_salary(coalesce(p_job_max, p_job_min), p_period);
$$;

-- --- get_public_jobs (0063) — reguła okresu w filtrze i sortowaniu --------------
create or replace function public.get_public_jobs(
  p_locale         text        default 'pl',
  p_keyword        text        default null,
  p_city           text        default null,
  p_categories     text[]      default null,
  p_locations      text[]      default null,
  p_contract_types text[]      default null,
  p_salary_min     integer     default null,
  p_salary_max     integer     default null,
  p_accommodation  boolean     default null,
  p_immediate      boolean     default null,
  p_no_language    boolean     default null,
  p_since          timestamptz default null,
  p_sort           text        default 'newest',
  p_limit          integer     default 20,
  p_offset         integer     default 0
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
    (c.status = 'verified') as company_verified,
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
  where j.status = 'active' and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified' and c.deleted_at is null
    and (p_categories is null or array_length(p_categories, 1) is null or j.category::text = any(p_categories))
    and (p_locations is null or array_length(p_locations, 1) is null or j.city = any(p_locations))
    and (p_contract_types is null or array_length(p_contract_types, 1) is null or j.contract_type::text = any(p_contract_types))
    and (p_city is null or j.city ilike '%' || left(p_city, 100) || '%')
    and (p_keyword is null or coalesce(t.title, j.title) ilike '%' || left(p_keyword, 100) || '%')
    and public.job_salary_in_monthly_range(
      j.salary_min, j.salary_max, j.salary_period, p_salary_min, p_salary_max)
    and (p_accommodation is null or j.accommodation = p_accommodation)
    and (coalesce(p_immediate, false) = false or j.immediate = true)
    and (coalesce(p_no_language, false) = false or j.no_language_required = true)
    and (p_since is null or j.published_at >= p_since)
  order by
    (case when p_sort = 'salary' then public.job_monthly_salary_sort_key(
      j.salary_min, j.salary_max, j.salary_period) end) desc nulls last,
    j.published_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;

revoke all on function public.get_public_jobs(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, integer, integer
) from public;
grant execute on function public.get_public_jobs(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, integer, integer
) to anon, authenticated;

-- --- get_public_jobs_count (0048) — ta sama reguła --------------------------------
create or replace function public.get_public_jobs_count(
  p_locale         text      default 'pl',
  p_keyword        text      default null,
  p_city           text      default null,
  p_categories     text[]    default null,
  p_locations      text[]    default null,
  p_contract_types text[]    default null,
  p_salary_min     integer   default null,
  p_salary_max     integer   default null,
  p_accommodation  boolean   default null,
  p_immediate      boolean   default null,
  p_no_language    boolean   default null,
  p_since          timestamptz default null
) returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::bigint
  from public.jobs j
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = case when public.is_supported_locale(p_locale) then p_locale else 'pl' end) desc,
             (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where j.status = 'active' and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified' and c.deleted_at is null
    and (p_categories is null or array_length(p_categories, 1) is null or j.category::text = any(p_categories))
    and (p_locations is null or array_length(p_locations, 1) is null or j.city = any(p_locations))
    and (p_contract_types is null or array_length(p_contract_types, 1) is null or j.contract_type::text = any(p_contract_types))
    and (p_city is null or j.city ilike '%' || left(p_city, 100) || '%')
    and (p_keyword is null or coalesce(t.title, j.title) ilike '%' || left(p_keyword, 100) || '%')
    and public.job_salary_in_monthly_range(
      j.salary_min, j.salary_max, j.salary_period, p_salary_min, p_salary_max)
    and (p_accommodation is null or j.accommodation = p_accommodation)
    and (coalesce(p_immediate, false) = false or j.immediate = true)
    and (coalesce(p_no_language, false) = false or j.no_language_required = true)
    and (p_since is null or j.published_at >= p_since);
$$;

-- --- get_public_job_filter_facets (0065) — ta sama reguła ------------------------
create or replace function public.get_public_job_filter_facets(
  p_locale text default 'pl', p_keyword text default null, p_city text default null,
  p_categories text[] default null, p_locations text[] default null,
  p_contract_types text[] default null, p_salary_min integer default null,
  p_salary_max integer default null, p_accommodation boolean default null,
  p_immediate boolean default null, p_no_language boolean default null,
  p_since timestamptz default null
) returns table (dimension text, key text, total bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  with input as (
    select
      case when public.is_supported_locale(p_locale) then p_locale else 'pl' end locale,
      nullif(left(p_keyword,100),'') keyword, nullif(left(p_city,100),'') city,
      (select array_agg(distinct left(v,100)) from unnest(p_categories[1:100]) v where v <> '') categories,
      (select array_agg(distinct left(v,100)) from unnest(p_locations[1:100]) v where v <> '') locations,
      (select array_agg(distinct left(v,100)) from unnest(p_contract_types[1:100]) v where v <> '') contracts
  ), base as materialized (
    select j.id, j.category::text category, j.city, j.contract_type::text contract_type,
      j.accommodation, j.immediate, j.no_language_required
    from public.jobs j
    join public.companies c on c.id=j.company_id
    cross join input i
    left join lateral (
      select jt.title from public.job_translations jt where jt.job_id=j.id
      order by (jt.locale=i.locale) desc, (jt.locale=j.default_locale) desc,
        (jt.locale='en') desc limit 1
    ) t on true
    where j.status='active' and j.deleted_at is null
      and (j.expires_at is null or j.expires_at>now())
      and c.status='verified' and c.deleted_at is null
      and (i.keyword is null or coalesce(t.title,j.title) ilike '%'||i.keyword||'%')
      and (i.city is null or j.city ilike '%'||i.city||'%')
      and public.job_salary_in_monthly_range(
        j.salary_min,j.salary_max,j.salary_period,p_salary_min,p_salary_max)
      and (p_since is null or j.published_at>=p_since)
  ), selected as (select * from input)
  select 'total','all',count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required)
  union all
  select 'category',b.category,count(*) from base b cross join selected s where
    (s.locations is null or b.city=any(s.locations)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) group by b.category
  union all
  select 'location',b.city,count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) group by b.city
  union all
  select 'contract',b.contract_type,count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) group by b.contract_type
  union all
  select 'accommodation',case when b.accommodation then 'provided' else 'unavailable' end,count(*)
    from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required)
    group by b.accommodation
  union all
  select 'additional','immediate',count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and b.immediate and
    (coalesce(p_no_language,false)=false or b.no_language_required)
  union all
  select 'additional','no_language',count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and b.no_language_required;
$$;

revoke all on function public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz) from public;
grant execute on function public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz) to anon, authenticated;
