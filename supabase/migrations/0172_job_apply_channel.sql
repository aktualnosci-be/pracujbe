-- =============================================================================
-- 0172_job_apply_channel.sql — kanał aplikowania u ogłoszeniodawcy.
--
-- Decyzja produktowa: portal ogłoszeniowy — kandydat aplikuje bezpośrednio u autora
-- ogłoszenia. Oferta niesie więc kanał wskazany przez pracodawcę: strona (https), e-mail
-- lub telefon. Co najmniej jeden jest wymagany do publikacji (decyzja właściciela 28.09.2026).
--
-- 1. Reguły formatu jako funkcje IMMUTABLE (lustro TS: src/lib/job-apply-channel.ts, zgodność
--    pilnuje tests/unit/job-apply-channel.test.ts):
--      * `job_apply_url_ok` — bezwzględny https, host z kropką, port 1–65535, bez spacji,
--        cudzysłowów i nawiasów kątowych, 12–2048 znaków, bez białych znaków na brzegach;
--      * `job_apply_email_ok` — adres bez parametrów `mailto:` (`?`, `&`, `%`, spacji),
--        część lokalna ≤ 64, całość ≤ 254, domena z TLD literowym;
--      * `job_apply_phone_ok` — format międzynarodowy `+` i 8–15 cyfr (aplikacja normalizuje
--        spacje, kropki, myślniki i prefiks 00);
--      * `job_has_apply_channel(jobs)` — co najmniej jeden kanał ustawiony.
-- 2. Kolumny `jobs.apply_url` / `apply_email` / `apply_phone` + CHECK-i (każda ścieżka zapisu,
--    także bezpośredni DML szkicu). Szkic może nie mieć kanału.
-- 3. `save_job_draft` (0169) — nowe klucze kroku 9.
-- 4. `update_published_job` (0169) — kolumny rewizji; rewizja bez kanału →
--    JOB_APPLY_CHANNEL_REQUIRED (cofa całą rewizję).
-- 5. `publish_job` (0085) — szkic bez kanału → JOB_APPLY_CHANNEL_REQUIRED. Reszta 1:1 z 0085.
--    Wznowienie/ponowne otwarcie (`set_job_status`) bez zmian: kanału oferty po publikacji nie
--    da się usunąć (update_published_job wyżej, strażnik `guard_published_job_content` 0077
--    dla bezpośredniego DML), a portal nie ma ofert produkcyjnych sprzed tej migracji.
-- 6. `get_public_job` (0140) + `apply_url`, `apply_email`, `apply_phone` na końcu listy —
--    tylko dla oferty publicznej (bramki WHERE bez zmian). `get_public_jobs` bez zmian.
-- 7. „Kopiuj jako szkic” (0148) — kanał przenosi trigger na `job_duplications` (jak 0169).
--
-- Rollback (nowa migracja): drop trigger trg_job_duplications_copy_apply_channel + funkcja;
-- odtworzyć get_public_job z 0140 (drop + create), publish_job z 0085, save_job_draft
-- i update_published_job z 0169; alter table jobs drop constraint jobs_apply_*,
-- drop column apply_url/apply_email/apply_phone; drop function job_has_apply_channel(jobs),
-- job_apply_url_ok, job_apply_email_ok, job_apply_phone_ok.
-- =============================================================================

-- --- 1. Reguły formatu ------------------------------------------------------------------------
create or replace function public.job_apply_url_ok(p_url text)
returns boolean language sql immutable parallel safe set search_path = public, pg_temp as $$
  select p_url is not null
     and p_url = btrim(p_url)
     and length(p_url) between 12 and 2048
     and p_url ~ '^https://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+(:(6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?([/?#][A-Za-z0-9._~!$&''()*+,;=:@%/?#-]*)?$'
$$;

create or replace function public.job_apply_email_ok(p_email text)
returns boolean language sql immutable parallel safe set search_path = public, pg_temp as $$
  select p_email is not null
     and length(p_email) <= 254
     and length(split_part(p_email, '@', 1)) <= 64
     and p_email ~ '^[A-Za-z0-9_+-]+(\.[A-Za-z0-9_+-]+)*@([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$'
$$;

