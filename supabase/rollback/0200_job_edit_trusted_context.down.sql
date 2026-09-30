-- =============================================================================
-- Rollback 0200_job_edit_trusted_context.sql — przywraca definicje sprzed migracji:
-- assert_job_draft_or_editing (0077), notify_job_terms_changed (0144), update_published_job (0194),
-- a potem usuwa migawkę audytu, funkcje kontekstu i tabelę job_operation_context.
-- UWAGA: przywraca też lukę #752/#753 (znaczniki GUC ustawialne przez klienta).
-- Test: supabase/tests/job-edit-context-rollback.sql (scripts/test-rls.sh).
-- =============================================================================

create or replace function public.assert_job_draft_or_editing(p_job_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text;
begin
  select status::text into v_status from public.jobs where id = p_job_id and deleted_at is null;
  if v_status is null then
    raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002';
  end if;
  if v_status <> 'draft'
     and coalesce(current_setting('pracujbe.job_edit', true), '') <> p_job_id::text then
    raise exception 'JOB_NOT_DRAFT: treść opublikowanej oferty zmienia wyłącznie update_published_job'
      using errcode = '42501';
  end if;
end $$;
revoke all on function public.assert_job_draft_or_editing(uuid) from public;

create or replace function public.notify_job_terms_changed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb := public.job_material_terms(old);
  v_new jsonb := public.job_material_terms(new);
  v_fields text[];
begin
  if coalesce(current_setting('pracujbe.job_terms_notify', true), '') <> new.id::text then
    return null;
  end if;
  if v_old is not distinct from v_new then
    return null;
  end if;
  select array_agg(k order by k) into v_fields
    from jsonb_object_keys(v_new) k
   where v_old -> k is distinct from v_new -> k;

  insert into public.notifications (profile_id, type, data, entity_type, entity_id)
  select distinct a.candidate_id, 'system'::public.notification_type,
         jsonb_build_object('kind', 'job_terms_changed', 'slug', new.slug, 'fields', to_jsonb(v_fields)),
         'job_terms', new.id
    from public.applications a
   where a.job_id = new.id
     and a.candidate_id is not null
     and a.deleted_at is null
     and a.status::text in ('submitted', 'viewed', 'shortlisted', 'interview',
                            'offer_sent', 'offer_accepted');
  return null;
end $$;
revoke all on function public.notify_job_terms_changed() from public;

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

  select j0.company_id, c.status::text, j0.status::text, j0.slug, j0.default_locale, j0.updated_at,
         jsonb_build_object('title', j0.title, 'city', j0.city, 'region', j0.region,
                            'salary_min', j0.salary_min, 'salary_max', j0.salary_max,
                            'start_date', j0.start_date, 'contract_type', j0.contract_type)
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

  -- 0144: znacznik tej rewizji — trigger powiadomień reaguje tylko na zapis z tego RPC.
  perform set_config('pracujbe.job_terms_notify', p_job_id::text, true);
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
    -- 0194 (#811): wymiar czasu pracy (brak klucza = brak deklaracji).
    work_time                = nullif(j->>'work_time', ''),
    updated_at               = now()
  where id = p_job_id;
  perform set_config('pracujbe.job_terms_notify', '', true);

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

  -- Relacje replace-all tymi samymi funkcjami co kreator; znacznik dopuszcza ofertę nie-szkic.
  perform set_config('pracujbe.job_edit', p_job_id::text, true);
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
  perform set_config('pracujbe.job_edit', '', true);

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

  select jsonb_build_object('title', title, 'city', city, 'region', region,
                            'salary_min', salary_min, 'salary_max', salary_max,
                            'start_date', start_date, 'contract_type', contract_type),
         updated_at
    into v_after, v_updated from public.jobs where id = p_job_id;
  perform public.write_audit('job.update_published', 'job', p_job_id, v_before, v_after);

  return jsonb_build_object('slug', v_slug, 'updated_at', v_updated);
end $$;
revoke all on function public.update_published_job(uuid, jsonb, timestamptz) from public;
grant execute on function public.update_published_job(uuid, jsonb, timestamptz) to authenticated;

drop function public.job_edit_audit_snapshot(public.jobs);
drop function public.job_operation_context_take(uuid, text);
drop function public.job_operation_context_active(uuid, text);
drop table public.job_operation_context;
