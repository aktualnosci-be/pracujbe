-- =============================================================================
-- 0930_job_costs_benefits.sql — „Koszty i dodatki” w ofercie (numer tymczasowy; ostateczny
-- nada integrator).
--
-- Zamiast samych flag `accommodation`/`transport` oferta może podać konkretne, OPCJONALNE
-- warunki (deklaracja pracodawcy, bez oceny przez portal):
--   * zakwaterowanie: rodzaj (zapewnione / pomoc w znalezieniu / brak), koszt w EUR za
--     tydzień albo miesiąc (0 = bez kosztów), czy potrącany z pensji, czy możliwe zameldowanie,
--     co z mieszkaniem po końcu umowy — szczegóły tylko dla „zapewnione”;
--   * transport: dowóz do pracy, zwrot kosztów dojazdu;
--   * bony żywieniowe: kwota dzienna w EUR;
--   * komisja parytetowa (PC/CP): kod ze słownika `joint_committees` (dane, nie hardcode).
--     Portal NIE porównuje stawki z minimum sektora — strona pokazuje link do oficjalnej bazy.
--
-- 1. Słownik `joint_committees` (odczyt publiczny, zapis service_role). Lustro TS:
--    src/lib/joint-committees.ts (zgodność pilnuje tests/unit/job-costs.test.ts).
-- 2. Kolumny `jobs` + CHECK-i spójności z flagami filtrów: `accommodation` = rodzaj
--    zapewnione/pomoc (gdy rodzaj podany), `transport` obejmuje dowóz i zwrot. Stare oferty
--    (rodzaj null) bez zmian — flaga zostaje, szczegółów brak.
-- 3. `save_job_draft` (0093) i `update_published_job` (0144) — te same treści + nowe klucze.
--    Strażnik `guard_published_job_content` (0077) porównuje cały wiersz, więc nowe kolumny
--    oferty opublikowanej też zmienia wyłącznie `update_published_job`.
-- 4. `job_material_terms` (0144) + klucz `accommodation` (rodzaj, koszt, okres, potrącenie):
--    zmiana kosztu zakwaterowania w opublikowanej ofercie powiadamia kandydatów z aktywną
--    aplikacją (ten sam trigger i ta sama bramka znacznika co 0144).
-- 5. `duplicate_job_as_draft` (0148) — kopia kosztów przez trigger na `job_duplications`
--    (bez redefinicji funkcji).
-- 6. `get_public_job_costs(p_job_id)` — pola sekcji dla oferty publicznej (`job_is_public`),
--    jak `get_public_job_screening_questions` (0093). `get_public_job` bez zmian.
--
-- Rollback: nowa migracja — `create or replace` save_job_draft z 0093, update_published_job
-- i job_material_terms z 0144; drop function get_public_job_costs(uuid),
-- drop trigger trg_job_duplications_copy_costs + funkcja; alter table jobs drop constraint
-- jobs_accommodation_* / jobs_transport_details_flag, drop column dla 10 kolumn; drop table
-- joint_committees.
-- =============================================================================

