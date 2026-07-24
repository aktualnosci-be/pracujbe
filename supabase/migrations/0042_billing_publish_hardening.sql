-- =============================================================================
-- 0042_billing_publish_hardening.sql
-- Remediacja audytu produkcyjnego 2026-07-24 — P1-11 + P1-16.
--
-- P1-11: publish_job wymagał tylko tytułu/miasta/regionu + tłumaczenia (sam tytuł) + wymagania
--        obowiązkowego. Można było opublikować ofertę praktycznie pustą. Dokładamy wymóg
--        NIEPUSTEGO OPISU i ≥1 OBOWIĄZKU w tłumaczeniu. (Zakres widełek salary_min<=salary_max
--        jest już egzekwowany CHECK-iem jobs_salary_range_chk na tabeli — 0003.)
--
-- P1-16: brak trwałego provider_customer_id na firmie → każdy checkout przed pierwszą subskrypcją
--        (lub po porzuconym checkoutcie) tworzył NOWEGO klienta Stripe. Dodajemy kolumnę na
--        companies (zapisywaną service-rolem w startCheckout), aby reużywać jednego klienta.
-- =============================================================================

-- --- P1-16: trwały identyfikator klienta płatności na firmie -------------------
alter table public.companies add column if not exists provider_customer_id text;
create index if not exists idx_companies_provider_customer
  on public.companies (provider_customer_id) where provider_customer_id is not null;

-- --- P1-11: twardsza walidacja kompletności przy publikacji --------------------
create or replace function public.publish_job(p_job_id uuid, p_slug text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_company uuid; v_cstatus text; v_status text;
  v_title text; v_city text; v_region text; v_slug text; v_new_slug text;
  v_has_translation boolean; v_has_mandatory boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  select j.company_id, c.status::text, j.status::text, j.title, j.city, j.region, j.slug
    into v_company, v_cstatus, v_status, v_title, v_city, v_region, v_slug
    from public.jobs j join public.companies c on c.id = j.company_id
    where j.id = p_job_id and j.deleted_at is null;

  if v_company is null then raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002'; end if;
  if not public.can_manage_jobs(v_company) then
    raise exception 'PERMISSION_DENIED: publikacja wymaga roli recruiter+' using errcode = '42501';
  end if;
  if v_cstatus <> 'verified' then
    raise exception 'COMPANY_NOT_VERIFIED: firma nie jest zweryfikowana' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'VALIDATION_FAILED: publikować można tylko szkic' using errcode = '42501';
  end if;

  if v_title is null or btrim(v_title) = '' or v_title ilike 'draft%' or v_title ilike '%placeholder%'
     or v_city is null or btrim(v_city) = ''
     or v_region is null or btrim(v_region) = '' then
    raise exception 'VALIDATION_FAILED: oferta niekompletna (tytuł/miasto/region)' using errcode = '42501';
  end if;

  -- P1-11: tłumaczenie musi mieć tytuł + NIEPUSTY OPIS + ≥1 OBOWIĄZEK (nie pusta oferta).
  select exists (
    select 1 from public.job_translations t
    where t.job_id = p_job_id
      and coalesce(btrim(t.title), '') <> ''
      and coalesce(btrim(t.description), '') <> ''
      and coalesce(array_length(t.responsibilities, 1), 0) > 0
  ) into v_has_translation;
  if not v_has_translation then
    raise exception 'VALIDATION_FAILED: oferta niekompletna (opis i obowiązki w tłumaczeniu)'
      using errcode = '42501';
  end if;

  select exists (
    select 1 from public.job_requirements r
    where r.job_id = p_job_id and r.kind = 'mandatory' and coalesce(btrim(r.content), '') <> ''
  ) into v_has_mandatory;
  if not v_has_mandatory then
    raise exception 'VALIDATION_FAILED: brak wymagań obowiązkowych' using errcode = '42501';
  end if;

  v_new_slug := case
    when v_slug is null or v_slug like 'draft-%'
      then left(coalesce(nullif(btrim(p_slug), ''), 'oferta'), 120)
    else v_slug
  end;

  update public.jobs
    set status = 'active', published_at = now(), slug = v_new_slug
    where id = p_job_id;

  return v_new_slug;
end $$;
revoke all on function public.publish_job(uuid, text) from public;
grant execute on function public.publish_job(uuid, text) to authenticated;
