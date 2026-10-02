-- Rollback 0203 (#1221): przywraca definicje sprzed migracji — `update_published_job`
-- z 0200, `publish_job` z 0172, `set_job_status` z 0202 (z heurystyką tytułu-zaślepki).
-- Dowód: supabase/tests/job-title-completeness-rollback.sql.

create or replace function public.update_published_job(
  p_job_id uuid, p_content jsonb, p_expected_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid; v_cstatus text; v_status text; v_slug text; v_locale text;
  v_updated timestamptz; v_before jsonb; v_after jsonb;
  j jsonb := coalesce(p_content->'job', '{}'::jsonb);
  tr jsonb := coalesce(p_content->'translation', '{}'::jsonb);
  v_title text;
  v_has_translation boolean; v_has_mandatory boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'VALIDATION_FAILED: brak treści oferty' using errcode = '42501';
  end if;

  -- 0200: migawka audytu z jednego źródła (job_edit_audit_snapshot ⊇ job_material_terms).
  select j0.company_id, c.status::text, j0.status::text, j0.slug, j0.default_locale, j0.updated_at,
         public.job_edit_audit_snapshot(j0)
    into v_company, v_cstatus, v_status, v_slug, v_locale, v_updated, v_before
    from public.jobs j0 join public.companies c on c.id = j0.company_id
    where j0.id = p_job_id and j0.deleted_at is null
    for update of j0;

  if v_company is null then raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002'; end if;
  if not public.can_manage_jobs(v_company) then
    raise exception 'PERMISSION_DENIED: edycja oferty wymaga roli recruiter+' using errcode = '42501';
  end if;
  if v_status not in ('active', 'paused') then
    raise exception 'JOB_NOT_EDITABLE: edytować można ofertę aktywną lub wstrzymaną (stan %)', v_status
      using errcode = '42501';
  end if;
  if v_cstatus <> 'verified' then
    raise exception 'COMPANY_NOT_VERIFIED: firma nie jest zweryfikowana' using errcode = '42501';
  end if;
  if p_expected_updated_at is not null and p_expected_updated_at <> v_updated then
    raise exception 'JOB_EDIT_CONFLICT: oferta zmieniła się w międzyczasie' using errcode = '40001';
  end if;

  v_title := btrim(coalesce(j->>'title', ''));

  -- 0200: kontekst tej rewizji w tabeli bez grantów dla klienta (zamiast GUC z 0144, który
  -- klient mógł ustawić sam przez set_config) — trigger powiadomień reaguje tylko na ten zapis.
  insert into public.job_operation_context (job_id, kind) values (p_job_id, 'job_terms_notify');
  update public.jobs set
    title                    = v_title,
    category                 = (j->>'category')::public.job_category,
    occupation               = nullif(btrim(coalesce(j->>'occupation', '')), ''),
    contract_type            = (j->>'contract_type')::public.contract_type,
    working_hours            = nullif(btrim(coalesce(j->>'working_hours', '')), ''),
    shifts                   = nullif(btrim(coalesce(j->>'shifts', '')), ''),
    start_immediately        = coalesce((j->>'start_immediately')::boolean, false),
    immediate                = coalesce((j->>'start_immediately')::boolean, false),
    start_date               = nullif(j->>'start_date', '')::date,
    city                     = btrim(coalesce(j->>'city', '')),
    region                   = btrim(coalesce(j->>'region', '')),
    address                  = nullif(btrim(coalesce(j->>'address', '')), ''),
    remote                   = coalesce((j->>'remote')::boolean, false),
    salary_min               = (j->>'salary_min')::integer,
    salary_max               = (j->>'salary_max')::integer,
    currency                 = coalesce(nullif(j->>'currency', ''), 'EUR'),
    salary_period            = coalesce(nullif(j->>'salary_period', ''), 'month')::public.salary_period,
    min_experience_years     = (j->>'min_experience_years')::integer,
    requires_driving_license = coalesce((j->>'requires_driving_license')::boolean, false),
    no_language_required     = coalesce((j->>'no_language_required')::boolean, false),
    accommodation            = coalesce((j->>'accommodation')::boolean, false),
    transport                = coalesce((j->>'transport')::boolean, false),
    contact_email            = nullif(btrim(coalesce(j->>'contact_email', '')), ''),
    -- 0169: koszty i dodatki (brak klucza = brak wartości, jak pozostałe pola rewizji).
    accommodation_kind       = nullif(j->>'accommodation_kind', ''),
    accommodation_cost       = (j->>'accommodation_cost')::numeric,
    accommodation_cost_period = nullif(j->>'accommodation_cost_period', ''),
    accommodation_deducted   = (j->>'accommodation_deducted')::boolean,
    accommodation_registration = (j->>'accommodation_registration')::boolean,
    accommodation_after_contract = nullif(j->>'accommodation_after_contract', ''),
    transport_shuttle        = coalesce((j->>'transport_shuttle')::boolean, false),
    transport_reimbursed     = coalesce((j->>'transport_reimbursed')::boolean, false),
    meal_voucher_daily       = (j->>'meal_voucher_daily')::numeric,
    joint_committee          = nullif(j->>'joint_committee', ''),
    -- 0172: kanał aplikowania (brak klucza = brak wartości; co najmniej jeden wymagany niżej).
    apply_url                = nullif(btrim(coalesce(j->>'apply_url', '')), ''),
    apply_email              = nullif(btrim(coalesce(j->>'apply_email', '')), ''),
    apply_phone              = nullif(btrim(coalesce(j->>'apply_phone', '')), ''),
    -- 0194 (#811): wymiar czasu pracy (brak klucza = brak deklaracji; przeniesione z main).
    work_time                = nullif(j->>'work_time', ''),
    updated_at               = now()
  where id = p_job_id;
  delete from public.job_operation_context
   where tx = pg_current_xact_id() and job_id = p_job_id and kind = 'job_terms_notify';

  -- 0172: oferta opublikowana nie może stracić kanału aplikowania (błąd cofa całą rewizję).
  if not exists (select 1 from public.jobs where id = p_job_id and public.job_has_apply_channel(jobs)) then
    raise exception 'JOB_APPLY_CHANNEL_REQUIRED: oferta wymaga adresu strony, e-maila albo telefonu do aplikowania'
      using errcode = '23514';
  end if;

  insert into public.job_translations (job_id, locale, title, working_hours, shifts, description,
                                       responsibilities, conditions, benefits, highlights,
                                       company_description)
  values (
    p_job_id, v_locale, v_title,
    nullif(btrim(coalesce(j->>'working_hours', '')), ''),
    nullif(btrim(coalesce(j->>'shifts', '')), ''),
    coalesce(tr->>'description', ''),
    array(select jsonb_array_elements_text(coalesce(tr->'responsibilities', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(tr->'conditions', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(tr->'benefits', '[]'::jsonb))),
    array(select x from jsonb_array_elements_text(coalesce(tr->'benefits', '[]'::jsonb)) x limit 4),
    coalesce(tr->>'company_description', '')
  )
  on conflict (job_id, locale) do update set
    title = excluded.title, working_hours = excluded.working_hours, shifts = excluded.shifts,
    description = excluded.description, responsibilities = excluded.responsibilities,
    conditions = excluded.conditions, benefits = excluded.benefits,
    highlights = excluded.highlights, company_description = excluded.company_description;

  -- Relacje replace-all tymi samymi funkcjami co kreator; kontekst operacji (0200, zamiast GUC
  -- z 0077) dopuszcza ofertę nie-szkic tylko na czas tych wywołań.
  insert into public.job_operation_context (job_id, kind) values (p_job_id, 'job_edit');
  perform public.set_job_requirements(p_job_id, v_locale, 'mandatory',
    array(select jsonb_array_elements_text(coalesce(p_content->'requirements_mandatory', '[]'::jsonb))));
  perform public.set_job_requirements(p_job_id, v_locale, 'optional',
    array(select jsonb_array_elements_text(coalesce(p_content->'requirements_optional', '[]'::jsonb))));
  -- Najpierw zakres dodatkowy, potem obowiązkowy: etykieta w obu listach kończy jako obowiązkowa.
  perform public.set_job_skills(p_job_id, false,
    array(select jsonb_array_elements_text(coalesce(p_content->'skills_optional', '[]'::jsonb))));
  perform public.set_job_skills(p_job_id, true,
    array(select jsonb_array_elements_text(coalesce(p_content->'skills_mandatory', '[]'::jsonb))));
  perform public.set_job_languages(p_job_id, coalesce(p_content->'languages', '[]'::jsonb));
  perform public.set_job_certificates(p_job_id,
    array(select jsonb_array_elements_text(coalesce(p_content->'certificates', '[]'::jsonb))));
  delete from public.job_operation_context
   where tx = pg_current_xact_id() and job_id = p_job_id and kind = 'job_edit';

  -- Kompletność jak w publish_job (0073) — po zapisie, więc błąd cofa całą rewizję.
  if v_title = '' or v_title ilike 'draft%' or v_title ilike '%placeholder%'
     or btrim(coalesce(j->>'city', '')) = '' or btrim(coalesce(j->>'region', '')) = '' then
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

  select public.job_edit_audit_snapshot(j1), j1.updated_at
    into v_after, v_updated from public.jobs j1 where j1.id = p_job_id;
  perform public.write_audit('job.update_published', 'job', p_job_id, v_before, v_after);

  return jsonb_build_object('slug', v_slug, 'updated_at', v_updated);
end $$;
revoke all on function public.update_published_job(uuid, jsonb, timestamptz) from public;
grant execute on function public.update_published_job(uuid, jsonb, timestamptz) to authenticated;

create or replace function public.publish_job(p_job_id uuid, p_slug text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid; v_cstatus text; v_status text;
  v_title text; v_city text; v_region text; v_slug text; v_new_slug text;
  v_has_translation boolean; v_has_mandatory boolean;
  v_expires timestamptz; v_has_channel boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  select j.company_id, c.status::text, j.status::text, j.title, j.city, j.region, j.slug, j.expires_at,
         public.job_has_apply_channel(j)
    into v_company, v_cstatus, v_status, v_title, v_city, v_region, v_slug, v_expires, v_has_channel
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
  -- #72: szkic z datą ważności w przeszłości (lub równą teraz) nie staje się „aktywny”
  -- niewidoczny publicznie. Daty nie czyścimy po cichu — użytkownik ustawia nową.
  if v_expires is not null and v_expires <= now() then
    raise exception 'JOB_EXPIRED: termin ważności oferty minął' using errcode = '42501';
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

  -- 0172: kandydat aplikuje u ogłoszeniodawcy — oferta publiczna musi wskazać kanał.
  if not v_has_channel then
    raise exception 'JOB_APPLY_CHANNEL_REQUIRED: oferta wymaga adresu strony, e-maila albo telefonu do aplikowania'
      using errcode = '23514';
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

  -- #295: potwierdzenie publikacji dla publikującego (w jego języku — enqueue_email).
  if public.company_recipient_ok(v_company, auth.uid()) then
    perform public.enqueue_email(auth.uid(), 'jobPublished', 'job', p_job_id,
                                 'jobpub-' || p_job_id::text,
                                 jsonb_build_object('jobTitle', v_title));
  end if;

  return v_new_slug;
end $$;
revoke all on function public.publish_job(uuid, text) from public;
grant execute on function public.publish_job(uuid, text) to authenticated;

create or replace function public.set_job_status(p_job_id uuid, p_action text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid; v_cstatus text; v_status text; v_target text;
  v_title text; v_city text; v_region text;
  v_has_translation boolean; v_has_mandatory boolean;
  v_expires timestamptz; v_past_due boolean;
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

  v_past_due := v_expires is not null and v_expires <= now();

  -- #72: wznowienie po terminie wymaga świadomego ponownego otwarcia (które usuwa datę).
  if p_action = 'resume' and v_status = 'paused' and v_past_due then
    raise exception 'JOB_EXPIRED: termin ważności oferty minął — otwórz ją ponownie' using errcode = '42501';
  end if;

  v_target := case
    when p_action = 'pause'  and v_status = 'active' and not v_past_due then 'paused'
    when p_action = 'resume' and v_status = 'paused'               then 'active'
    when p_action = 'close'  and v_status in ('active', 'paused')  then 'closed'
    when p_action = 'reopen' and v_status in ('closed', 'expired') then 'active'
    when p_action = 'reopen' and v_status in ('active', 'paused') and v_past_due then 'active'
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
        -- Przeszłą datę usuwa tylko ponowne otwarcie (resume po terminie jest odrzucane wyżej).
        expires_at = case
          when p_action = 'reopen' and v_past_due then null
          else expires_at
        end,
        -- #1222 (decyzja właściciela 29.09.2026): ponowne otwarcie = nowa publikacja — alerty
        -- zapisanych wyszukiwań, filtr daty i sort „najnowsze” widzą ofertę jak świeżą.
        published_at = case
          when p_action = 'reopen' then now()
          when v_target = 'active' and published_at is null then now()
          else published_at
        end,
        updated_at = now()
    where id = p_job_id and status::text = v_status;
  if not found then
    raise exception 'VALIDATION_FAILED: oferta zmieniła stan równolegle' using errcode = '42501';
  end if;

  return v_target;
end $$;
revoke all on function public.set_job_status(uuid, text) from public;
grant execute on function public.set_job_status(uuid, text) to authenticated;
