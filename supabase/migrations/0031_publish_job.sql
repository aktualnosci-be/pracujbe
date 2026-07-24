-- =============================================================================
-- 0031_publish_job.sql
-- Remediacja audytu 2026-07-24 — Wave E3: FUN-01 (można było opublikować niekompletną ofertę).
--
-- Problem: publikacja robiła bezpośredni UPDATE jobs SET status='active', sprawdzając tylko
--   weryfikację firmy — bez kontroli kompletności ani statusu draft. Rekord z pustym/placeholder
--   tytułem, bez tłumaczenia i wymagań mógł stać się aktywny (publiczny).
--
-- Naprawa: transakcyjne RPC `publish_job` (autoryzacja + weryfikacja firmy + status=draft +
--   kompletność) oraz guard trigger, który blokuje aktywację oferty przez KLIENTA inaczej niż
--   przez to RPC (active tylko przez publish_job). Pauza/zamknięcie/szkic pozostają dozwolone.
-- =============================================================================

-- --- Guard: aktywacja oferty tylko przez zaufany RPC --------------------------
-- SECURITY INVOKER (widzi realną rolę). Definer publish_job (właściciel postgres), seed i admin
-- przechodzą; klient (authenticated/anon) nie może ustawić status='active' bezpośrednio.
create or replace function public.guard_job_publish()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' and new.status = 'active' then
    raise exception 'PERMISSION_DENIED: oferta nie może powstać od razu jako aktywna'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status = 'active' and old.status is distinct from 'active' then
    raise exception 'PERMISSION_DENIED: publikacja oferty wyłącznie przez publish_job'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_job_publish on public.jobs;
create trigger trg_guard_job_publish
  before insert or update on public.jobs
  for each row execute function public.guard_job_publish();

-- --- Transakcyjna publikacja z kontrolą kompletności --------------------------
-- Zwraca finalny slug. p_slug używany, gdy bieżący slug jest techniczny (draft-…).
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
  if not public.is_company_member(v_company) then
    raise exception 'PERMISSION_DENIED: brak członkostwa w firmie oferty' using errcode = '42501';
  end if;
  if v_cstatus <> 'verified' then
    raise exception 'COMPANY_NOT_VERIFIED: firma nie jest zweryfikowana' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'VALIDATION_FAILED: publikować można tylko szkic' using errcode = '42501';
  end if;

  -- Kompletność: tytuł/miasto/region niepuste i bez placeholderów (category/contract_type są NOT NULL).
  if v_title is null or btrim(v_title) = '' or v_title ilike 'draft%' or v_title ilike '%placeholder%'
     or v_city is null or btrim(v_city) = ''
     or v_region is null or btrim(v_region) = '' then
    raise exception 'VALIDATION_FAILED: oferta niekompletna (tytuł/miasto/region)' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.job_translations t
    where t.job_id = p_job_id and coalesce(btrim(t.title), '') <> ''
  ) into v_has_translation;
  if not v_has_translation then
    raise exception 'VALIDATION_FAILED: brak kompletnego tłumaczenia oferty' using errcode = '42501';
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
