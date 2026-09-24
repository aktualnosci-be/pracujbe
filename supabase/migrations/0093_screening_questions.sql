-- =============================================================================
-- 0093 — pytania screeningowe w ofercie (#101).
--
-- Firma (recruiter+) dodaje w kreatorze krótką listę pytań o realne warunki pracy (prawo
-- jazdy, VCA, transport, dostępność). Kandydat odpowiada w formularzu aplikowania, a
-- odpowiedzi trafiają do bazy RAZEM z aplikacją (jedna transakcja `apply_to_job`).
-- Odpowiedzi nie zmieniają dopasowania (`scoreMatch`) ani statusu — brak reguł
-- dyskwalifikujących i brak modelu językowego; firma czyta je w szczególe zgłoszenia.
--
-- 1. `job_screening_questions` — maks. 10 pytań na ofertę (position 0–9), typy
--    yes_no / single_choice / date / short_text, `required`, treść pytania i etykiety opcji
--    jako mapa język → tekst (klucze z `supported_locales`, tekst w języku oferty wymagany).
--    Odczyt pod RLS: członek firmy oferty; publicznie tylko przez
--    `get_public_job_screening_questions` (oferta publiczna). Bez DML dla klientów.
-- 2. `set_job_screening_questions(job, questions)` — replace-all, recruiter+, WYŁĄCZNIE szkic
--    (`JOB_NOT_DRAFT`), walidacja i limity bez cichego obcinania (VALIDATION_FAILED).
--    Identyfikatory opcji nadaje baza: o1…o10 w kolejności z kreatora.
--    Strażnik `guard_screening_questions_draft`: żadna ścieżka (także definer) nie zmienia
--    pytań oferty innej niż szkic. `update_published_job` (0077) pytań nie dotyka.
-- 3. `save_job_draft` (0083) przyjmuje klucz `screening_questions` — krok kreatora z pytaniami
--    zapisuje się w tej samej transakcji co reszta kroku. Reszta funkcji 1:1 z 0083.
-- 4. `application_screening_answers` — NIEZMIENNY snapshot pytania (typ, wymagane, treść,
--    opcje) i odpowiedzi przy aplikacji; `question_id` to tylko odnośnik historyczny (bez FK),
--    więc późniejsza zmiana/usunięcie pytania nie zmienia treści w zgłoszeniu. UPDATE
--    zablokowany triggerem, DML dla klientów odebrany. Odczyt: sam kandydat i recruiter+
--    firmy oferty (ta sama reguła co `applications_select`, 0039).
-- 5. `apply_to_job` — nowy argument `p_answers jsonb` (obiekt: id pytania → wartość).
--    Nowa aplikacja: odpowiedzi walidowane w bazie (brak odpowiedzi na wymagane pytanie →
--    `SCREENING_ANSWER_REQUIRED: <id>`, zły typ / nieznane pytanie → VALIDATION_FAILED) i
--    zapisywane w tej samej transakcji — błąd cofa też aplikację. Ponowienie z tym samym
--    kluczem (Invariant #4) zwraca istniejące id bez ponownego zapisu odpowiedzi; inny klucz →
--    APPLICATION_ALREADY_EXISTS jak w 0071. Stara pięcioargumentowa wersja jest usuwana
--    (inaczej wywołanie z pięcioma argumentami byłoby niejednoznaczne).
--
-- Rollback: `drop function public.apply_to_job(uuid, text, text, text, text, jsonb)` i odtworzenie
-- apply_to_job z 0071 (z grantem dla authenticated); save_job_draft z 0083;
-- `drop function public.get_public_job_screening_questions(uuid)`,
-- `public.set_job_screening_questions(uuid, jsonb)`, `public.screening_text_map(jsonb, text, integer)`,
-- `public.record_screening_answers(uuid, uuid, jsonb)`;
-- `drop table public.application_screening_answers, public.job_screening_questions` (wraz
-- z triggerami i ich funkcjami). Migracja nie zmienia istniejących danych.
-- =============================================================================

-- --- 1. Pytania oferty ---------------------------------------------------------------------
create table public.job_screening_questions (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs(id) on delete cascade,
  position   smallint not null check (position between 0 and 9),
  type       text not null check (type in ('yes_no', 'single_choice', 'date', 'short_text')),
  required   boolean not null default false,
  prompt     jsonb not null check (jsonb_typeof(prompt) = 'object'),
  options    jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, position),
  constraint job_screening_questions_options_type
    check ((type = 'single_choice') = (jsonb_array_length(options) > 0))
);
create trigger trg_set_updated_at before update on public.job_screening_questions
  for each row execute function public.set_updated_at();

alter table public.job_screening_questions enable row level security;
revoke all on public.job_screening_questions from public, anon, authenticated;
grant select on public.job_screening_questions to authenticated;
create policy job_screening_questions_select on public.job_screening_questions
  for select to authenticated
  using (public.is_job_company_member(job_id));

-- Pytania zmieniają się wyłącznie w szkicu — niezależnie od ścieżki zapisu.
create function public.guard_screening_questions_draft()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select status::text into v_status from public.jobs where id = old.job_id;
    -- Brak oferty = kaskadowe usunięcie razem z ofertą.
    if v_status is not null and v_status <> 'draft' then
      raise exception 'JOB_NOT_DRAFT: pytania zmienia się wyłącznie w szkicu oferty' using errcode = '42501';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select status::text into v_status from public.jobs where id = new.job_id;
    if v_status is distinct from 'draft' then
      raise exception 'JOB_NOT_DRAFT: pytania zmienia się wyłącznie w szkicu oferty' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.guard_screening_questions_draft() from public, anon, authenticated;
create trigger trg_guard_screening_questions_draft
  before insert or update or delete on public.job_screening_questions
  for each row execute function public.guard_screening_questions_draft();

-- Mapa język → tekst: klucze z supported_locales, tekst przycięty, puste wartości pomijane,
-- tekst w języku oferty wymagany, bez cichego obcinania za długiej treści.
create function public.screening_text_map(p_map jsonb, p_primary text, p_max integer)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_out jsonb := '{}'::jsonb; k text; v jsonb; v_text text;
begin
  if p_map is null or jsonb_typeof(p_map) <> 'object' then
    raise exception 'VALIDATION_FAILED: treść pytania' using errcode = '42501';
  end if;
  for k, v in select key, value from jsonb_each(p_map) loop
    if not coalesce(public.is_supported_locale(k), false) or jsonb_typeof(v) <> 'string' then
      raise exception 'VALIDATION_FAILED: treść pytania (język %)', k using errcode = '42501';
    end if;
    v_text := btrim(v #>> '{}');
    if length(v_text) > p_max then
      raise exception 'VALIDATION_FAILED: treść pytania za długa' using errcode = '42501';
    end if;
    if v_text <> '' then v_out := v_out || jsonb_build_object(k, v_text); end if;
  end loop;
  if not v_out ? p_primary then
    raise exception 'VALIDATION_FAILED: brak treści w języku oferty' using errcode = '42501';
  end if;
  return v_out;
end $$;
revoke all on function public.screening_text_map(jsonb, text, integer) from public, anon, authenticated;

-- --- 2. Zapis pytań (replace-all, tylko szkic) --------------------------------------------
create function public.set_job_screening_questions(p_job_id uuid, p_questions jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text; v_locale text; v_type text; v_opts jsonb; v_bad text;
  q jsonb; q_ord bigint; o jsonb; o_ord bigint;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select status::text, default_locale into v_status, v_locale
    from public.jobs where id = p_job_id and deleted_at is null
    for update;
  if v_status is null then raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002'; end if;
  if not public.is_job_manager(p_job_id) then
    raise exception 'PERMISSION_DENIED: pytania ustala recruiter+' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'JOB_NOT_DRAFT: pytania zmienia się wyłącznie w szkicu oferty' using errcode = '42501';
  end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) > 10 then
    raise exception 'VALIDATION_FAILED: lista pytań (maks. 10)' using errcode = '42501';
  end if;

  delete from public.job_screening_questions where job_id = p_job_id;

  for q, q_ord in select value, ordinality from jsonb_array_elements(p_questions) with ordinality loop
    if jsonb_typeof(q) <> 'object' then
      raise exception 'VALIDATION_FAILED: pytanie' using errcode = '42501';
    end if;
    select k into v_bad from jsonb_object_keys(q) k where k not in ('type', 'required', 'prompt', 'options') limit 1;
    if v_bad is not null then
      raise exception 'VALIDATION_FAILED: nieznane pole pytania %', v_bad using errcode = '42501';
    end if;
    v_type := q->>'type';
    if v_type is null or v_type not in ('yes_no', 'single_choice', 'date', 'short_text') then
      raise exception 'VALIDATION_FAILED: typ pytania' using errcode = '42501';
    end if;
    if q ? 'required' and jsonb_typeof(q->'required') <> 'boolean' then
      raise exception 'VALIDATION_FAILED: pole required' using errcode = '42501';
    end if;

    v_opts := '[]'::jsonb;
    if v_type = 'single_choice' then
      if jsonb_typeof(q->'options') is distinct from 'array'
         or jsonb_array_length(q->'options') not between 2 and 10 then
        raise exception 'VALIDATION_FAILED: pytanie wyboru wymaga 2–10 opcji' using errcode = '42501';
      end if;
      for o, o_ord in select value, ordinality from jsonb_array_elements(q->'options') with ordinality loop
        if jsonb_typeof(o) <> 'object' or exists (select 1 from jsonb_object_keys(o) k where k <> 'label') then
          raise exception 'VALIDATION_FAILED: opcja pytania' using errcode = '42501';
        end if;
        v_opts := v_opts || jsonb_build_array(jsonb_build_object(
          'id', 'o' || o_ord, 'label', public.screening_text_map(o->'label', v_locale, 120)));
      end loop;
    elsif q ? 'options' and q->'options' <> '[]'::jsonb then
      raise exception 'VALIDATION_FAILED: opcje tylko dla pytania wyboru' using errcode = '42501';
    end if;

    insert into public.job_screening_questions (job_id, position, type, required, prompt, options)
      values (p_job_id, (q_ord - 1)::smallint, v_type, coalesce((q->>'required')::boolean, false),
              public.screening_text_map(q->'prompt', v_locale, 300), v_opts);
  end loop;
end $$;
revoke all on function public.set_job_screening_questions(uuid, jsonb) from public, anon;
grant execute on function public.set_job_screening_questions(uuid, jsonb) to authenticated;

-- Pytania publicznej oferty (formularz aplikowania; gość też je widzi przed zalogowaniem).
create function public.get_public_job_screening_questions(p_job_id uuid)
returns table (id uuid, "position" smallint, type text, required boolean, prompt jsonb, options jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select q.id, q.position, q.type, q.required, q.prompt, q.options
    from public.job_screening_questions q
    where q.job_id = p_job_id and public.job_is_public(p_job_id)
    order by q.position;
$$;
revoke all on function public.get_public_job_screening_questions(uuid) from public;
grant execute on function public.get_public_job_screening_questions(uuid) to anon, authenticated;

-- --- 3. save_job_draft (0083) + klucz screening_questions ---------------------------------
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
                    'accommodation', 'transport', 'contact_email')
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
      contact_email            = case when j ? 'contact_email' then nullif(btrim(coalesce(j->>'contact_email', '')), '') else contact_email end
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

-- --- 4. Odpowiedzi przy aplikacji (niezmienny snapshot) -----------------------------------
create table public.application_screening_answers (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  -- Odnośnik historyczny bez FK: snapshot nie zależy od dalszych losów pytania.
  question_id    uuid,
  position       smallint not null check (position between 0 and 9),
  type           text not null check (type in ('yes_no', 'single_choice', 'date', 'short_text')),
  required       boolean not null,
  prompt         jsonb not null check (jsonb_typeof(prompt) = 'object'),
  options        jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  answer_boolean boolean,
  answer_date    date,
  answer_text    text check (answer_text is null or length(answer_text) between 1 and 500),
  created_at     timestamptz not null default now(),
  unique (application_id, position),
  constraint application_screening_answers_value_type check (
    (type = 'yes_no' and answer_date is null and answer_text is null)
    or (type = 'date' and answer_boolean is null and answer_text is null)
    or (type in ('short_text', 'single_choice') and answer_boolean is null and answer_date is null)
  ),
  -- Wymagane pytanie ma odpowiedź — egzekwowane w bazie niezależnie od ścieżki zapisu.
  constraint application_screening_answers_required check (
    not required or answer_boolean is not null or answer_date is not null or answer_text is not null
  )
);
create index idx_application_screening_answers_app on public.application_screening_answers(application_id);

alter table public.application_screening_answers enable row level security;
revoke all on public.application_screening_answers from public, anon, authenticated;
grant select on public.application_screening_answers to authenticated;
create policy application_screening_answers_select on public.application_screening_answers
  for select to authenticated
  using (exists (
    select 1 from public.applications a
    where a.id = application_id
      and (a.candidate_id = auth.uid() or public.is_job_manager(a.job_id))
  ));

create function public.guard_screening_answers_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'VALIDATION_FAILED: odpowiedzi na pytania są niezmienne' using errcode = '42501';
end $$;
revoke all on function public.guard_screening_answers_immutable() from public, anon, authenticated;
create trigger trg_guard_screening_answers_immutable
  before update on public.application_screening_answers
  for each row execute function public.guard_screening_answers_immutable();

-- Walidacja i zapis odpowiedzi nowej aplikacji. Wołana wyłącznie z apply_to_job.
create function public.record_screening_answers(p_application_id uuid, p_job_id uuid, p_answers jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a jsonb := coalesce(p_answers, '{}'::jsonb);
  q record; v jsonb; v_text text; v_date date; v_bad text;
  v_bool boolean; v_ans_date date; v_ans_text text;
begin
  if jsonb_typeof(a) <> 'object' then
    raise exception 'VALIDATION_FAILED: odpowiedzi' using errcode = '42501';
  end if;
  select k into v_bad from jsonb_object_keys(a) k
    where not exists (select 1 from public.job_screening_questions sq
                      where sq.job_id = p_job_id and sq.id::text = k)
    limit 1;
  if v_bad is not null then
    raise exception 'VALIDATION_FAILED: odpowiedź na nieznane pytanie' using errcode = '42501';
  end if;

  for q in select * from public.job_screening_questions where job_id = p_job_id order by position loop
    v := a->(q.id::text);
    v_bool := null; v_ans_date := null; v_ans_text := null;
    -- Brak odpowiedzi: brak klucza, JSON null albo pusty tekst.
    if v is not null and jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '' then v := null; end if;
    if v is not null and jsonb_typeof(v) = 'null' then v := null; end if;

    if v is not null then
      if q.type = 'yes_no' then
        if jsonb_typeof(v) <> 'boolean' then
          raise exception 'VALIDATION_FAILED: odpowiedź tak/nie' using errcode = '42501';
        end if;
        v_bool := (v #>> '{}')::boolean;
      elsif jsonb_typeof(v) <> 'string' then
        raise exception 'VALIDATION_FAILED: odpowiedź' using errcode = '42501';
      else
        v_text := btrim(v #>> '{}');
        if q.type = 'single_choice' then
          if not exists (select 1 from jsonb_array_elements(q.options) o where o->>'id' = v_text) then
            raise exception 'VALIDATION_FAILED: nieznana opcja' using errcode = '42501';
          end if;
          v_ans_text := v_text;
        elsif q.type = 'date' then
          if v_text !~ '^\d{4}-\d{2}-\d{2}$' then
            raise exception 'VALIDATION_FAILED: data' using errcode = '42501';
          end if;
          begin
            v_date := v_text::date;
          exception when others then
            raise exception 'VALIDATION_FAILED: data' using errcode = '42501';
          end;
          if v_date not between date '1900-01-01' and date '2100-12-31' then
            raise exception 'VALIDATION_FAILED: data' using errcode = '42501';
          end if;
          v_ans_date := v_date;
        else
          if length(v_text) > 500 then
            raise exception 'VALIDATION_FAILED: odpowiedź za długa' using errcode = '42501';
          end if;
          v_ans_text := v_text;
        end if;
      end if;
    elsif q.required then
      raise exception 'SCREENING_ANSWER_REQUIRED: %', q.id using errcode = '23514';
    end if;

    insert into public.application_screening_answers
      (application_id, question_id, position, type, required, prompt, options,
       answer_boolean, answer_date, answer_text)
    values (p_application_id, q.id, q.position, q.type, q.required, q.prompt, q.options,
            v_bool, v_ans_date, v_ans_text);
  end loop;
end $$;
revoke all on function public.record_screening_answers(uuid, uuid, jsonb) from public, anon, authenticated;

-- --- 5. apply_to_job (0071) + odpowiedzi ---------------------------------------------------
drop function public.apply_to_job(uuid, text, text, text, text);

create function public.apply_to_job(
  p_job_id uuid,
  p_idempotency_key text,
  p_phone text default null,
  p_availability text default null,
  p_message text default null,
  p_answers jsonb default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_company uuid; v_app_id uuid; v_locale text; v_job_title text;
        v_existing_key text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  -- P1-04: aplikować może wyłącznie konto kandydata (nie pracodawca/admin).
  if public.current_profile_role() <> 'candidate' then
    raise exception 'PERMISSION_DENIED: aplikować może tylko konto kandydata' using errcode = '42501';
  end if;
  if not public.job_is_public(p_job_id) then raise exception 'JOB_NOT_ACTIVE' using errcode = '42501'; end if;

  select company_id, title into v_company, v_job_title from public.jobs where id = p_job_id;
  v_locale := public.resolve_recipient_locale(v_uid);

  insert into public.applications
    (job_id, candidate_id, company_id, status, phone, availability, message, locale, idempotency_key, submitted_at)
  values
    (p_job_id, v_uid, v_company, 'submitted', p_phone,
     nullif(p_availability,'')::public.availability_status, p_message, v_locale, p_idempotency_key, now())
  on conflict (candidate_id, job_id) do nothing
  returning id into v_app_id;

  if v_app_id is null then
    select id, idempotency_key into v_app_id, v_existing_key
      from public.applications where candidate_id = v_uid and job_id = p_job_id;
    -- Ten sam klucz = ponowienie tej samej próby (retry/podwójne kliknięcie) → sukces, bez
    -- duplikatu. Inny klucz = nowa, świadoma próba na ofertę, na którą kandydat już
    -- aplikował (także wycofaną/odrzuconą) → jawny błąd zamiast fałszywego sukcesu (#361).
    if v_existing_key is distinct from p_idempotency_key then
      raise exception 'APPLICATION_ALREADY_EXISTS' using errcode = '23505';
    end if;
    return v_app_id;
  end if;

  -- #101: odpowiedzi na pytania oferty w tej samej transakcji — błąd cofa też aplikację.
  perform public.record_screening_answers(v_app_id, p_job_id, p_answers);

  -- Powiadom/e-mail tylko aktywnych recruiter+ z aktywnym profilem (0070).
  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    select cm.profile_id, 'application_received', 'application_received', 'application', v_app_id
    from public.company_members cm
    where cm.company_id = v_company and public.company_recipient_ok(v_company, cm.profile_id);

  perform public.enqueue_email(cm.profile_id, 'newApplication', 'application', v_app_id,
                               'app-' || v_app_id::text || '-' || cm.profile_id::text,
                               jsonb_build_object('candidateName', coalesce(public.profile_full_name(v_uid), '—'),
                                                  'jobTitle', coalesce(v_job_title, '')))
    from public.company_members cm
    where cm.company_id = v_company and public.company_recipient_ok(v_company, cm.profile_id);

  return v_app_id;
end $$;
revoke all on function public.apply_to_job(uuid, text, text, text, text, jsonb) from public;
grant execute on function public.apply_to_job(uuid, text, text, text, text, jsonb) to authenticated;
