-- =============================================================================
-- 0033_company_rbac.sql
-- Remediacja audytu 2026-07-24 — Wave C2: SEC-09 (RBAC firmy dla operacji rekrutacyjnych).
--
-- Problem: role firmy istniały w schemacie, ale operacje sprawdzały tylko „aktywne członkostwo"
--   (is_company_member) — zwykły `member` mógł tworzyć/publikować/edytować oferty i widzieć PII
--   kandydatów jak recruiter/admin.
--
-- Naprawa: capability helpers (owner/admin/recruiter = „recruiter+") i wpięcie ich w polityki
--   ZAPISU ofert oraz dostęp do PII kandydata. ODCZYT ofert firmowych pozostaje dla każdego
--   członka (is_company_member). Zwykły `member` traci prawa rekrutacyjne.
--   (Bramkowanie propozycji/zmian statusu aplikacji do recruiter+ = follow-up C3; te ścieżki
--    już wymagają członkostwa i przechodzą przez SECURITY DEFINER RPC.)
-- =============================================================================

-- --- Capability helpers: recruiter+ (owner/admin/recruiter) --------------------
create or replace function public.can_manage_jobs(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members cm
    where cm.company_id = p_company_id and cm.profile_id = auth.uid()
      and cm.is_active = true and cm.role in ('owner', 'admin', 'recruiter')
  );
$$;

create or replace function public.is_job_manager(p_job_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.jobs j
    join public.company_members cm on cm.company_id = j.company_id
    where j.id = p_job_id and cm.profile_id = auth.uid()
      and cm.is_active = true and cm.role in ('owner', 'admin', 'recruiter')
  );
$$;

-- --- jobs: ZAPIS wymaga recruiter+ (odczyt bez zmian: członek widzi swoje oferty) ---
drop policy if exists jobs_insert_member on public.jobs;
create policy jobs_insert_member on public.jobs
  for insert to authenticated
  with check (
    public.can_manage_jobs(company_id)
    and (status <> 'active' or public.company_is_verified(company_id))
  );

drop policy if exists jobs_update_member on public.jobs;
create policy jobs_update_member on public.jobs
  for update to authenticated
  using (public.can_manage_jobs(company_id))
  with check (
    public.can_manage_jobs(company_id)
    and (status <> 'active' or public.company_is_verified(company_id))
  );

drop policy if exists jobs_delete_member on public.jobs;
create policy jobs_delete_member on public.jobs
  for delete to authenticated
  using (public.can_manage_jobs(company_id));

-- --- job_* dzieci: ZAPIS wymaga recruiter+ (odczyt: publiczny lub członek — bez zmian) ---
do $$
declare
  t text;
  child text[] := array['job_translations', 'job_requirements', 'job_skills',
                        'job_languages', 'job_certificates'];
begin
  foreach t in array child loop
    execute format('drop policy if exists %I on public.%I;', t || '_insert_member', t);
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (public.is_job_manager(job_id));
    $f$, t || '_insert_member', t);

    execute format('drop policy if exists %I on public.%I;', t || '_update_member', t);
    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (public.is_job_manager(job_id))
        with check (public.is_job_manager(job_id));
    $f$, t || '_update_member', t);

    execute format('drop policy if exists %I on public.%I;', t || '_delete_member', t);
    execute format($f$
      create policy %I on public.%I
        for delete to authenticated
        using (public.is_job_manager(job_id));
    $f$, t || '_delete_member', t);
  end loop;
end $$;

-- --- Dostęp do PII kandydata: recruiter+ (nie każdy członek) --------------------
create or replace function public.company_can_view_candidate(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.applications a
    join public.company_members cm on cm.company_id = a.company_id
    where a.candidate_id = p_profile_id
      and a.deleted_at is null
      and cm.profile_id = auth.uid()
      and cm.is_active = true
      and cm.role in ('owner', 'admin', 'recruiter')
  ) or exists (
    select 1
    from public.offers o
    join public.company_members cm on cm.company_id = o.company_id
    where o.candidate_id = p_profile_id
      and o.deleted_at is null
      and cm.profile_id = auth.uid()
      and cm.is_active = true
      and cm.role in ('owner', 'admin', 'recruiter')
  );
$$;

-- --- publish_job: publikacja wymaga recruiter+ (zamiast każdego członka) --------
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
