-- =============================================================================
-- 0977_translation_protected_terms.sql — #740: chronione nazwy (nazwa firmy) w kolejce
-- tłumaczeń AI.
--
-- NUMER TYMCZASOWY (0977) — ostateczny nadaje integrator. Zależy od 0145, 0146 i 0176.
--
-- Problem: rdzeń (0145) i worker nie przenosiły listy nazw własnych — walidator faktów
-- (`src/lib/translation/facts.ts`) dostawał pustą listę, więc zmieniona albo przetłumaczona
-- nazwa firmy w przekładzie oferty przechodziła walidację.
--
-- Zmiana:
--   1. `translation_source_revisions.protected_terms text[]` — niezmienna część rewizji
--      (trigger `translation_revision_immutable`), znormalizowana przez
--      `translation_protected_terms`: trim, NFC, bez pustych, bez duplikatów, posortowane,
--      najwyżej 10 nazw po 1–200 znaków, bez znaków sterujących (inaczej
--      VALIDATION_FAILED). Źródło WYŁĄCZNIE serwerowe: RPC tylko dla service_role.
--   2. `record_translation_source(…, p_protected_terms)` — nazwy wchodzą do odcisku rewizji
--      (ta sama treść + inna nazwa = nowa rewizja, stare zadania superseded, przekłady
--      nieaktualne); bez nazw odcisk jak w 0145. Stara 6-argumentowa sygnatura usunięta
--      (nowa ma wartość domyślną, więc wywołania 5/6 argumentów działają bez zmian).
--   3. `claim_translation_jobs` zwraca `protected_terms` (treść = 0176 poza tą kolumną) —
--      worker przekazuje je dostawcy (prompt) i walidatorowi (nazwa w źródle musi wystąpić
--      bez zmian w przekładzie, inaczej wynik odrzucony `facts_terms`).
--   4. `sync_job_translation_source` przekazuje `companies.name`; trigger na `companies`
--      reaguje też na zmianę nazwy (zmiana nazwy firmy = nowa rewizja każdej jej oferty
--      publicznej).
--   5. Wersja pipeline `translation-v2+prompt-v1+glossary-v1` (= TS
--      `TRANSLATION_PIPELINE_VERSION`, test `translation-job-sync.test.ts`).
--   6. Aktywne źródła ofert są synchronizowane ponownie (nowa rewizja z nazwą firmy), więc
--      zaległe zadania bez nazw chronionych są wygaszane.
--
-- Dowód: supabase/tests/rls.sql sekcja TP740 (kontrole ujemne: odcisk bez nazw, trigger
-- firmy bez `name`). Rollback: supabase/rollback/0977_translation_protected_terms.down.sql.
-- =============================================================================

-- --- 1. Kolumna rewizji i normalizacja -----------------------------------------------------
alter table public.translation_source_revisions
  add column if not exists protected_terms text[] not null default '{}'::text[];
alter table public.translation_source_revisions
  drop constraint if exists translation_revisions_protected_terms;
alter table public.translation_source_revisions
  add constraint translation_revisions_protected_terms
  check (cardinality(protected_terms) <= 10 and array_position(protected_terms, null) is null);

create or replace function public.translation_protected_terms(p_terms text[])
returns text[] language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_out text[];
begin
  select coalesce(array_agg(t order by t), '{}'::text[]) into v_out
    from (select distinct normalize(btrim(x, E' \t\n\r'), NFC) as t
            from unnest(coalesce(p_terms, '{}'::text[])) x
           where x is not null and btrim(x, E' \t\n\r') <> '') s;
  if cardinality(v_out) > 10 then
    raise exception 'VALIDATION_FAILED: protected_terms' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_out) t
              where char_length(t) > 200 or t ~ '[[:cntrl:]]') then
    raise exception 'VALIDATION_FAILED: protected_term' using errcode = '22023';
  end if;
  return v_out;
end $$;
revoke all on function public.translation_protected_terms(text[]) from public;
grant execute on function public.translation_protected_terms(text[]) to service_role;

-- --- 2. Zapis źródła z nazwami chronionymi -----------------------------------------------------
drop function if exists public.record_translation_source(text, uuid, text, jsonb, text, integer);
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
revoke all on function public.record_translation_source(text, uuid, text, jsonb, text, integer, text[]) from public;
grant execute on function public.record_translation_source(text, uuid, text, jsonb, text, integer, text[]) to service_role;

-- --- 3. Claim z nazwami chronionymi (treść = 0176 poza kolumną protected_terms) ---------------
drop function if exists public.claim_translation_jobs(integer, integer);
create or replace function public.claim_translation_jobs(
  p_limit integer default 10,
  p_lease_seconds integer default 300
) returns table (
  job_id uuid,
  lease_id uuid,
  lease_expires_at timestamptz,
  attempt integer,
  entity_type text,
  entity_id uuid,
  revision_id uuid,
  revision_no integer,
  source_locale text,
  target_locale text,
  pipeline_version text,
  fields jsonb,
  protected_terms text[]
) language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_lease interval := make_interval(secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 1800));
  v_recruitment boolean := public.recruitment_enabled();
