-- =============================================================================
-- 0062_free_job_lifecycle.sql
-- Część #51: bezpłatne publikowanie i zarządzanie cyklem życia ofert.
--
-- Publikacja, wznowienie i ponowne otwarcie nie zależą już od planu ani aktywnej
-- subskrypcji. Pozostają wszystkie granice bezpieczeństwa z 0055/0056:
-- uwierzytelnienie, rola recruiter+, zweryfikowana firma, kompletność oferty,
-- macierz stanów, blokada wiersza i CAS oraz guard przed bezpośrednim UPDATE.
-- Katalog uprawnień i tabele billingowe pozostają dla zgodności i historii.
-- =============================================================================

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
    where j.id = p_job_id and j.deleted_at is null
    for update of j;

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
    where id = p_job_id and status = 'draft';
  if not found then
    raise exception 'VALIDATION_FAILED: oferta zmieniła stan równolegle' using errcode = '42501';
  end if;

  return v_new_slug;
end $$;
revoke all on function public.publish_job(uuid, text) from public;
grant execute on function public.publish_job(uuid, text) to authenticated;

create or replace function public.set_job_status(p_job_id uuid, p_action text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_company uuid; v_cstatus text; v_status text; v_target text;
  v_title text; v_city text; v_region text;
  v_has_translation boolean; v_has_mandatory boolean;
  v_expires timestamptz;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_action not in ('pause', 'resume', 'close', 'reopen') then
    raise exception 'VALIDATION_FAILED: nieznana operacja' using errcode = '42501';
  end if;

  select j.company_id, c.status::text, j.status::text, j.title, j.city, j.region, j.expires_at
    into v_company, v_cstatus, v_status, v_title, v_city, v_region, v_expires
    from public.jobs j join public.companies c on c.id = j.company_id
    where j.id = p_job_id and j.deleted_at is null
    for update of j;

  if v_company is null then raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002'; end if;
  if not public.can_manage_jobs(v_company) then
    raise exception 'PERMISSION_DENIED: zarządzanie ofertą wymaga roli recruiter+' using errcode = '42501';
  end if;

  v_target := case
    when p_action = 'pause'  and v_status = 'active'               then 'paused'
    when p_action = 'resume' and v_status = 'paused'               then 'active'
    when p_action = 'close'  and v_status in ('active', 'paused')  then 'closed'
    when p_action = 'reopen' and v_status in ('closed', 'expired') then 'active'
    else null
  end;
  if v_target is null then
    raise exception 'VALIDATION_FAILED: niedozwolone przejście % z stanu %', p_action, v_status
      using errcode = '42501';
  end if;

  if v_target = 'active' then
    if v_cstatus <> 'verified' then
      raise exception 'COMPANY_NOT_VERIFIED: firma nie jest zweryfikowana' using errcode = '42501';
    end if;

    if p_action = 'reopen' then
      if v_title is null or btrim(v_title) = '' or v_title ilike 'draft%' or v_title ilike '%placeholder%'
         or v_city is null or btrim(v_city) = '' or v_region is null or btrim(v_region) = '' then
        raise exception 'VALIDATION_FAILED: oferta niekompletna (tytuł/miasto/region)' using errcode = '42501';
      end if;
      select exists (
        select 1 from public.job_translations t
        where t.job_id = p_job_id
          and coalesce(btrim(t.title), '') <> ''
          and coalesce(btrim(t.description), '') <> ''
          and coalesce(array_length(t.responsibilities, 1), 0) > 0
      ) into v_has_translation;
      if not v_has_translation then
        raise exception 'VALIDATION_FAILED: oferta niekompletna (opis i obowiązki)' using errcode = '42501';
      end if;
      select exists (
        select 1 from public.job_requirements r
        where r.job_id = p_job_id and r.kind = 'mandatory' and coalesce(btrim(r.content), '') <> ''
      ) into v_has_mandatory;
      if not v_has_mandatory then
        raise exception 'VALIDATION_FAILED: brak wymagań obowiązkowych' using errcode = '42501';
      end if;
    end if;
  end if;

  update public.jobs
    set status = v_target::public.job_status,
        expires_at = case
          when v_target = 'active' and v_expires is not null and v_expires <= now() then null
          else expires_at
        end,
        published_at = case when v_target = 'active' and published_at is null then now() else published_at end,
        updated_at = now()
    where id = p_job_id and status::text = v_status;
  if not found then
    raise exception 'VALIDATION_FAILED: oferta zmieniła stan równolegle' using errcode = '42501';
  end if;

  return v_target;
end $$;
revoke all on function public.set_job_status(uuid, text) from public;
grant execute on function public.set_job_status(uuid, text) to authenticated;
