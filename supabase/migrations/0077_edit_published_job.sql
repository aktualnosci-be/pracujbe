-- =============================================================================
-- 0077 — edycja opublikowanej oferty (#325).
--
-- Problem: kreator edytował wyłącznie szkic (P1-10, `JOB_NOT_DRAFT`). Literówki w tytule,
-- stawki czy daty startu aktywnej oferty nie dało się poprawić — jedyną drogą było zamknięcie
-- oferty i napisanie nowej, co odcinało zgłoszenia kandydatów od oferty. Jednocześnie baza NIE
-- chroniła treści opublikowanej oferty: recruiter+ mógł pod RLS bezpośrednio zmienić kolumny
-- `jobs` albo relacje (tłumaczenie, wymagania, umiejętności, języki, certyfikaty) aktywnej oferty
-- — z pominięciem walidacji kompletności z `publish_job` (np. pusty tytuł, brak wymagań).
--
-- Naprawa:
-- 1. `update_published_job(job, content, expected_updated_at)` — JEDNA transakcja: blokada
--    wiersza, recruiter+ (`can_manage_jobs`), status active/paused (szkic idzie kreatorem,
--    zamkniętą/wygasłą najpierw otwiera się ponownie), firma `verified`, opcjonalny CAS po
--    `updated_at` (dwie osoby edytujące naraz nie nadpisują się po cichu), zapis całej treści
--    (kolumny + tłumaczenie w języku oferty + relacje replace-all), a na końcu TA SAMA
--    kontrola kompletności co w `publish_job`. Błąd = rollback całości (publiczna oferta nigdy
--    nie jest mieszanką starej i nowej treści). Status, slug (publiczny adres), published_at,
--    zgłoszenia i ich historia zostają nietknięte. Wpis `audit_logs` (przed/po).
-- 2. Strażnik `guard_published_job_content` na `jobs`: klient (poza definerami/backendem) nie
--    zmienia bezpośrednio żadnej kolumny oferty innej niż szkic.
-- 3. Strażnik `guard_published_job_children` na tabelach relacji oferty: jw. dla INSERT/UPDATE/
--    DELETE. Nie-członek dostaje dalej błąd RLS (strażnik działa tylko dla recruiter+).
-- 4. `set_job_requirements/skills/languages/certificates` (SECURITY DEFINER, omijają strażniki)
--    przyjmują ofertę inną niż szkic tylko wewnątrz `update_published_job` (znacznik
--    transakcyjny `pracujbe.job_edit` = id oferty — ten sam wzorzec co `company_reverify`, 0072).
--    Ciała funkcji bez innych zmian (0047/0051/0069).
-- 5. `strict_job_version` (BEFORE UPDATE na `jobs`, po `trg_set_updated_at`): `updated_at` oferty
--    rośnie ściśle przy każdej zmianie — także dwóch w jednej transakcji, gdzie `now()` jest stałe.
--    To token CAS edycji, więc nie może się powtórzyć po zapisie.
--
-- Rollback: `drop function public.update_published_job(uuid, jsonb, timestamptz)`;
-- `drop trigger trg_guard_published_job_content on public.jobs` i
-- `drop trigger trg_guard_published_job_children on public.<tabela>` dla pięciu tabel relacji,
-- `drop trigger trg_strict_job_version on public.jobs`, `drop function public.strict_job_version()`,
-- `drop function public.guard_published_job_content()`, `public.guard_published_job_children()`,
-- `public.assert_job_draft_or_editing(uuid)`; set_job_* odtworzyć z 0047/0051 (wymagania
-- z warunkiem `is_supported_locale`, 0069). Migracja nie zmienia danych.
-- =============================================================================

-- --- Wspólny warunek set_job_*: szkic albo edycja w toku (update_published_job) -------------
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

-- --- set_job_* (0047/0051/0069) + warunek szkicu ---------------------------------------------
create or replace function public.set_job_requirements(
  p_job_id uuid, p_locale text, p_kind text, p_lines text[]
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_job_manager(p_job_id) then
    raise exception 'PERMISSION_DENIED: zapis wymagań wymaga roli recruiter+' using errcode = '42501';
  end if;
  if not public.is_supported_locale(p_locale) then
    raise exception 'VALIDATION_FAILED: locale' using errcode = '42501';
  end if;
  perform public.assert_job_draft_or_editing(p_job_id);
  delete from public.job_requirements
    where job_id = p_job_id and kind = p_kind::public.requirement_kind and locale = p_locale;
  insert into public.job_requirements (job_id, locale, kind, position, content)
    select p_job_id, p_locale, p_kind::public.requirement_kind, (ord - 1)::int, left(btrim(content), 500)
    from unnest(coalesce(p_lines, '{}'::text[])) with ordinality as u(content, ord)
    where btrim(content) <> ''
    limit 50;
end $$;
revoke all on function public.set_job_requirements(uuid, text, text, text[]) from public;
grant execute on function public.set_job_requirements(uuid, text, text, text[]) to authenticated;

create or replace function public.set_job_skills(
  p_job_id uuid, p_mandatory boolean, p_labels text[]
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_labels text[];
begin
  if not public.is_job_manager(p_job_id) then
    raise exception 'PERMISSION_DENIED: zapis umiejętności wymaga roli recruiter+' using errcode = '42501';
  end if;
  perform public.assert_job_draft_or_editing(p_job_id);

  select coalesce(array_agg(label), '{}'::text[]) into v_labels
    from (
      select distinct left(btrim(s), 120) as label
      from unnest(coalesce(p_labels, '{}'::text[])) s
      where btrim(s) <> '' limit 50
    ) q;

  delete from public.job_skills
    where job_id = p_job_id
      and (is_mandatory = coalesce(p_mandatory, false) or skill_label = any(v_labels));

  insert into public.job_skills (job_id, skill_label, is_mandatory)
    select p_job_id, label, coalesce(p_mandatory, false) from unnest(v_labels) label
  on conflict (job_id, skill_label) do nothing;
end $$;
revoke all on function public.set_job_skills(uuid, boolean, text[]) from public;
grant execute on function public.set_job_skills(uuid, boolean, text[]) to authenticated;

create or replace function public.set_job_languages(
  p_job_id uuid, p_languages jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_job_manager(p_job_id) then
    raise exception 'PERMISSION_DENIED: zapis języków wymaga roli recruiter+' using errcode = '42501';
  end if;
  perform public.assert_job_draft_or_editing(p_job_id);
  delete from public.job_languages where job_id = p_job_id;
  insert into public.job_languages (job_id, language_label, level)
    select p_job_id, label, lvl from (
      select distinct on (lower(left(btrim(e->>'language'), 80)))
             left(btrim(e->>'language'), 80) as label,
             (e->>'level')::public.language_level as lvl
      from jsonb_array_elements(coalesce(p_languages, '[]'::jsonb)) e
      where btrim(coalesce(e->>'language', '')) <> '' limit 30
    ) q
  on conflict (job_id, language_label) do nothing;
end $$;
revoke all on function public.set_job_languages(uuid, jsonb) from public;
grant execute on function public.set_job_languages(uuid, jsonb) to authenticated;

create or replace function public.set_job_certificates(
  p_job_id uuid, p_labels text[]
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_job_manager(p_job_id) then
    raise exception 'PERMISSION_DENIED: zapis certyfikatów wymaga roli recruiter+' using errcode = '42501';
  end if;
  perform public.assert_job_draft_or_editing(p_job_id);
  delete from public.job_certificates where job_id = p_job_id;
  insert into public.job_certificates (job_id, certificate_label)
    select p_job_id, label from (
      select distinct left(btrim(s), 160) as label
      from unnest(coalesce(p_labels, '{}'::text[])) s
      where btrim(s) <> '' limit 60
    ) q
  on conflict (job_id, certificate_label) do nothing;
end $$;
revoke all on function public.set_job_certificates(uuid, text[]) from public;
grant execute on function public.set_job_certificates(uuid, text[]) to authenticated;

-- --- Strażnik: treść oferty innej niż szkic tylko przez RPC ----------------------------------
create or replace function public.guard_published_job_content()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- SECURITY DEFINER RPC (właściciel: postgres) oraz backend service_role piszą dalej.
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  -- Status pilnuje guard_job_status (0056); updated_at ustawia trigger set_updated_at.
  if old.status <> 'draft'
     and (to_jsonb(new) - 'updated_at' - 'status') is distinct from (to_jsonb(old) - 'updated_at' - 'status') then
    raise exception 'JOB_NOT_DRAFT: treść opublikowanej oferty zmienia wyłącznie update_published_job'
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger trg_guard_published_job_content
  before update on public.jobs
  for each row execute function public.guard_published_job_content();

create or replace function public.guard_published_job_children()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_job uuid; v_status text;
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return coalesce(new, old);
  end if;
  v_job := case when tg_op = 'DELETE' then old.job_id else new.job_id end;
  -- Nie-członek: decyzję zostawiamy RLS (czytelny błąd „row-level security", bez wycieku statusu).
  if public.is_job_manager(v_job) then
    select status::text into v_status from public.jobs where id = v_job;
    if v_status is not null and v_status <> 'draft' then
      raise exception 'JOB_NOT_DRAFT: treść opublikowanej oferty zmienia wyłącznie update_published_job'
        using errcode = '42501';
    end if;
    -- UPDATE przenoszący wiersz do innej oferty: sprawdź także ofertę źródłową.
    if tg_op = 'UPDATE' and old.job_id is distinct from new.job_id then
      select status::text into v_status from public.jobs where id = old.job_id;
      if v_status is not null and v_status <> 'draft' then
        raise exception 'JOB_NOT_DRAFT: treść opublikowanej oferty zmienia wyłącznie update_published_job'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['job_translations', 'job_requirements', 'job_skills',
                           'job_languages', 'job_certificates'] loop
    execute format(
      'create trigger trg_guard_published_job_children before insert or update or delete on public.%I
         for each row execute function public.guard_published_job_children()', t);
  end loop;
end $$;

-- --- Ściśle rosnąca wersja oferty (token CAS) -------------------------------------------------
create or replace function public.strict_job_version()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.updated_at is null or new.updated_at <= old.updated_at then
    new.updated_at := old.updated_at + interval '1 microsecond';
  end if;
  return new;
end $$;
revoke all on function public.strict_job_version() from public;

-- Nazwa po `trg_set_updated_at` (triggery BEFORE wykonują się alfabetycznie).
create trigger trg_strict_job_version
  before update on public.jobs
  for each row execute function public.strict_job_version();

-- --- update_published_job: atomowa rewizja aktywnej/wstrzymanej oferty -----------------------
-- p_content (kształt budowany przez akcję serwerową updatePublishedJob po walidacji Zod):
--   job:         kolumny public.jobs (title, category, occupation, contract_type, working_hours,
--                shifts, start_immediately, start_date, city, region, address, remote,
--                salary_min, salary_max, currency, salary_period, min_experience_years,
--                requires_driving_license, no_language_required, accommodation, transport,
--                contact_email)
--   translation: description, responsibilities[], conditions[], benefits[], company_description
--   requirements_mandatory[], requirements_optional[], skills_mandatory[], skills_optional[],
--   languages[{language, level}], certificates[]
-- Zwraca {slug, updated_at}: publiczny adres (bez zmian) i nową wersję do kolejnego CAS.
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
