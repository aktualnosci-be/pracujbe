-- =============================================================================
-- 0967_job_edit_trusted_context.sql — edycja opublikowanej oferty bez ufania GUC klienta
-- (#753, #752) i pełny audyt warunków oferty (#750). Numer tymczasowy.
--
-- Problem:
--   * #753 — `assert_job_draft_or_editing` (0077) dopuszczał ofertę inną niż szkic, gdy
--     `current_setting('pracujbe.job_edit')` = id oferty. Rola `authenticated` ustawia dowolny
--     parametr niestandardowy przez `set_config()`, więc recruiter+ mógł wywołać
--     `set_job_requirements/skills/languages/certificates` (SECURITY DEFINER, grant dla
--     `authenticated`) dla opublikowanej oferty z pominięciem `update_published_job`
--     (kompletność, CAS wersji, audyt, powiadomienia).
--   * #752 — `notify_job_terms_changed` (0144) uznawał `pracujbe.job_terms_notify` = id oferty
--     za dowód zapisu z RPC; ten sam `set_config()` + dozwolony bezpośredni UPDATE (rola
--     backendu) tworzył kandydatom powiadomienia bez rewizji.
--   * #750 — `update_published_job` zapisywał w audycie tylko tytuł, miasto, region, stawkę,
--     datę startu i rodzaj umowy; zmiana godzin pracy (albo okresu stawki, waluty, kosztu
--     zakwaterowania) trafiała do powiadomienia kandydata, ale nie do dziennika.
--
-- Naprawa:
-- 1. `job_operation_context` — kontekst zaufanej operacji: (transakcja, oferta, rodzaj).
--    RLS włączone, BEZ grantów dla public/anon/authenticated/service_role — wiersz wstawia
--    wyłącznie SECURITY DEFINER `update_published_job` i usuwa go przed zwrotem. Wiersz innej
--    transakcji jest niewidoczny (MVCC) i dodatkowo odfiltrowany po `pg_current_xact_id`;
--    błąd RPC cofa wiersz razem z rewizją (także w bloku EXCEPTION klienta — podtransakcja).
-- 2. `job_operation_context_active` (sprawdzenie, dla `job_edit`) i `job_operation_context_take`
--    (sprawdzenie ze zużyciem, dla `job_terms_notify` — jedna rewizja = jedno powiadomienie).
--    Obie SECURITY DEFINER bez EXECUTE dla klientów.
-- 3. `assert_job_draft_or_editing` (0077) i `notify_job_terms_changed` (0144) czytają kontekst
--    z tabeli; GUC `pracujbe.job_edit` / `pracujbe.job_terms_notify` nic już nie otwiera.
-- 4. `job_edit_audit_snapshot(jobs)` — migawka audytu `job.update_published`: dotychczasowe
--    pola (title, city, region, salary_min, salary_max, start_date, contract_type) + godziny
--    pracy, zmiany, okres stawki, waluta, pola kosztu zakwaterowania oraz `terms` =
--    `job_material_terms(jobs)` — ten sam zakres co powiadomienie (każdy przyszły warunek
--    dodany do `job_material_terms` trafia do audytu bez zmiany tej funkcji).
-- 5. `update_published_job` (0172) — kontekst z pkt 1 zamiast `set_config`, audyt z pkt 4.
--    Reszta 1:1 z 0172.
--
-- Rollback: supabase/rollback/0967_job_edit_trusted_context.down.sql (test w scripts/test-rls.sh).
-- =============================================================================

-- --- 1. Kontekst zaufanej operacji ---------------------------------------------------------
create table public.job_operation_context (
  tx     xid8 not null default pg_current_xact_id(),
  job_id uuid not null,
  kind   text not null check (kind in ('job_edit', 'job_terms_notify')),
  primary key (tx, job_id, kind)
);
comment on table public.job_operation_context is
  'Kontekst zaufanej operacji na ofercie (0967): wstawia i usuwa wyłącznie update_published_job '
  'w tej samej transakcji. Bez grantów dla klientów — nie da się go podrobić jak GUC.';
alter table public.job_operation_context enable row level security;
revoke all on public.job_operation_context from public, anon, authenticated, service_role;

-- --- 2. Odczyt kontekstu ---------------------------------------------------------------------
create or replace function public.job_operation_context_active(p_job_id uuid, p_kind text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.job_operation_context
     where tx = pg_current_xact_id_if_assigned() and job_id = p_job_id and kind = p_kind)
$$;
revoke all on function public.job_operation_context_active(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.job_operation_context_take(p_job_id uuid, p_kind text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.job_operation_context
   where tx = pg_current_xact_id_if_assigned() and job_id = p_job_id and kind = p_kind;
  return found;
end $$;
revoke all on function public.job_operation_context_take(uuid, text)
  from public, anon, authenticated, service_role;

-- --- 3a. Wspólny warunek set_job_*: szkic albo edycja w toku (update_published_job) ---------
create or replace function public.assert_job_draft_or_editing(p_job_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text;
begin
  select status::text into v_status from public.jobs where id = p_job_id and deleted_at is null;
  if v_status is null then
    raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002';
  end if;
  -- 0967: kontekst z tabeli bez grantów (wstawia go tylko update_published_job), nie GUC.
  if v_status <> 'draft' and not public.job_operation_context_active(p_job_id, 'job_edit') then
    raise exception 'JOB_NOT_DRAFT: treść opublikowanej oferty zmienia wyłącznie update_published_job'
      using errcode = '42501';
  end if;
end $$;
revoke all on function public.assert_job_draft_or_editing(uuid) from public;

-- --- 3b. Powiadomienie o zmianie warunków (0144) ---------------------------------------------
create or replace function public.notify_job_terms_changed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb := public.job_material_terms(old);
  v_new jsonb := public.job_material_terms(new);
  v_fields text[];
begin
  -- 0967: źródło zapisu = wiersz kontekstu wstawiony przez update_published_job w tej
  -- transakcji (tabela bez grantów dla klienta), nie GUC ustawialny przez set_config.
  -- Wiersz jest zużywany: jedna rewizja = najwyżej jedno powiadomienie na kandydata.
  if not public.job_operation_context_take(new.id, 'job_terms_notify') then
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

-- --- 4. Migawka audytu edycji opublikowanej oferty -------------------------------------------
create or replace function public.job_edit_audit_snapshot(j public.jobs)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'title', j.title, 'city', j.city, 'region', j.region,
    'salary_min', j.salary_min, 'salary_max', j.salary_max,
    'salary_period', j.salary_period, 'currency', j.currency,
    'start_date', j.start_date, 'contract_type', j.contract_type,
    'working_hours', j.working_hours, 'shifts', j.shifts,
    'accommodation_kind', j.accommodation_kind, 'accommodation_cost', j.accommodation_cost,
    'accommodation_cost_period', j.accommodation_cost_period,
    'accommodation_deducted', j.accommodation_deducted,
    -- Ten sam zakres co powiadomienie kandydata (0144/0169).
    'terms', public.job_material_terms(j))
$$;
revoke all on function public.job_edit_audit_snapshot(public.jobs) from public, anon, authenticated;

-- --- 5. update_published_job (0172) + kontekst operacji + pełny audyt -----------------------
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

  -- 0967: migawka audytu z jednego źródła (job_edit_audit_snapshot ⊇ job_material_terms).
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

  -- 0967: kontekst tej rewizji w tabeli bez grantów dla klienta (zamiast GUC z 0144, który
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

  -- Relacje replace-all tymi samymi funkcjami co kreator; kontekst operacji (0967, zamiast GUC
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
