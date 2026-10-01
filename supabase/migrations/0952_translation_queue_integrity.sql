-- =============================================================================
-- 0952_translation_queue_integrity.sql — integralność kolejki tłumaczeń AI (#644, #754, #755).
--
-- NUMER TYMCZASOWY (0952) — ostateczny nadaje integrator. Zależy od 0145 i 0190.
--
-- 1. #644 — dzierżawa liczy się do `lease_expires_at`: `complete_translation_job`,
--    `fail_translation_job` i `defer_translation_job` zwracają `stale_lease`, gdy termin
--    dzierżawy minął, także jeśli nikt jej jeszcze nie przejął (kontrola pod tą samą blokadą
--    wiersza zadania co CAS po `lease_id`). Spóźniony worker nie zapisze wyniku, a zadanie
--    wraca do puli przez `claim_translation_jobs` (jak dotąd).
-- 2. #754 — źródło tłumaczenia tylko dla istniejącej encji: `translation_entity_exists`
--    (oferta: `jobs` bez `deleted_at` i firma bez `deleted_at`; profil: `candidate_profiles.id`
--    bez `deleted_at` i profil konta bez `deleted_at`). `record_translation_source` (treść =
--    0190) odrzuca brakującą/usuniętą encję i pomylony typ (`NOT_FOUND`) PO wstawieniu
--    głowy — strażnik trybu (0176) dalej odpowiada pierwszy `RECRUITMENT_DISABLED`, a błąd
--    cofa wstawienie. `deactivate_translation_source` odrzuca nieznany typ, a ukrycie źródła
--    encji, której już nie ma, usuwa je (purge). Jednorazowo usuwane są istniejące sieroty.
-- 3. #755 — korekta ręczna ma autora: `save_manual_translation` wymaga istniejącej encji
--    i autora (`VALIDATION_FAILED: author` dla null); autor = aktywne, nieusunięte konto
--    administratora, aktywny owner/admin/recruiter firmy oferty albo właściciel profilu
--    kandydata, inaczej `PERMISSION_DENIED`. `manual_author` zostaje nullable
--    (`ON DELETE SET NULL` po usunięciu konta autora).
--
-- Dowód: supabase/tests/rls.sql sekcja TQ952 (kontrole ujemne na definicjach sprzed 0952).
-- Rollback: supabase/rollback/0952_translation_queue_integrity.down.sql
--           (test: supabase/tests/translation-queue-integrity-rollback.sql).
-- =============================================================================

-- --- 1. Istnienie encji domenowej ------------------------------------------------------------
create or replace function public.translation_entity_exists(p_entity_type text, p_entity_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case p_entity_type
    when 'job' then exists (
      select 1 from public.jobs j join public.companies c on c.id = j.company_id
       where j.id = p_entity_id and j.deleted_at is null and c.deleted_at is null)
    when 'candidate_profile' then exists (
      select 1 from public.candidate_profiles cp join public.profiles p on p.id = cp.profile_id
       where cp.id = p_entity_id and cp.deleted_at is null and p.deleted_at is null)
    else false
  end;
$$;
revoke all on function public.translation_entity_exists(text, uuid) from public, anon, authenticated;
grant execute on function public.translation_entity_exists(text, uuid) to service_role;

-- --- 2. Zapis źródła (treść = 0190 + kontrola encji) -------------------------------------------
create or replace function public.record_translation_source(
  p_entity_type text,
  p_entity_id uuid,
  p_source_locale text,
  p_fields jsonb,
  p_pipeline_version text,
  p_delay_seconds integer default 0,
  p_protected_terms text[] default '{}'::text[]
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_fields jsonb;
  v_terms text[];
  v_hash text;
  v_head public.translation_sources;
  v_rev public.translation_source_revisions;
  v_at timestamptz := now() + make_interval(secs => least(greatest(coalesce(p_delay_seconds, 0), 0), 3600));
  v_count integer := 0;
  v_reactivated boolean := false;
begin
  if p_entity_type is null or p_entity_type not in ('job', 'candidate_profile') then
    raise exception 'VALIDATION_FAILED: entity_type' using errcode = '22023';
  end if;
  if p_entity_id is null then
    raise exception 'VALIDATION_FAILED: entity_id' using errcode = '22023';
  end if;
  if p_source_locale is null or not exists (select 1 from public.supported_locales where code = p_source_locale) then
    raise exception 'VALIDATION_FAILED: source_locale' using errcode = '22023';
  end if;
  if p_pipeline_version is null or p_pipeline_version !~ '^[a-z0-9][a-z0-9.+_-]{0,63}$' then
    raise exception 'VALIDATION_FAILED: pipeline_version' using errcode = '22023';
  end if;

  v_fields := public.translation_canonical_fields(p_fields);
  v_terms := public.translation_protected_terms(p_protected_terms);
  v_hash := encode(sha256(convert_to(p_source_locale || E'\n' || v_fields::text
              || case when cardinality(v_terms) > 0 then E'\n' || to_jsonb(v_terms)::text else '' end,
              'UTF8')), 'hex');

  insert into public.translation_sources (entity_type, entity_id)
  values (p_entity_type, p_entity_id)
  on conflict (entity_type, entity_id) do nothing;
  -- #754: encja domenowa musi istnieć (i nie być usunięta). Kontrola po wstawieniu głowy, żeby
  -- strażnik trybu (0176) odpowiadał pierwszy; wyjątek cofa wstawienie.
  if not public.translation_entity_exists(p_entity_type, p_entity_id) then
    raise exception 'NOT_FOUND: translation_entity' using errcode = 'P0002';
  end if;
  select * into v_head from public.translation_sources
   where entity_type = p_entity_type and entity_id = p_entity_id
   for update;

  if not v_head.is_active then
    v_reactivated := true;
    update public.translation_sources set is_active = true, updated_at = now()
     where entity_type = p_entity_type and entity_id = p_entity_id;
  end if;

  if v_head.current_revision_id is not null then
    select * into v_rev from public.translation_source_revisions where id = v_head.current_revision_id;
  end if;

  if v_rev.id is not null and v_rev.content_hash = v_hash then
    update public.translation_jobs
       set status = 'superseded', lease_id = null, lease_expires_at = null, updated_at = now()
     where revision_id = v_rev.id and pipeline_version <> p_pipeline_version
       and status in ('queued', 'retry', 'leased');
    update public.translation_jobs
       set status = 'queued', attempts = 0, next_attempt_at = v_at, last_error_code = null,
           updated_at = now()
     where revision_id = v_rev.id and pipeline_version = p_pipeline_version
       and status = 'superseded' and v_reactivated;
    get diagnostics v_count = row_count;
    insert into public.translation_jobs
      (revision_id, entity_type, entity_id, target_locale, pipeline_version, next_attempt_at)
    select v_rev.id, p_entity_type, p_entity_id, l.code, p_pipeline_version, v_at
      from public.supported_locales l
     where l.code <> v_rev.source_locale
    on conflict (revision_id, target_locale, pipeline_version) do nothing;
    declare v_new integer; begin
      get diagnostics v_new = row_count;
      v_count := v_count + v_new;
    end;
    update public.translation_jobs
       set next_attempt_at = least(next_attempt_at, v_at), updated_at = now()
     where revision_id = v_rev.id and pipeline_version = p_pipeline_version
       and status = 'queued' and next_attempt_at > v_at;
    return jsonb_build_object(
      'status', case when v_count > 0 then 'requeued' else 'unchanged' end,
      'revisionId', v_rev.id, 'revisionNo', v_rev.revision_no, 'jobsQueued', v_count);
  end if;

  insert into public.translation_source_revisions
    (entity_type, entity_id, revision_no, source_locale, content_hash, fields, protected_terms)
  values (p_entity_type, p_entity_id, v_head.current_revision_no + 1, p_source_locale, v_hash, v_fields, v_terms)
  returning * into v_rev;

  update public.translation_sources
     set current_revision_id = v_rev.id, current_revision_no = v_rev.revision_no, updated_at = now()
   where entity_type = p_entity_type and entity_id = p_entity_id;

  update public.translation_jobs
     set status = 'superseded', lease_id = null, lease_expires_at = null, updated_at = now()
   where entity_type = p_entity_type and entity_id = p_entity_id
     and revision_id <> v_rev.id and status in ('queued', 'retry', 'leased');

  update public.translation_documents
     set is_stale = true, updated_at = now()
   where entity_type = p_entity_type and entity_id = p_entity_id and not is_stale;

  insert into public.translation_jobs
    (revision_id, entity_type, entity_id, target_locale, pipeline_version, next_attempt_at)
  select v_rev.id, p_entity_type, p_entity_id, l.code, p_pipeline_version, v_at
    from public.supported_locales l
   where l.code <> p_source_locale
  on conflict (revision_id, target_locale, pipeline_version) do nothing;
  get diagnostics v_count = row_count;

  return jsonb_build_object('status', 'created', 'revisionId', v_rev.id,
    'revisionNo', v_rev.revision_no, 'jobsQueued', v_count);
end $$;
revoke all on function public.record_translation_source(text, uuid, text, jsonb, text, integer, text[]) from public;
grant execute on function public.record_translation_source(text, uuid, text, jsonb, text, integer, text[]) to service_role;

-- --- 3. Zapis wyniku (treść = 0145 + termin dzierżawy) ------------------------------------------
create or replace function public.complete_translation_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_fields jsonb,
  p_model text default null,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ref public.translation_jobs;
  v_job public.translation_jobs;
  v_head public.translation_sources;
  v_rev public.translation_source_revisions;
  v_doc public.translation_documents;
  v_fields jsonb;
  v_keys text[];
  v_src_keys text[];
begin
  select * into v_ref from public.translation_jobs where id = p_job_id;
  if not found then return 'not_found'; end if;

  select * into v_head from public.translation_sources
   where entity_type = v_ref.entity_type and entity_id = v_ref.entity_id
   for share;
  select * into v_job from public.translation_jobs where id = p_job_id for update;
  if not found then return 'not_found'; end if;

  if v_job.status = 'superseded' then return 'superseded'; end if;
  -- #644: CAS po lease_id ORAZ ważna dzierżawa (pod blokadą wiersza zadania). Po terminie
  -- zadanie należy do puli, nawet jeśli nikt go jeszcze nie przejął.
  if v_job.status <> 'leased' or v_job.lease_id is distinct from p_lease_id
     or v_job.lease_expires_at is null or v_job.lease_expires_at <= clock_timestamp() then
    return 'stale_lease';
  end if;

  if v_head.entity_id is null or not v_head.is_active
     or v_head.current_revision_id is distinct from v_job.revision_id then
    update public.translation_jobs
       set status = 'superseded', lease_id = null, lease_expires_at = null, updated_at = now()
     where id = p_job_id;
    return 'superseded';
  end if;

  select * into v_rev from public.translation_source_revisions where id = v_job.revision_id;
  v_fields := public.translation_canonical_fields(p_fields);
  select coalesce(array_agg(k order by k), '{}') into v_keys from jsonb_object_keys(v_fields) k;
  select coalesce(array_agg(k order by k), '{}') into v_src_keys from jsonb_object_keys(v_rev.fields) k;
  if v_keys <> v_src_keys then
    raise exception 'VALIDATION_FAILED: translation_keys' using errcode = '22023';
  end if;
  if p_model is not null and char_length(p_model) > 64 then
    raise exception 'VALIDATION_FAILED: model' using errcode = '22023';
  end if;

  select * into v_doc from public.translation_documents
   where entity_type = v_job.entity_type and entity_id = v_job.entity_id and locale = v_job.target_locale
   for update;

  if found and v_doc.is_locked then
    update public.translation_jobs
       set status = 'succeeded', outcome = 'proposal', result = v_fields, model = p_model,
           input_tokens = greatest(coalesce(p_input_tokens, 0), 0),
           output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
           lease_id = null, lease_expires_at = null, last_error_code = null,
           completed_at = now(), updated_at = now()
     where id = p_job_id;
    return 'proposal';
  end if;

  insert into public.translation_documents
    (entity_type, entity_id, locale, revision_id, revision_no, fields, origin, pipeline_version,
     is_locked, is_stale, updated_at)
  values
    (v_job.entity_type, v_job.entity_id, v_job.target_locale, v_rev.id, v_rev.revision_no, v_fields,
     'ai', v_job.pipeline_version, false, false, now())
  on conflict (entity_type, entity_id, locale) do update
     set revision_id = excluded.revision_id, revision_no = excluded.revision_no,
         fields = excluded.fields, origin = 'ai', pipeline_version = excluded.pipeline_version,
         is_stale = false, updated_at = now();

  update public.translation_jobs
     set status = 'succeeded', outcome = 'applied', result = null, model = p_model,
         input_tokens = greatest(coalesce(p_input_tokens, 0), 0),
         output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
         lease_id = null, lease_expires_at = null, last_error_code = null,
         completed_at = now(), updated_at = now()
   where id = p_job_id;
  return 'applied';
end $$;
revoke all on function public.complete_translation_job(uuid, uuid, jsonb, text, integer, integer) from public;
grant execute on function public.complete_translation_job(uuid, uuid, jsonb, text, integer, integer) to service_role;

-- --- 4. Błąd i odroczenie (treść = 0145 + termin dzierżawy) --------------------------------------
create or replace function public.fail_translation_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_error_code text,
  p_retryable boolean,
  p_retry_after_seconds integer default null
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.translation_jobs;
  v_delay double precision;
begin
  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,40}$' then
    raise exception 'VALIDATION_FAILED: error_code' using errcode = '22023';
  end if;
  select * into v_job from public.translation_jobs where id = p_job_id for update;
  if not found then return 'not_found'; end if;
  if v_job.status = 'superseded' then return 'superseded'; end if;
  if v_job.status <> 'leased' or v_job.lease_id is distinct from p_lease_id
     or v_job.lease_expires_at is null or v_job.lease_expires_at <= clock_timestamp() then
    return 'stale_lease';
  end if;

  if coalesce(p_retryable, false) and v_job.attempts < v_job.max_attempts then
    v_delay := least(3600, 30 * power(2, greatest(v_job.attempts - 1, 0))) * (0.8 + random() * 0.4);
    if p_retry_after_seconds is not null then
      v_delay := greatest(v_delay, least(greatest(p_retry_after_seconds, 0), 3600));
    end if;
    update public.translation_jobs
       set status = 'retry', last_error_code = p_error_code,
           next_attempt_at = now() + make_interval(secs => v_delay),
           lease_id = null, lease_expires_at = null, updated_at = now()
     where id = p_job_id;
    return 'retry';
  end if;

  update public.translation_jobs
     set status = 'failed', last_error_code = p_error_code, lease_id = null,
         lease_expires_at = null, completed_at = now(), updated_at = now()
   where id = p_job_id;
  return 'failed';
end $$;
revoke all on function public.fail_translation_job(uuid, uuid, text, boolean, integer) from public;
grant execute on function public.fail_translation_job(uuid, uuid, text, boolean, integer) to service_role;

create or replace function public.defer_translation_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_error_code text,
  p_delay_seconds integer
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.translation_jobs;
begin
  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,40}$' then
    raise exception 'VALIDATION_FAILED: error_code' using errcode = '22023';
  end if;
  select * into v_job from public.translation_jobs where id = p_job_id for update;
  if not found then return 'not_found'; end if;
  if v_job.status = 'superseded' then return 'superseded'; end if;
  if v_job.status <> 'leased' or v_job.lease_id is distinct from p_lease_id
     or v_job.lease_expires_at is null or v_job.lease_expires_at <= clock_timestamp() then
    return 'stale_lease';
  end if;
  update public.translation_jobs
     set status = 'retry', last_error_code = p_error_code,
         attempts = greatest(v_job.attempts - 1, 0),
         next_attempt_at = now() + make_interval(secs => least(greatest(coalesce(p_delay_seconds, 300), 1), 3600)),
         lease_id = null, lease_expires_at = null, updated_at = now()
   where id = p_job_id;
  return 'deferred';
end $$;
revoke all on function public.defer_translation_job(uuid, uuid, text, integer) from public;
grant execute on function public.defer_translation_job(uuid, uuid, text, integer) to service_role;

-- --- 5. Ukrycie / usunięcie (treść = 0145 + typ encji + sieroty) ----------------------------------
create or replace function public.deactivate_translation_source(
  p_entity_type text,
  p_entity_id uuid,
  p_purge boolean default false
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count integer := 0;
  v_purge boolean := coalesce(p_purge, false);
begin
  if p_entity_type is null or p_entity_type not in ('job', 'candidate_profile') then
    raise exception 'VALIDATION_FAILED: entity_type' using errcode = '22023';
  end if;
  perform 1 from public.translation_sources
   where entity_type = p_entity_type and entity_id = p_entity_id
   for update;
  if not found then return 0; end if;

  -- #754: źródło encji, której już nie ma (albo jest usunięta), nie zostaje jako ukryte — purge.
  if not v_purge and not public.translation_entity_exists(p_entity_type, p_entity_id) then
    v_purge := true;
  end if;

  if v_purge then
    select count(*) into v_count from public.translation_jobs
     where entity_type = p_entity_type and entity_id = p_entity_id;
    update public.translation_sources set current_revision_id = null
     where entity_type = p_entity_type and entity_id = p_entity_id;
    delete from public.translation_sources
     where entity_type = p_entity_type and entity_id = p_entity_id;
    return v_count;
  end if;

  update public.translation_sources set is_active = false, updated_at = now()
   where entity_type = p_entity_type and entity_id = p_entity_id;
  update public.translation_jobs
     set status = 'superseded', lease_id = null, lease_expires_at = null, updated_at = now()
   where entity_type = p_entity_type and entity_id = p_entity_id
     and status in ('queued', 'retry', 'leased');
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.deactivate_translation_source(text, uuid, boolean) from public;
grant execute on function public.deactivate_translation_source(text, uuid, boolean) to service_role;

-- --- 6. Korekta ręczna z autorem (treść = 0145 + encja + autor) -----------------------------------
create or replace function public.save_manual_translation(
  p_entity_type text,
  p_entity_id uuid,
  p_locale text,
  p_fields jsonb,
  p_author uuid
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_head public.translation_sources;
  v_rev public.translation_source_revisions;
  v_fields jsonb;
  v_keys text[];
  v_src_keys text[];
  v_version integer;
begin
  -- #755: korekta zawsze ma autora (null dopiero po usunięciu konta, ON DELETE SET NULL).
  if p_author is null then
    raise exception 'VALIDATION_FAILED: author' using errcode = '22023';
  end if;
  select * into v_head from public.translation_sources
   where entity_type = p_entity_type and entity_id = p_entity_id
   for update;
  if not found or v_head.current_revision_id is null
     or not public.translation_entity_exists(p_entity_type, p_entity_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Autor: aktywne, nieusunięte konto — administrator, recruiter+ firmy oferty albo właściciel
  -- profilu kandydata.
  if not exists (
    select 1 from public.profiles p
     where p.id = p_author and p.is_active and p.deleted_at is null
       and (p.role = 'admin'
            or (p_entity_type = 'job' and exists (
                  select 1 from public.jobs j
                    join public.company_members cm on cm.company_id = j.company_id
                   where j.id = p_entity_id and j.deleted_at is null
                     and cm.profile_id = p.id and cm.is_active
                     and cm.role in ('owner', 'admin', 'recruiter')))
            or (p_entity_type = 'candidate_profile' and exists (
                  select 1 from public.candidate_profiles cp
                   where cp.id = p_entity_id and cp.deleted_at is null and cp.profile_id = p.id)))
  ) then
    raise exception 'PERMISSION_DENIED: author' using errcode = '42501';
  end if;
  select * into v_rev from public.translation_source_revisions where id = v_head.current_revision_id;
  if p_locale is null or p_locale = v_rev.source_locale
     or not exists (select 1 from public.supported_locales where code = p_locale) then
    raise exception 'VALIDATION_FAILED: locale' using errcode = '22023';
  end if;
  v_fields := public.translation_canonical_fields(p_fields);
  select coalesce(array_agg(k order by k), '{}') into v_keys from jsonb_object_keys(v_fields) k;
  select coalesce(array_agg(k order by k), '{}') into v_src_keys from jsonb_object_keys(v_rev.fields) k;
  if v_keys <> v_src_keys then
    raise exception 'VALIDATION_FAILED: translation_keys' using errcode = '22023';
  end if;

  insert into public.translation_documents as d
    (entity_type, entity_id, locale, revision_id, revision_no, fields, origin, manual_version,
     manual_author, is_locked, is_stale, updated_at)
  values
    (p_entity_type, p_entity_id, p_locale, v_rev.id, v_rev.revision_no, v_fields, 'manual', 1,
     p_author, true, false, now())
  on conflict (entity_type, entity_id, locale) do update
     set revision_id = excluded.revision_id, revision_no = excluded.revision_no,
         fields = excluded.fields, origin = 'manual', manual_version = d.manual_version + 1,
         manual_author = excluded.manual_author, is_locked = true, is_stale = false,
         pipeline_version = null, updated_at = now()
  returning manual_version into v_version;
  return v_version;
end $$;
revoke all on function public.save_manual_translation(text, uuid, text, jsonb, uuid) from public;
grant execute on function public.save_manual_translation(text, uuid, text, jsonb, uuid) to service_role;

-- --- 7. Jednorazowo: sieroty (źródła encji, których nie ma albo są usunięte) -------------------------
select count(public.deactivate_translation_source(s.entity_type, s.entity_id, true))
  from public.translation_sources s
 where not public.translation_entity_exists(s.entity_type, s.entity_id);
