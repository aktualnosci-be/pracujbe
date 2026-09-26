-- 0144_job_terms_changed_notify.sql — powiadomienie kandydatów o istotnej zmianie warunków
-- opublikowanej oferty (numer tymczasowy; ostateczny nada integrator).
--
-- CLAUDE.md „Edycja opublikowanej oferty — Otwarte” (#325): kandydat, który już aplikował,
-- dostaje powiadomienie in-app (bez e-maila — bezpieczny wariant bez decyzji produktowej), gdy
-- rekruter zmieni w opublikowanej ofercie wynagrodzenie, miasto, typ umowy albo godziny pracy.
--
-- 1. `job_material_terms(jobs)` — JEDYNE miejsce z listą pól „istotnych warunków”.
-- 2. Trigger AFTER UPDATE na `jobs`: porównanie starych i nowych warunków w tej samej
--    transakcji co zapis — WYŁĄCZNIE dla zapisu z `update_published_job` (redefinicja poniżej
--    ustawia lokalny znacznik `pracujbe.job_terms_notify` = id oferty tuż przed UPDATE i czyści
--    go po nim). Bezpośredni UPDATE (service_role, migracje danych, pauza/wznowienie,
--    moderacja) nie powiadamia. Błąd walidacji w dalszej części RPC cofa też powiadomienia.
--    Miasto porównywane przez `search_fold` (sama wielkość liter/diakrytyki ≠ zmiana).
-- 3. Odbiorcy: kandydaci z AKTYWNĄ aplikacją (submitted, viewed, shortlisted, interview,
--    offer_sent, offer_accepted); bez gości (brak konta = brak in-app), bez szkiców i stanów
--    końcowych. Jedno powiadomienie na kandydata na zapis. Preferencja `in_app_enabled`
--    działa jak dla innych powiadomień (trigger z 0035).
-- 4. Tytuł renderuje aplikacja z klucza i18n w języku panelu odbiorcy (Invariant #1); w bazie
--    tylko `data` = rodzaj, slug oferty i nazwy zmienionych pól (bez kwot i treści). Link
--    prowadzi do historii zgłoszeń (oferta wstrzymana/zamknięta/wygasła nie ma publicznej strony).
-- 5. `update_published_job` = treść z 0077 bez zmian poza ustawieniem/wyczyszczeniem znacznika.
--
-- Rollback: `drop trigger trg_notify_job_terms_changed on public.jobs;
--            drop function public.notify_job_terms_changed(); drop function public.job_material_terms(public.jobs);`
--           + ponowne `create or replace function public.update_published_job` z 0077.

create or replace function public.job_material_terms(j public.jobs)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'salary', jsonb_build_object('min', j.salary_min, 'max', j.salary_max,
                                 'period', j.salary_period, 'currency', j.currency),
    'city', public.search_fold(btrim(coalesce(j.city, ''))),
    'contract_type', j.contract_type,
    'working_hours', j.working_hours
  )
$$;
revoke all on function public.job_material_terms(public.jobs) from public;

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

create trigger trg_notify_job_terms_changed
  after update on public.jobs
  for each row
  when (old.status in ('active', 'paused') and new.status = old.status and new.deleted_at is null)
  execute function public.notify_job_terms_changed();

-- --- update_published_job (0077) + znacznik rewizji dla triggera powiadomień -----------------
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
    updated_at               = now()
  where id = p_job_id;
  perform set_config('pracujbe.job_terms_notify', '', true);

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