create or replace function public.job_apply_phone_ok(p_phone text)
returns boolean language sql immutable parallel safe set search_path = public, pg_temp as $$
  select p_phone is not null and p_phone ~ '^\+[1-9][0-9]{7,14}$'
$$;

revoke all on function public.job_apply_url_ok(text) from public;
revoke all on function public.job_apply_email_ok(text) from public;
revoke all on function public.job_apply_phone_ok(text) from public;
grant execute on function public.job_apply_url_ok(text) to anon, authenticated, service_role;
grant execute on function public.job_apply_email_ok(text) to anon, authenticated, service_role;
grant execute on function public.job_apply_phone_ok(text) to anon, authenticated, service_role;

-- --- 2. Kolumny oferty --------------------------------------------------------------------------
alter table public.jobs
  add column apply_url text,
  add column apply_email text,
  add column apply_phone text,
  add constraint jobs_apply_url_format check (apply_url is null or public.job_apply_url_ok(apply_url)),
  add constraint jobs_apply_email_format check (apply_email is null or public.job_apply_email_ok(apply_email)),
  add constraint jobs_apply_phone_format check (apply_phone is null or public.job_apply_phone_ok(apply_phone));

comment on column public.jobs.apply_url is
  '0172: strona aplikowania u ogłoszeniodawcy (https). Publiczna dla oferty publicznej.';
comment on column public.jobs.apply_email is
  '0172: e-mail do aplikowania u ogłoszeniodawcy. Publiczny dla oferty publicznej.';
comment on column public.jobs.apply_phone is
  '0172: telefon do aplikowania (+ i cyfry). Publiczny dla oferty publicznej.';

create or replace function public.job_has_apply_channel(j public.jobs)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select j.apply_url is not null or j.apply_email is not null or j.apply_phone is not null
$$;
revoke all on function public.job_has_apply_channel(public.jobs) from public;
grant execute on function public.job_has_apply_channel(public.jobs) to authenticated, service_role;