begin
  -- Wygasłe dzierżawy bez prób do wykorzystania kończą się trwałym błędem.
  update public.translation_jobs j
     set status = 'failed', last_error_code = 'lease_expired', lease_id = null,
         lease_expires_at = null, completed_at = now(), updated_at = now()
   where j.status = 'leased' and j.lease_expires_at < now() and j.attempts >= j.max_attempts;

  return query
  with picked as (
    select j.id
      from public.translation_jobs j
      join public.translation_sources s
        on s.entity_type = j.entity_type and s.entity_id = j.entity_id
     where ((j.status in ('queued', 'retry') and j.next_attempt_at <= now())
            or (j.status = 'leased' and j.lease_expires_at < now()))
       and s.is_active and s.current_revision_id = j.revision_id
       and j.attempts < j.max_attempts
       -- #1152: profil kandydata tylko w trybie RECRUITMENT (zadania czekają bez kosztu).
       and (j.entity_type <> 'candidate_profile' or v_recruitment)
     order by j.next_attempt_at, j.created_at
     for update of j skip locked
     limit least(greatest(coalesce(p_limit, 10), 0), 100)
  ), leased as (
    update public.translation_jobs j
       set status = 'leased', lease_id = gen_random_uuid(), lease_expires_at = now() + v_lease,
           attempts = j.attempts + 1, updated_at = now()
      from picked p
     where j.id = p.id
    returning j.*
  )
  select l.id, l.lease_id, l.lease_expires_at, l.attempts, l.entity_type, l.entity_id,
         r.id, r.revision_no, r.source_locale, l.target_locale, l.pipeline_version, r.fields,
         r.protected_terms
    from leased l
    join public.translation_source_revisions r on r.id = l.revision_id;
end $$;
revoke all on function public.claim_translation_jobs(integer, integer) from public;
grant execute on function public.claim_translation_jobs(integer, integer) to service_role;

-- --- 4. Wersja pipeline = TS -----------------------------------------------------------------
create or replace function public.translation_pipeline_version()
returns text language sql immutable set search_path = public, pg_temp as $$
  select 'translation-v2+prompt-v1+glossary-v1'::text;
$$;
revoke all on function public.translation_pipeline_version() from public;
grant execute on function public.translation_pipeline_version() to service_role;

-- --- 5. Synchronizacja oferty: nazwa firmy z bazy (treść = 0146 poza nazwą) ---------------------
create or replace function public.sync_job_translation_source(p_job_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job record;
  v_src record;
  v_res jsonb;
begin
  if p_job_id is null then return 'purged'; end if;

  select j.status::text as status, j.deleted_at, j.expires_at, j.is_demo,
         c.status::text as company_status, c.deleted_at as company_deleted_at,
         c.name as company_name
    into v_job
    from public.jobs j join public.companies c on c.id = j.company_id
   where j.id = p_job_id;

  if not found or v_job.deleted_at is not null then
    perform public.deactivate_translation_source('job', p_job_id, true);
    return 'purged';
  end if;

  if v_job.status <> 'active'
     or (v_job.expires_at is not null and v_job.expires_at <= now())
     or v_job.company_status <> 'verified' or v_job.company_deleted_at is not null
     or v_job.is_demo then
    perform public.deactivate_translation_source('job', p_job_id, false);
    return 'hidden';
  end if;

  select * into v_src from public.job_translation_source_fields(p_job_id);
  begin
    -- #740: nazwa firmy z bazy (nigdy od klienta) = nazwa chroniona rewizji.
    v_res := public.record_translation_source('job', p_job_id, v_src.source_locale, v_src.fields,
                                              public.translation_pipeline_version(), 0,
                                              array[v_job.company_name]);
  exception when sqlstate '22023' then
    -- Treść poza limitami rdzenia: publikacja idzie dalej, stare przekłady nie udają aktualnych.
    perform public.deactivate_translation_source('job', p_job_id, false);
    return 'skipped';
  end;
  return v_res->>'status';
end $$;
revoke all on function public.sync_job_translation_source(uuid) from public;
grant execute on function public.sync_job_translation_source(uuid) to service_role;

-- Zmiana nazwy firmy = nowa rewizja ofert publicznych (trigger z 0146 + kolumna `name`).
drop trigger if exists trg_job_translation_sync_companies on public.companies;
create constraint trigger trg_job_translation_sync_companies
  after update of status, deleted_at, name on public.companies deferrable initially deferred
  for each row execute function public.trg_job_translation_sync();

-- --- 6. Ponowna synchronizacja aktywnych źródeł ofert ------------------------------------------
select count(public.sync_job_translation_source(s.entity_id))
  from public.translation_sources s
 where s.entity_type = 'job' and s.is_active;
