-- =============================================================================
-- 0099_campaign_job_source.sql
-- Zaufany odczyt oferty do materiałów kampanii (#186, #175).
--
-- Problem: eksport grafik (post 1080×1080 z #181, baner kampanii z #175) brał dane z
--   `get_public_job`, które nie filtruje `is_demo` i zwraca pełną treść oferty. Oznaczenie
--   `is_demo` nie było widoczne żadnym publicznym odczytem, więc eksporter nie mógł wiarygodnie
--   odrzucić oferty demonstracyjnej (ręczne `isDemo: false` da się sfałszować).
--
-- Naprawa: jedno wąskie źródło `campaign_job_source` (bez EXECUTE dla klientów) zwraca TYLKO
--   pola potrzebne grafice i TYLKO gdy oferta: status `active`, nieusunięta, niewygasła,
--   `is_demo = false`, firma `verified`, nieusunięta i `is_demo = false`. Dwa wejścia:
--   - `get_campaign_job(slug, locale)` — publiczne (anon/authenticated) dla lokalnego eksportera;
--     zwraca wyłącznie dane już publiczne na stronie oferty;
--   - `get_managed_campaign_job(job_id, locale)` — dla panelu: dodatkowo wymaga, by wywołujący
--     był recruiter+ firmy oferty (`can_manage_jobs`) albo administratorem (`is_admin`).
--   Każdy brak (nie istnieje / demo / nieaktywna / wygasła / cudza / firma niezweryfikowana)
--   daje ten sam pusty wynik. Bez PII: brak kontaktów, członków firmy, opisu i identyfikatorów.
--
-- Rollback: supabase/rollback/0099_campaign_job_source.down.sql.
-- Dowód: supabase/tests/rls.sql sekcja CJ186.
-- =============================================================================

create or replace function public.campaign_job_source(p_job_id uuid, p_slug text, p_locale text)
returns table (
  slug text, title text, company_name text, city text, region text, contract_type text,
  accommodation boolean, salary_min integer, salary_max integer, currency text,
  salary_period text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    j.slug,
    coalesce(t.title, j.title) as title,
    c.name as company_name,
    j.city, j.region, j.contract_type::text,
    j.accommodation,
    j.salary_min, j.salary_max, coalesce(j.currency, 'EUR') as currency,
    j.salary_period::text as salary_period
  from public.jobs j
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = p_locale) desc, (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where public.is_supported_locale(p_locale)
    and ((p_job_id is not null and j.id = p_job_id)
         or (p_job_id is null and p_slug is not null and j.slug = left(p_slug, 200)))
    and j.status = 'active'
    and j.deleted_at is null
    and j.is_demo = false
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified'
    and c.deleted_at is null
    and c.is_demo = false
  limit 1;
$$;
revoke all on function public.campaign_job_source(uuid, text, text) from public, anon, authenticated;

create or replace function public.get_campaign_job(p_slug text, p_locale text default 'pl')
returns table (
  slug text, title text, company_name text, city text, region text, contract_type text,
  accommodation boolean, salary_min integer, salary_max integer, currency text,
  salary_period text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.campaign_job_source(null, p_slug, p_locale);
$$;
revoke all on function public.get_campaign_job(text, text) from public;
grant execute on function public.get_campaign_job(text, text) to anon, authenticated, service_role;

create or replace function public.get_managed_campaign_job(p_job_id uuid, p_locale text default 'pl')
returns table (
  slug text, title text, company_name text, city text, region text, contract_type text,
  accommodation boolean, salary_min integer, salary_max integer, currency text,
  salary_period text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.*
  from public.campaign_job_source(p_job_id, null, p_locale) s
  where auth.uid() is not null
    and (public.is_admin()
         or exists (select 1 from public.jobs j
                    where j.id = p_job_id and public.can_manage_jobs(j.company_id)));
$$;
revoke all on function public.get_managed_campaign_job(uuid, text) from public, anon;
grant execute on function public.get_managed_campaign_job(uuid, text) to authenticated;

comment on function public.get_campaign_job(text, text) is
  'Materiały kampanii (#186): tylko publiczne pola aktywnej, niedemonstracyjnej, niewygasłej oferty zweryfikowanej firmy.';
comment on function public.get_managed_campaign_job(uuid, text) is
  'Materiały kampanii w panelu (#175): jak get_campaign_job, tylko dla recruiter+ firmy oferty lub admina.';
