-- =============================================================================
-- Rollback 0975_company_description_locale.sql (#708) — ręczny, NIE jest migracją.
-- Przywraca `get_public_company` z 0140 (bez `description_locale`), usuwa RPC, trigger,
-- CHECK i kolumnę. Test: supabase/tests/company-description-locale-rollback.sql.
-- =============================================================================

drop function if exists public.set_company_description_locale(uuid, text);
drop trigger if exists trg_reset_company_description_locale on public.companies;
drop function if exists public.reset_company_description_locale();
alter table public.companies drop constraint if exists companies_description_locale_requires_text;

drop function if exists public.get_public_company(text);
create function public.get_public_company(p_slug text)
returns table (
  id uuid, slug text, name text, description text, city text, region text, industry text,
  logo_url text, website text, active_jobs_count bigint
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    c.id, c.slug, c.name, coalesce(c.description, '') as description,
    c.city, c.region, c.industry,
    public.public_https_url(c.logo_url) as logo_url,
    public.public_https_url(c.website) as website,
    (
      select count(*) from public.jobs j
      where j.company_id = c.id and j.status = 'active' and j.deleted_at is null
        and (j.expires_at is null or j.expires_at > now())
    ) as active_jobs_count
  from public.companies c
  where c.slug = p_slug
    and c.status = 'verified'
    and c.deleted_at is null
  limit 1;
$$;

revoke all on function public.get_public_company(text) from public;
grant execute on function public.get_public_company(text) to anon, authenticated, service_role;

alter table public.companies drop column if exists description_locale;