-- --- 1. Słownik komisji parytetowych ------------------------------------------------------
create table public.joint_committees (
  code       text primary key check (code ~ '^[0-9]{3}(\.[0-9]{2})?$'),
  name_pl    text not null check (length(btrim(name_pl)) between 1 and 200),
  name_nl    text not null check (length(btrim(name_nl)) between 1 and 200),
  name_fr    text not null check (length(btrim(name_fr)) between 1 and 200),
  name_en    text not null check (length(btrim(name_en)) between 1 and 200),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.joint_committees enable row level security;
create policy joint_committees_public_read on public.joint_committees
  for select to anon, authenticated using (true);
revoke all on public.joint_committees from anon, authenticated;
grant select on public.joint_committees to anon, authenticated;
grant select, insert, update, delete on public.joint_committees to service_role;

insert into public.joint_committees (code, name_pl, name_nl, name_fr, name_en) values
  ('100', 'Pomocnicza komisja dla robotników', 'Aanvullend paritair comité voor de werklieden', 'Commission paritaire auxiliaire pour ouvriers', 'Auxiliary joint committee for blue-collar workers'),
  ('111', 'Konstrukcje metalowe, mechaniczne i elektryczne', 'Metaal-, machine- en elektrische bouw', 'Constructions métallique, mécanique et électrique', 'Metal, mechanical and electrical engineering'),
  ('112', 'Warsztaty samochodowe', 'Garagebedrijf', 'Entreprises de garage', 'Garages'),
  ('116', 'Przemysł chemiczny (robotnicy)', 'Scheikundige nijverheid', 'Industrie chimique', 'Chemical industry (blue-collar)'),
  ('118', 'Przemysł spożywczy (robotnicy)', 'Voedingsnijverheid', 'Industrie alimentaire', 'Food industry (blue-collar)'),
  ('119', 'Handel artykułami spożywczymi', 'Handel in voedingswaren', 'Commerce alimentaire', 'Food trade'),
  ('121', 'Sprzątanie', 'Schoonmaak', 'Nettoyage', 'Cleaning'),
  ('124', 'Budownictwo', 'Bouwbedrijf', 'Construction', 'Construction'),
  ('126', 'Meblarstwo i obróbka drewna', 'Stoffering en houtbewerking', 'Ameublement et industrie transformatrice du bois', 'Furniture and woodworking'),
  ('130', 'Poligrafia', 'Drukkerij, grafische kunst en dagbladbedrijf', 'Imprimerie, arts graphiques et journaux', 'Printing and graphic arts'),
  ('140', 'Transport i logistyka', 'Vervoer en logistiek', 'Transport et logistique', 'Transport and logistics'),
  ('144', 'Rolnictwo', 'Landbouw', 'Agriculture', 'Agriculture'),
  ('145', 'Ogrodnictwo', 'Tuinbouw', 'Entreprises horticoles', 'Horticulture'),
  ('149.01', 'Elektrycy: instalacje i dystrybucja', 'Elektriciens: installatie en distributie', 'Électriciens: installation et distribution', 'Electricians: installation and distribution'),
  ('200', 'Pomocnicza komisja dla pracowników umysłowych', 'Aanvullend paritair comité voor de bedienden', 'Commission paritaire auxiliaire pour employés', 'Auxiliary joint committee for white-collar workers'),
  ('201', 'Niezależny handel detaliczny', 'Zelfstandige kleinhandel', 'Commerce de détail indépendant', 'Independent retail'),
  ('202', 'Handel detaliczny artykułami spożywczymi (pracownicy umysłowi)', 'Bedienden uit de kleinhandel in voedingswaren', 'Employés du commerce de détail alimentaire', 'Food retail (white-collar)'),
  ('220', 'Przemysł spożywczy (pracownicy umysłowi)', 'Bedienden uit de voedingsnijverheid', 'Employés de l''industrie alimentaire', 'Food industry (white-collar)'),
  ('226', 'Handel międzynarodowy, transport i logistyka (pracownicy umysłowi)', 'Bedienden uit de internationale handel, het vervoer en de logistiek', 'Employés du commerce international, du transport et de la logistique', 'International trade, transport and logistics (white-collar)'),
  ('302', 'Hotelarstwo i gastronomia', 'Hotelbedrijf', 'Industrie hôtelière', 'Hotels and catering'),
  ('311', 'Duże sklepy detaliczne', 'Grote kleinhandelszaken', 'Entreprises de vente au détail', 'Large retail stores'),
  ('312', 'Domy towarowe', 'Warenhuizen', 'Grands magasins', 'Department stores'),
  ('314', 'Fryzjerstwo i kosmetyka', 'Kapsalons en schoonheidszorg', 'Coiffure et soins de beauté', 'Hairdressing and beauty care'),
  ('322', 'Praca tymczasowa (interim)', 'Uitzendarbeid en erkende ondernemingen die buurtwerken of -diensten leveren', 'Travail intérimaire et entreprises agréées fournissant des travaux ou services de proximité', 'Temporary agency work'),
  ('322.01', 'Usługi w systemie czeków usługowych', 'Erkende ondernemingen die buurtwerken of -diensten leveren (dienstencheques)', 'Entreprises agréées fournissant des travaux ou services de proximité (titres-services)', 'Service voucher companies'),
  ('330', 'Placówki i usługi opieki zdrowotnej', 'Gezondheidsinrichtingen en -diensten', 'Établissements et services de santé', 'Healthcare institutions and services');

-- --- 2. Kolumny oferty ----------------------------------------------------------------------
alter table public.jobs
  add column accommodation_kind text
    check (accommodation_kind in ('provided', 'assistance', 'none')),
  add column accommodation_cost numeric(7, 2)
    check (accommodation_cost >= 0 and accommodation_cost <= 5000),
  add column accommodation_cost_period text
    check (accommodation_cost_period in ('week', 'month')),
  add column accommodation_deducted boolean,
  add column accommodation_registration boolean,
  add column accommodation_after_contract text
    check (accommodation_after_contract in ('ends_with_contract', 'transition_period', 'can_stay')),
  add column transport_shuttle boolean not null default false,
  add column transport_reimbursed boolean not null default false,
  add column meal_voucher_daily numeric(5, 2)
    check (meal_voucher_daily > 0 and meal_voucher_daily <= 20),
  add column joint_committee text references public.joint_committees(code) on update cascade,
  -- Flaga filtra listy = rodzaj „zapewnione” albo „pomoc” (gdy rodzaj podany).
  add constraint jobs_accommodation_kind_flag
    check (accommodation_kind is null
           or accommodation = (accommodation_kind in ('provided', 'assistance'))),
  -- Koszt i warunki mieszkania tylko przy zakwaterowaniu zapewnionym przez pracodawcę.
  add constraint jobs_accommodation_details_provided
    check (accommodation_kind is not distinct from 'provided'
           or (accommodation_cost is null and accommodation_cost_period is null
               and accommodation_deducted is null and accommodation_registration is null
               and accommodation_after_contract is null)),
  add constraint jobs_accommodation_cost_period
    check ((accommodation_cost is null) = (accommodation_cost_period is null)),
  add constraint jobs_transport_details_flag
    check (transport or not (transport_shuttle or transport_reimbursed));

-- --- 3a. save_job_draft (0093) + klucze kosztów -------------------------------------------
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
                    -- 0930: koszty i dodatki
                    'accommodation_kind', 'accommodation_cost', 'accommodation_cost_period',
                    'accommodation_deducted', 'accommodation_registration',
                    'accommodation_after_contract', 'transport_shuttle', 'transport_reimbursed',
                    'meal_voucher_daily', 'joint_committee')
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
      joint_committee          = case when j ? 'joint_committee' then nullif(j->>'joint_committee', '') else joint_committee end
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

