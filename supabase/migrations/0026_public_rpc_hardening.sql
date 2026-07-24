-- =============================================================================
-- 0026_public_rpc_hardening.sql
-- Remediacja audytu 2026-07-24 — Wave B: hardening publicznych/procesowych RPC.
--
-- SEC-03 — publiczne RPC ofert miały nieograniczony `p_limit`, głęboki `p_offset` i
--   nielimitowane wejścia tekstowe (kosztowne skany/sortowania, duże odpowiedzi, DoS).
--   Domykamy: p_limit ∈ [1,100], p_offset ≤ 10000, keyword/city ≤ 100 znaków, locale z
--   allow-listy. Behawior dla poprawnych wejść bez zmian.
--
-- SEC-04 — limity długości istniały tylko w Zod/Server Actions; bezpośrednie wywołanie RPC
--   (albo dowolny zapis przez definer) je omijało. Dodajemy CHECK-i długości NA POZIOMIE
--   TABEL — niezależne od ścieżki (RPC, trigger, przyszłe funkcje). Wartości hojne (twardy
--   sufit anty-abuse, nie walidacja UX — ta zostaje w Zod z niższymi progami).
-- =============================================================================

-- --- SEC-04: twarde sufity długości pól tekstowych (path-independent) ----------
alter table public.applications
  add constraint applications_message_len   check (message is null or length(message) <= 4000),
  add constraint applications_phone_len     check (phone is null or length(phone) <= 40),
  add constraint applications_idem_len      check (idempotency_key is null or length(idempotency_key) <= 200);
alter table public.offers
  add constraint offers_message_len         check (length(message) <= 4000),
  add constraint offers_idem_len            check (length(idempotency_key) <= 200);
alter table public.messages
  add constraint messages_body_len          check (length(body) <= 4000);
alter table public.companies
  add constraint companies_name_len         check (length(name) <= 200),
  add constraint companies_vat_len          check (vat_number is null or length(vat_number) <= 64);

-- --- SEC-03: get_public_jobs z clampem limitu/offsetu + długości wejść ---------
create or replace function public.get_public_jobs(
  p_locale text default 'pl',
  p_keyword text default null,
  p_city text default null,
  p_category text default null,
  p_contract_type text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid, slug text, title text, company_name text, company_verified boolean,
  city text, region text, contract_type text, salary_min integer, salary_max integer,
  currency text, published_at timestamptz, highlights text[], category text,
  accommodation boolean, immediate boolean, no_language_required boolean
)
language sql stable security definer set search_path = public as $$
  select
    j.id, j.slug,
    coalesce(t.title, j.title) as title,
    c.name as company_name,
    (c.status = 'verified') as company_verified,
    j.city, j.region, j.contract_type::text,
    j.salary_min, j.salary_max, coalesce(j.currency, 'EUR') as currency,
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
    order by (jt.locale = case when p_locale in ('pl','nl','fr','en') then p_locale else 'pl' end) desc,
             (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where j.status = 'active'
    and j.deleted_at is null
    and c.status = 'verified'
    and c.deleted_at is null
    and (p_category is null or j.category::text = p_category)
    and (p_contract_type is null or j.contract_type::text = p_contract_type)
    and (p_city is null or j.city ilike '%' || left(p_city, 100) || '%')
    and (p_keyword is null or coalesce(t.title, j.title) ilike '%' || left(p_keyword, 100) || '%')
  order by j.published_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;

-- --- SEC-03: licznik z tymi samymi limitami długości wejść ---------------------
create or replace function public.get_public_jobs_count(
  p_locale text default 'pl',
  p_keyword text default null,
  p_city text default null,
  p_category text default null,
  p_contract_type text default null
) returns bigint language sql stable security definer set search_path = public as $$
  select count(*)::bigint
  from public.jobs j
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = case when p_locale in ('pl','nl','fr','en') then p_locale else 'pl' end) desc,
             (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where j.status = 'active' and j.deleted_at is null
    and c.status = 'verified' and c.deleted_at is null
    and (p_category is null or j.category::text = p_category)
    and (p_contract_type is null or j.contract_type::text = p_contract_type)
    and (p_city is null or j.city ilike '%' || left(p_city, 100) || '%')
    and (p_keyword is null or coalesce(t.title, j.title) ilike '%' || left(p_keyword, 100) || '%');
$$;
