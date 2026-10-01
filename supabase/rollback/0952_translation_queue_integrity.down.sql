-- Rollback 0952 (numer tymczasowy): przywraca definicje sprzed kontroli integralności kolejki
-- tłumaczeń (#644, #754, #755) — record_translation_source z 0190, complete/fail/defer,
-- deactivate i save_manual_translation z 0145 — oraz usuwa translation_entity_exists.
-- create or replace zachowuje granty. Usuniętych sierot (krok 7 migracji) nie odtwarza.
-- Test: supabase/tests/translation-queue-integrity-rollback.sql.


-- z 0190_translation_protected_terms.sql
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
  -- Chronione nazwy wchodzą do odcisku rewizji: zmiana nazwy firmy = nowa rewizja. Bez nazw
  -- odcisk jest taki sam jak w 0145 (rewizje encji bez nazw chronionych bez zmian).
  v_hash := encode(sha256(convert_to(p_source_locale || E'\n' || v_fields::text
              || case when cardinality(v_terms) > 0 then E'\n' || to_jsonb(v_terms)::text else '' end,
              'UTF8')), 'hex');

  insert into public.translation_sources (entity_type, entity_id)
  values (p_entity_type, p_entity_id)
  on conflict (entity_type, entity_id) do nothing;
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
    -- Ta sama treść. Zadania innej wersji pipeline dla tej rewizji są wygaszane i zastępowane.
    update public.translation_jobs
       set status = 'superseded', lease_id = null, lease_expires_at = null, updated_at = now()
     where revision_id = v_rev.id and pipeline_version <> p_pipeline_version
       and status in ('queued', 'retry', 'leased');
    -- Encja ponownie aktywna: zadania wygaszone przy ukryciu wracają do kolejki.
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
    -- Publikacja przyspiesza oczekujące zadania bieżącej rewizji (nigdy ich nie opóźnia).
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

  -- Starsze rewizje: zaległe zadania nieaktualne (dzierżawa też — wynik zostanie odrzucony).
  update public.translation_jobs
     set status = 'superseded', lease_id = null, lease_expires_at = null, updated_at = now()
   where entity_type = p_entity_type and entity_id = p_entity_id
     and revision_id <> v_rev.id and status in ('queued', 'retry', 'leased');

  -- Istniejące przekłady nie udają aktualnych (korekty ręczne zostają, ale jako nieaktualne).
  update public.translation_documents
     set is_stale = true, updated_at = now()
   where entity_type = p_entity_type and entity_id = p_entity_id and not is_stale;

  -- Przekład w języku nowego źródła nie jest potrzebny: nie powstaje dla niego zadanie.
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

-- z 0145_translation_queue.sql
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

  -- Ta sama kolejność blokad co w record_translation_source: najpierw głowa, potem zadanie.
  select * into v_head from public.translation_sources
   where entity_type = v_ref.entity_type and entity_id = v_ref.entity_id
   for share;
  select * into v_job from public.translation_jobs where id = p_job_id for update;
  if not found then return 'not_found'; end if;

  if v_job.status = 'superseded' then return 'superseded'; end if;
  if v_job.status <> 'leased' or v_job.lease_id is distinct from p_lease_id then
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
  -- Pełny zestaw pól tej rewizji — bez brakujących i bez dodatkowych kluczy.
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

-- z 0145_translation_queue.sql
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
  if v_job.status <> 'leased' or v_job.lease_id is distinct from p_lease_id then
    return 'stale_lease';
  end if;

  if coalesce(p_retryable, false) and v_job.attempts < v_job.max_attempts then
    -- Backoff wykładniczy (30 s · 2^(próba−1), max 1 h) z jitterem ±20%; Retry-After dostawcy
    -- (429) jest dolną granicą.
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

-- z 0145_translation_queue.sql
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
  if v_job.status <> 'leased' or v_job.lease_id is distinct from p_lease_id then
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

-- z 0145_translation_queue.sql
create or replace function public.deactivate_translation_source(
  p_entity_type text,
  p_entity_id uuid,
  p_purge boolean default false
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer := 0;
begin
  perform 1 from public.translation_sources
   where entity_type = p_entity_type and entity_id = p_entity_id
   for update;
  if not found then return 0; end if;

  if coalesce(p_purge, false) then
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

-- z 0145_translation_queue.sql
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
  select * into v_head from public.translation_sources
   where entity_type = p_entity_type and entity_id = p_entity_id
   for update;
  if not found or v_head.current_revision_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
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

drop function if exists public.translation_entity_exists(text, uuid);