-- --- 3. save_job_draft (0169) + kanał aplikowania -------------------------------------------------
create or replace function public.save_job_draft(p_job_id uuid, p_content jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid; v_status text; v_locale text; v_title text;
  j jsonb := coalesce(p_content->'job', '{}'::jsonb);
  tr jsonb := coalesce(p_content->'translation', '{}'::jsonb);
  v_bad text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object'
     or jsonb_typeof(j) <> 'object' or jsonb_typeof(tr) <> 'object' then
    raise exception 'VALIDATION_FAILED: brak treści kroku' using errcode = '42501';
  end if;

  select k into v_bad from jsonb_object_keys(j) k
    where k not in ('title', 'category', 'occupation', 'contract_type', 'working_hours', 'shifts',
                    'start_immediately', 'start_date', 'city', 'region', 'address', 'remote',
                    'salary_min', 'salary_max', 'currency', 'salary_period',
                    'min_experience_years', 'requires_driving_license', 'no_language_required',
                    'accommodation', 'transport', 'contact_email',
                    -- 0169: koszty i dodatki
                    'accommodation_kind', 'accommodation_cost', 'accommodation_cost_period',
                    'accommodation_deducted', 'accommodation_registration',
                    'accommodation_after_contract', 'transport_shuttle', 'transport_reimbursed',
                    'meal_voucher_daily', 'joint_committee',
                    -- 0172: kanał aplikowania u ogłoszeniodawcy
                    'apply_url', 'apply_email', 'apply_phone')
    limit 1;
  if v_bad is null then
    select k into v_bad from jsonb_object_keys(tr) k
      where k not in ('description', 'responsibilities', 'conditions', 'benefits',
                      'company_description')
      limit 1;
  end if;
  if v_bad is not null then
    raise exception 'VALIDATION_FAILED: nieznane pole %', v_bad using errcode = '42501';
  end if;

  select j0.company_id, j0.status::text, j0.default_locale
    into v_company, v_status, v_locale
    from public.jobs j0
    where j0.id = p_job_id and j0.deleted_at is null
    for update;

  if v_company is null then raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002'; end if;
  if not public.can_manage_jobs(v_company) then
    raise exception 'PERMISSION_DENIED: edycja oferty wymaga roli recruiter+' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'JOB_NOT_DRAFT: kreator zapisuje wyłącznie szkic' using errcode = '42501';
  end if;

  if j <> '{}'::jsonb then
    update public.jobs set
      title                    = case when j ? 'title' then btrim(coalesce(j->>'title', '')) else title end,
      category                 = case when j ? 'category' then (j->>'category')::public.job_category else category end,
      occupation               = case when j ? 'occupation' then nullif(btrim(coalesce(j->>'occupation', '')), '') else occupation end,
      contract_type            = case when j ? 'contract_type' then (j->>'contract_type')::public.contract_type else contract_type end,
      working_hours            = case when j ? 'working_hours' then nullif(btrim(coalesce(j->>'working_hours', '')), '') else working_hours end,
      shifts                   = case when j ? 'shifts' then nullif(btrim(coalesce(j->>'shifts', '')), '') else shifts end,
      start_immediately        = case when j ? 'start_immediately' then coalesce((j->>'start_immediately')::boolean, false) else start_immediately end,
      immediate                = case when j ? 'start_immediately' then coalesce((j->>'start_immediately')::boolean, false) else immediate end,
      start_date               = case when j ? 'start_date' then nullif(j->>'start_date', '')::date else start_date end,
      city                     = case when j ? 'city' then btrim(coalesce(j->>'city', '')) else city end,
      region                   = case when j ? 'region' then btrim(coalesce(j->>'region', '')) else region end,
      address                  = case when j ? 'address' then nullif(btrim(coalesce(j->>'address', '')), '') else address end,
      remote                   = case when j ? 'remote' then coalesce((j->>'remote')::boolean, false) else remote end,
      salary_min               = case when j ? 'salary_min' then (j->>'salary_min')::integer else salary_min end,
      salary_max               = case when j ? 'salary_max' then (j->>'salary_max')::integer else salary_max end,
      currency                 = case when j ? 'currency' then coalesce(nullif(j->>'currency', ''), 'EUR') else currency end,
      salary_period            = case when j ? 'salary_period' then coalesce(nullif(j->>'salary_period', ''), 'month')::public.salary_period else salary_period end,
      min_experience_years     = case when j ? 'min_experience_years' then (j->>'min_experience_years')::integer else min_experience_years end,
      requires_driving_license = case when j ? 'requires_driving_license' then coalesce((j->>'requires_driving_license')::boolean, false) else requires_driving_license end,
      no_language_required     = case when j ? 'no_language_required' then coalesce((j->>'no_language_required')::boolean, false) else no_language_required end,
      accommodation            = case when j ? 'accommodation' then coalesce((j->>'accommodation')::boolean, false) else accommodation end,
      transport                = case when j ? 'transport' then coalesce((j->>'transport')::boolean, false) else transport end,
      contact_email            = case when j ? 'contact_email' then nullif(btrim(coalesce(j->>'contact_email', '')), '') else contact_email end,
      accommodation_kind       = case when j ? 'accommodation_kind' then nullif(j->>'accommodation_kind', '') else accommodation_kind end,
      accommodation_cost       = case when j ? 'accommodation_cost' then (j->>'accommodation_cost')::numeric else accommodation_cost end,
      accommodation_cost_period = case when j ? 'accommodation_cost_period' then nullif(j->>'accommodation_cost_period', '') else accommodation_cost_period end,
      accommodation_deducted   = case when j ? 'accommodation_deducted' then (j->>'accommodation_deducted')::boolean else accommodation_deducted end,
      accommodation_registration = case when j ? 'accommodation_registration' then (j->>'accommodation_registration')::boolean else accommodation_registration end,
      accommodation_after_contract = case when j ? 'accommodation_after_contract' then nullif(j->>'accommodation_after_contract', '') else accommodation_after_contract end,
      transport_shuttle        = case when j ? 'transport_shuttle' then coalesce((j->>'transport_shuttle')::boolean, false) else transport_shuttle end,
      transport_reimbursed     = case when j ? 'transport_reimbursed' then coalesce((j->>'transport_reimbursed')::boolean, false) else transport_reimbursed end,
      meal_voucher_daily       = case when j ? 'meal_voucher_daily' then (j->>'meal_voucher_daily')::numeric else meal_voucher_daily end,
      joint_committee          = case when j ? 'joint_committee' then nullif(j->>'joint_committee', '') else joint_committee end,
      apply_url                = case when j ? 'apply_url' then nullif(btrim(coalesce(j->>'apply_url', '')), '') else apply_url end,
      apply_email              = case when j ? 'apply_email' then nullif(btrim(coalesce(j->>'apply_email', '')), '') else apply_email end,
      apply_phone              = case when j ? 'apply_phone' then nullif(btrim(coalesce(j->>'apply_phone', '')), '') else apply_phone end
    where id = p_job_id;
  end if;

  -- Tłumaczenie w języku oferty; tytuł zawsze z `jobs.title` (kolumna NOT NULL).
  if p_content ? 'translation' or j ? 'title' or j ? 'working_hours' or j ? 'shifts' then
    select title into v_title from public.jobs where id = p_job_id;
    insert into public.job_translations (job_id, locale, title, working_hours, shifts, description,
                                         responsibilities, conditions, benefits, highlights,
                                         company_description)
    values (
      p_job_id, v_locale, coalesce(v_title, ''),
      nullif(btrim(coalesce(j->>'working_hours', '')), ''),
      nullif(btrim(coalesce(j->>'shifts', '')), ''),
      tr->>'description',
      array(select jsonb_array_elements_text(coalesce(tr->'responsibilities', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(tr->'conditions', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(tr->'benefits', '[]'::jsonb))),
      array(select x from jsonb_array_elements_text(coalesce(tr->'benefits', '[]'::jsonb)) x limit 4),
      tr->>'company_description'
    )
    on conflict (job_id, locale) do update set
      title               = excluded.title,
      working_hours       = case when j ? 'working_hours' then excluded.working_hours else job_translations.working_hours end,
      shifts              = case when j ? 'shifts' then excluded.shifts else job_translations.shifts end,
      description         = case when tr ? 'description' then excluded.description else job_translations.description end,
      responsibilities    = case when tr ? 'responsibilities' then excluded.responsibilities else job_translations.responsibilities end,
      conditions          = case when tr ? 'conditions' then excluded.conditions else job_translations.conditions end,
      benefits            = case when tr ? 'benefits' then excluded.benefits else job_translations.benefits end,
      highlights          = case when tr ? 'benefits' then excluded.highlights else job_translations.highlights end,
      company_description = case when tr ? 'company_description' then excluded.company_description else job_translations.company_description end;
  end if;

  -- Relacje replace-all tymi samymi funkcjami co dotąd (walidacja i limity bez zmian).
  if p_content ? 'requirements_mandatory' then
    perform public.set_job_requirements(p_job_id, v_locale, 'mandatory',
      array(select jsonb_array_elements_text(coalesce(p_content->'requirements_mandatory', '[]'::jsonb))));
  end if;
  if p_content ? 'requirements_optional' then
    perform public.set_job_requirements(p_job_id, v_locale, 'optional',
      array(select jsonb_array_elements_text(coalesce(p_content->'requirements_optional', '[]'::jsonb))));
  end if;
  -- Najpierw zakres dodatkowy, potem obowiązkowy: etykieta w obu listach kończy jako obowiązkowa.
  if p_content ? 'skills_optional' then
    perform public.set_job_skills(p_job_id, false,
      array(select jsonb_array_elements_text(coalesce(p_content->'skills_optional', '[]'::jsonb))));
  end if;
  if p_content ? 'skills_mandatory' then
    perform public.set_job_skills(p_job_id, true,
      array(select jsonb_array_elements_text(coalesce(p_content->'skills_mandatory', '[]'::jsonb))));
  end if;
  if p_content ? 'languages' then
    perform public.set_job_languages(p_job_id, coalesce(p_content->'languages', '[]'::jsonb));
  end if;
  if p_content ? 'certificates' then
    perform public.set_job_certificates(p_job_id,
      array(select jsonb_array_elements_text(coalesce(p_content->'certificates', '[]'::jsonb))));
  end if;
  -- #101: pytania screeningowe w tej samej transakcji co reszta kroku.
  if p_content ? 'screening_questions' then
    perform public.set_job_screening_questions(p_job_id, p_content->'screening_questions');
  end if;
end $$;
revoke all on function public.save_job_draft(uuid, jsonb) from public;
grant execute on function public.save_job_draft(uuid, jsonb) to authenticated;

-- --- 4. update_published_job (0169) + kanał aplikowania -------------------------------------------
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

-- --- 5. publish_job (0085) + wymagany kanał aplikowania -------------------------------------------
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

-- --- 6. get_public_job (0140) + kanał aplikowania ---------------------------------------------------
drop function if exists public.get_public_job(text, text);

create or replace function public.get_public_job(p_slug text, p_locale text default 'pl')
returns table (
  id uuid, slug text, title text, company_name text, company_verified boolean,
  city text, region text, contract_type text, salary_min integer, salary_max integer,
  currency text, published_at timestamptz, highlights text[], category text,
  accommodation boolean, immediate boolean, no_language_required boolean,
  description text, responsibilities text[], requirements_mandatory text[],
  requirements_optional text[], conditions text[], working_hours text, shifts text,
  languages text[], transport boolean, start_date date, company_description text,
  salary_period text, expires_at timestamptz,
  company_website text, company_logo_url text, company_slug text,
  apply_url text, apply_email text, apply_phone text
)
language sql stable security definer set search_path = public, pg_temp as $$
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
    j.accommodation, j.immediate, j.no_language_required,
    coalesce(t.description, '') as description,
    coalesce(t.responsibilities, '{}'::text[]) as responsibilities,
    coalesce(
      nullif(array(select r.content from public.job_requirements r
                   where r.job_id = j.id and r.kind = 'mandatory' and r.locale = p_locale
                   order by r.position), '{}'::text[]),
      array(select r.content from public.job_requirements r
            where r.job_id = j.id and r.kind = 'mandatory' and r.locale = j.default_locale
            order by r.position)
    ) as requirements_mandatory,
    coalesce(
      nullif(array(select r.content from public.job_requirements r
                   where r.job_id = j.id and r.kind = 'optional' and r.locale = p_locale
                   order by r.position), '{}'::text[]),
      array(select r.content from public.job_requirements r
            where r.job_id = j.id and r.kind = 'optional' and r.locale = j.default_locale
            order by r.position)
    ) as requirements_optional,
    coalesce(t.conditions, '{}'::text[]) as conditions,
    coalesce(t.working_hours, j.working_hours, '') as working_hours,
    coalesce(t.shifts, j.shifts) as shifts,
    coalesce(array(select jl.language_label from public.job_languages jl
                   where jl.job_id = j.id order by jl.language_label), '{}'::text[]) as languages,
    j.transport, j.start_date,
    coalesce(t.company_description, c.description, '') as company_description,
    j.salary_period::text as salary_period,
    j.expires_at,
    case when c.status = 'verified' then public.public_https_url(c.website) end as company_website,
    case when c.status = 'verified' then public.public_https_url(c.logo_url) end as company_logo_url,
    case when c.status = 'verified' then c.slug end as company_slug,
    -- 0172: kanał aplikowania (bramki oferty publicznej bez zmian — warunki WHERE niżej).
    j.apply_url, j.apply_email, j.apply_phone
  from public.jobs j
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title, jt.description, jt.responsibilities, jt.conditions,
           jt.highlights, jt.working_hours, jt.shifts, jt.company_description
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = p_locale) desc, (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where j.slug = p_slug
    and j.status = 'active'
    and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified'
    and c.deleted_at is null
  limit 1;
$$;

revoke all on function public.get_public_job(text, text) from public;
grant execute on function public.get_public_job(text, text) to anon, authenticated, service_role;

-- --- 7. Kopia oferty jako szkic (0148): kanał przenosi trigger na rejestrze kopii --------------
create or replace function public.job_duplications_copy_apply_channel()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.jobs d set
    apply_url = s.apply_url,
    apply_email = s.apply_email,
    apply_phone = s.apply_phone
  from public.jobs s
  where s.id = new.source_job_id and d.id = new.new_job_id and d.status = 'draft';
  return null;
end $$;
revoke all on function public.job_duplications_copy_apply_channel() from public;

create trigger trg_job_duplications_copy_apply_channel
  after insert on public.job_duplications
  for each row execute function public.job_duplications_copy_apply_channel();