-- --- 4. Istotne warunki (0144) + zakwaterowanie ---------------------------------------------
create or replace function public.job_material_terms(j public.jobs)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'salary', jsonb_build_object('min', j.salary_min, 'max', j.salary_max,
                                 'period', j.salary_period, 'currency', j.currency),
    'city', public.search_fold(btrim(coalesce(j.city, ''))),
    'contract_type', j.contract_type,
    'working_hours', j.working_hours,
    -- 0930: koszt zakwaterowania i potrącenie z pensji zmieniają realny dochód kandydata.
    'accommodation', jsonb_build_object('kind', j.accommodation_kind,
                                        'cost', j.accommodation_cost,
                                        'period', j.accommodation_cost_period,
                                        'deducted', j.accommodation_deducted)
  )
$$;
revoke all on function public.job_material_terms(public.jobs) from public;

-- --- 3b. update_published_job (0144) + kolumny kosztów -------------------------------------
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
    -- 0930: koszty i dodatki (brak klucza = brak wartości, jak pozostałe pola rewizji).
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

-- --- 5. Kopia oferty jako szkic (0148): koszty przenosi trigger na rejestrze kopii ----------
create or replace function public.job_duplications_copy_costs()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.jobs d set
    accommodation_kind = s.accommodation_kind,
    accommodation_cost = s.accommodation_cost,
    accommodation_cost_period = s.accommodation_cost_period,
    accommodation_deducted = s.accommodation_deducted,
    accommodation_registration = s.accommodation_registration,
    accommodation_after_contract = s.accommodation_after_contract,
    transport_shuttle = s.transport_shuttle,
    transport_reimbursed = s.transport_reimbursed,
    meal_voucher_daily = s.meal_voucher_daily,
    joint_committee = s.joint_committee
  from public.jobs s
  where s.id = new.source_job_id and d.id = new.new_job_id and d.status = 'draft';
  return null;
end $$;
revoke all on function public.job_duplications_copy_costs() from public;

create trigger trg_job_duplications_copy_costs
  after insert on public.job_duplications
  for each row execute function public.job_duplications_copy_costs();

-- --- 6. Odczyt sekcji dla oferty publicznej --------------------------------------------------
create function public.get_public_job_costs(p_job_id uuid)
returns table (
  accommodation_kind text, accommodation_cost numeric, accommodation_cost_period text,
  accommodation_deducted boolean, accommodation_registration boolean,
  accommodation_after_contract text, transport_shuttle boolean, transport_reimbursed boolean,
  meal_voucher_daily numeric, joint_committee text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select j.accommodation_kind, j.accommodation_cost, j.accommodation_cost_period,
         j.accommodation_deducted, j.accommodation_registration, j.accommodation_after_contract,
         j.transport_shuttle, j.transport_reimbursed, j.meal_voucher_daily, j.joint_committee
    from public.jobs j
    where j.id = p_job_id and public.job_is_public(p_job_id);
$$;
revoke all on function public.get_public_job_costs(uuid) from public;
grant execute on function public.get_public_job_costs(uuid) to anon, authenticated, service_role;
