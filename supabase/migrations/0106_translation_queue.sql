-- =============================================================================
-- 0106_translation_queue.sql — #31: rewizje źródeł i kolejka tłumaczeń AI odporna na
-- edycje (fundament; wpięcie ofert #33 i profili #34 to osobne kroki).
--
-- Numer tymczasowy (koordynator nadaje ostateczny). Języki = public.supported_locales
-- (obecnie pl/nl/fr/en); zadanie powstaje dla każdego języka portalu poza językiem źródła.
--
-- 1. translation_sources — „głowa” encji (typ + id): bieżąca rewizja, aktywność. Wiersz
--    blokowany FOR UPDATE przy zapisie źródła i FOR SHARE przy zapisie wyniku, więc nowa
--    rewizja i spóźniony wynik starej nie mogą się przepleść.
-- 2. translation_source_revisions — NIEZMIENNE rewizje: kanoniczne pola (trim, CRLF→LF,
--    NFC, bez pustych), język źródła, SHA-256 kanonicznej postaci. Brak zmiany tekstu =
--    brak rewizji i brak zadań (no-op bez kosztu). Zmiana języka źródła = nowa rewizja.
-- 3. translation_jobs — zadanie na (rewizja, język docelowy, wersja pipeline/glosariusza),
--    unikat = deduplikacja. Stany queued/leased/succeeded/retry/failed/superseded, próby,
--    next_attempt_at, lease_id + lease_expires_at, kod błędu (bez treści), tokeny i model.
-- 4. translation_documents — aktualny przekład per (encja, język): pełny zestaw pól jednej
--    rewizji (bez mieszania v1/v2), pochodzenie ai/manual, wersja i autor korekty, blokada
--    korekty, znacznik `stale` po zmianie źródła.
--
-- Funkcje (wyłącznie service_role; wszystkie tabele: RLS włączone i wymuszone, brak polityk,
-- brak grantów dla anon/authenticated — domyślnie deny):
--   record_translation_source   — rewizja + zadania w transakcji WYWOŁUJĄCEGO (zapis źródła
--                                 i kolejki są atomowe; rollback nie zostawia śladu),
--   claim_translation_jobs      — FOR UPDATE SKIP LOCKED + dzierżawa; wygasła dzierżawa
--                                 (restart workera) wraca do puli; wywołanie dostawcy
--                                 odbywa się POZA transakcją (osobne wywołania RPC),
--   complete_translation_job    — CAS po lease_id + ponowna kontrola rewizji i aktywności;
--                                 wynik starej rewizji = superseded, korekta ręczna nie jest
--                                 nadpisywana (wynik zostaje jako propozycja),
--   fail_translation_job        — retry z backoffem i jitterem albo failed (błąd trwały),
--   deactivate_translation_source — ukrycie (zaległe zadania superseded) albo purge
--                                 (usunięcie konta/oferty: rewizje, zadania, przekłady),
--   save_manual_translation / release_manual_translation — korekta ręczna i jawny reset.
--
-- Rollback: drop funkcji z tej migracji i tabel translation_documents, translation_jobs,
-- translation_source_revisions, translation_sources. Migracja nie zmienia istniejących
-- danych; wyłączenie funkcji (flaga AI_TRANSLATION_ENABLED) zachowuje oryginały i korekty.
-- =============================================================================

-- --- 1. Głowa encji -------------------------------------------------------------------
create table if not exists public.translation_sources (
  entity_type          text not null,
  entity_id            uuid not null,
  current_revision_id  uuid,
  current_revision_no  integer not null default 0,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (entity_type, entity_id),
  constraint translation_sources_entity_type check (entity_type in ('job', 'candidate_profile'))
);

-- --- 2. Rewizje (niezmienne) --------------------------------------------------------------
create table if not exists public.translation_source_revisions (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null,
  entity_id     uuid not null,
  revision_no   integer not null,
  source_locale text not null references public.supported_locales(code),
  content_hash  text not null,
  fields        jsonb not null,
  created_at    timestamptz not null default now(),
  foreign key (entity_type, entity_id)
    references public.translation_sources(entity_type, entity_id) on delete cascade,
  constraint translation_revisions_no unique (entity_type, entity_id, revision_no),
  constraint translation_revisions_hash check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint translation_revisions_fields check (jsonb_typeof(fields) = 'object'),
  constraint translation_revisions_no_positive check (revision_no > 0)
);

do $$ begin
  alter table public.translation_sources
    add constraint translation_sources_current_revision
    foreign key (current_revision_id) references public.translation_source_revisions(id)
    on delete set null deferrable initially deferred;
exception when duplicate_object then null; end $$;

create or replace function public.translation_revision_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'TRANSLATION_REVISION_IMMUTABLE' using errcode = '42501';
end $$;
drop trigger if exists translation_revision_immutable on public.translation_source_revisions;
create trigger translation_revision_immutable
  before update on public.translation_source_revisions
  for each row execute function public.translation_revision_immutable();

-- --- 3. Zadania ------------------------------------------------------------------------------
create table if not exists public.translation_jobs (
  id               uuid primary key default gen_random_uuid(),
  revision_id      uuid not null references public.translation_source_revisions(id) on delete cascade,
  entity_type      text not null,
  entity_id        uuid not null,
  target_locale    text not null references public.supported_locales(code),
  pipeline_version text not null,
  status           text not null default 'queued',
  attempts         integer not null default 0,
  max_attempts     integer not null default 5,
  next_attempt_at  timestamptz not null default now(),
  lease_id         uuid,
  lease_expires_at timestamptz,
  last_error_code  text,
  outcome          text,
  result           jsonb,
  model            text,
  input_tokens     integer not null default 0,
  output_tokens    integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz,
  constraint translation_jobs_status check (
    status in ('queued', 'leased', 'succeeded', 'retry', 'failed', 'superseded')),
  constraint translation_jobs_pipeline check (pipeline_version ~ '^[a-z0-9][a-z0-9.+_-]{0,63}$'),
  constraint translation_jobs_error_code check (
    last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,40}$'),
  constraint translation_jobs_outcome check (outcome is null or outcome in ('applied', 'proposal')),
  constraint translation_jobs_attempts check (attempts >= 0 and max_attempts between 1 and 20),
  constraint translation_jobs_lease check (
    (status = 'leased') = (lease_id is not null and lease_expires_at is not null)),
  constraint translation_jobs_model check (model is null or char_length(model) <= 64),
  constraint translation_jobs_tokens check (input_tokens >= 0 and output_tokens >= 0),
  -- Deduplikacja: encja+ID wynikają z rewizji; jedna pozycja na cel i wersję pipeline.
  constraint translation_jobs_dedup unique (revision_id, target_locale, pipeline_version)
);

create index if not exists idx_translation_jobs_ready
  on public.translation_jobs (next_attempt_at, created_at)
  where status in ('queued', 'retry');
create index if not exists idx_translation_jobs_leased
  on public.translation_jobs (lease_expires_at) where status = 'leased';
create index if not exists idx_translation_jobs_entity
  on public.translation_jobs (entity_type, entity_id, status);

-- --- 4. Aktualne przekłady ---------------------------------------------------------------------
create table if not exists public.translation_documents (
  entity_type      text not null,
  entity_id        uuid not null,
  locale           text not null references public.supported_locales(code),
  revision_id      uuid references public.translation_source_revisions(id) on delete set null,
  revision_no      integer not null,
  fields           jsonb not null,
  origin           text not null,
  pipeline_version text,
  manual_version   integer not null default 0,
  manual_author    uuid references public.profiles(id) on delete set null,
  is_locked        boolean not null default false,
  is_stale         boolean not null default false,
  updated_at       timestamptz not null default now(),
  primary key (entity_type, entity_id, locale),
  foreign key (entity_type, entity_id)
    references public.translation_sources(entity_type, entity_id) on delete cascade,
  constraint translation_documents_origin check (origin in ('ai', 'manual')),
  constraint translation_documents_fields check (jsonb_typeof(fields) = 'object'),
  constraint translation_documents_lock check (not is_locked or origin = 'manual')
);

alter table public.translation_sources enable row level security;
alter table public.translation_sources force row level security;
alter table public.translation_source_revisions enable row level security;
alter table public.translation_source_revisions force row level security;
alter table public.translation_jobs enable row level security;
alter table public.translation_jobs force row level security;
alter table public.translation_documents enable row level security;
alter table public.translation_documents force row level security;
revoke all on public.translation_sources, public.translation_source_revisions,
  public.translation_jobs, public.translation_documents from public, anon, authenticated;

-- --- 5. Kanoniczne pola --------------------------------------------------------------------------
-- Wynik: obiekt {klucz: tekst} po trim, CRLF→LF i NFC, bez pustych wartości. Odrzuca wszystko,
-- co nie jest płaskim obiektem tekstów o dozwolonych kluczach i długościach.
create or replace function public.translation_canonical_fields(p_fields jsonb)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_text text;
  v_total integer := 0;
  v_count integer := 0;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'VALIDATION_FAILED: fields' using errcode = '22023';
  end if;
  for v_key, v_val in select key, value from jsonb_each(p_fields) loop
    if v_key !~ '^[a-z][a-z0-9_]{0,47}(\.[0-9]{1,3})?$' then
      raise exception 'VALIDATION_FAILED: field_key' using errcode = '22023';
    end if;
    if jsonb_typeof(v_val) <> 'string' then
      raise exception 'VALIDATION_FAILED: field_value' using errcode = '22023';
    end if;
    v_text := normalize(btrim(replace(replace(v_val #>> '{}', E'\r\n', E'\n'), E'\r', E'\n'), E' \t\n'), NFC);
    if v_text = '' then continue; end if;
    if char_length(v_text) > 10000 then
      raise exception 'VALIDATION_FAILED: field_too_long' using errcode = '22023';
    end if;
    v_total := v_total + char_length(v_text);
    v_count := v_count + 1;
    v_out := v_out || jsonb_build_object(v_key, v_text);
  end loop;
  if v_count > 80 or v_total > 60000 then
    raise exception 'VALIDATION_FAILED: fields_too_large' using errcode = '22023';
  end if;
  return v_out;
end $$;
revoke all on function public.translation_canonical_fields(jsonb) from public;
grant execute on function public.translation_canonical_fields(jsonb) to service_role;

-- --- 6. Zapis źródła: rewizja + zadania (w transakcji wywołującego) ------------------------------
-- Zwraca {status, revisionId, revisionNo, jobsQueued}; status:
--   created   — nowa rewizja, starsze zaległe zadania superseded, zadania dla języków docelowych,
--   unchanged — ta sama treść i język (no-op; ewentualnie przyspieszenie terminu zadań),
--   requeued  — ta sama treść, ale nowa wersja pipeline albo ponowna aktywacja encji.
create or replace function public.record_translation_source(
  p_entity_type text,
  p_entity_id uuid,
  p_source_locale text,
  p_fields jsonb,
  p_pipeline_version text,
  p_delay_seconds integer default 0
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_fields jsonb;
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
  v_hash := encode(sha256(convert_to(p_source_locale || E'\n' || v_fields::text, 'UTF8')), 'hex');

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
    (entity_type, entity_id, revision_no, source_locale, content_hash, fields)
  values (p_entity_type, p_entity_id, v_head.current_revision_no + 1, p_source_locale, v_hash, v_fields)
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
revoke all on function public.record_translation_source(text, uuid, text, jsonb, text, integer) from public;
grant execute on function public.record_translation_source(text, uuid, text, jsonb, text, integer) to service_role;

-- --- 7. Claim zadań ---------------------------------------------------------------------------------
-- Każde wywołanie to krótka transakcja; worker woła dostawcę PO jej zakończeniu. Wygasła
-- dzierżawa (padły worker) wraca do puli; po wyczerpaniu prób zadanie kończy się jako failed.
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
  fields jsonb
) language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_lease interval := make_interval(secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 1800));
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
         r.id, r.revision_no, r.source_locale, l.target_locale, l.pipeline_version, r.fields
    from leased l
    join public.translation_source_revisions r on r.id = l.revision_id;
end $$;
revoke all on function public.claim_translation_jobs(integer, integer) from public;
grant execute on function public.claim_translation_jobs(integer, integer) to service_role;

-- --- 8. Zapis wyniku ------------------------------------------------------------------------------------
-- Zwraca: applied (przekład aktywny), proposal (korekta ręczna zablokowana — wynik zostaje
-- w zadaniu), superseded (nowsza rewizja / encja ukryta), stale_lease (dzierżawę przejął
-- inny worker) albo not_found (zadanie usunięte razem z encją).
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
revoke all on function public.complete_translation_job(uuid, uuid, jsonb, text, integer, integer) from public;
grant execute on function public.complete_translation_job(uuid, uuid, jsonb, text, integer, integer) to service_role;

-- --- 9. Błąd zadania ---------------------------------------------------------------------------------------
-- Zwraca: retry, failed, superseded, stale_lease albo not_found. Kod błędu bez treści.
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
revoke all on function public.fail_translation_job(uuid, uuid, text, boolean, integer) from public;
grant execute on function public.fail_translation_job(uuid, uuid, text, boolean, integer) to service_role;

-- --- 10. Ukrycie / usunięcie encji ---------------------------------------------------------------------------
-- p_purge = false: encja niewidoczna (np. oferta wstrzymana) — zaległe zadania superseded,
-- przekłady zostają, spóźniony wynik niczego nie publikuje. p_purge = true: usunięcie konta
-- lub oferty — kasuje rewizje, zadania i przekłady (w tym korekty); opóźniony worker dostaje
-- not_found i niczego nie odtwarza. Zwraca liczbę wygaszonych/usuniętych zadań.
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
revoke all on function public.deactivate_translation_source(text, uuid, boolean) from public;
grant execute on function public.deactivate_translation_source(text, uuid, boolean) to service_role;

-- --- 11. Korekta ręczna -----------------------------------------------------------------------------------------
-- Autoryzację autora sprawdza wywołujący kod serwerowy (#33/#34). Korekta dotyczy bieżącej
-- rewizji, ma autora i wersję, blokuje nadpisanie przez AI. Zwraca nową wersję korekty.
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
revoke all on function public.save_manual_translation(text, uuid, text, jsonb, uuid) from public;
grant execute on function public.save_manual_translation(text, uuid, text, jsonb, uuid) to service_role;

-- Jawny reset blokady korekty. Gdy dla bieżącej rewizji czeka propozycja AI, zostaje
-- zastosowana; inaczej przekład pozostaje do czasu kolejnej rewizji. Zwraca applied/unlocked/
-- not_found.
create or replace function public.release_manual_translation(
  p_entity_type text,
  p_entity_id uuid,
  p_locale text
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_head public.translation_sources;
  v_job public.translation_jobs;
  v_rev public.translation_source_revisions;
begin
  select * into v_head from public.translation_sources
   where entity_type = p_entity_type and entity_id = p_entity_id
   for update;
  if not found then return 'not_found'; end if;
  perform 1 from public.translation_documents
   where entity_type = p_entity_type and entity_id = p_entity_id and locale = p_locale and is_locked
   for update;
  if not found then return 'not_found'; end if;

  select * into v_job from public.translation_jobs
   where revision_id = v_head.current_revision_id and target_locale = p_locale
     and status = 'succeeded' and outcome = 'proposal' and result is not null
   order by completed_at desc limit 1;

  if v_job.id is null then
    update public.translation_documents set is_locked = false, updated_at = now()
     where entity_type = p_entity_type and entity_id = p_entity_id and locale = p_locale;
    return 'unlocked';
  end if;

  select * into v_rev from public.translation_source_revisions where id = v_job.revision_id;
  update public.translation_documents
     set revision_id = v_rev.id, revision_no = v_rev.revision_no, fields = v_job.result,
         origin = 'ai', pipeline_version = v_job.pipeline_version, is_locked = false,
         is_stale = false, updated_at = now()
   where entity_type = p_entity_type and entity_id = p_entity_id and locale = p_locale;
  update public.translation_jobs set outcome = 'applied', result = null, updated_at = now()
   where id = v_job.id;
  return 'applied';
end $$;
revoke all on function public.release_manual_translation(text, uuid, text) from public;
grant execute on function public.release_manual_translation(text, uuid, text) to service_role;

revoke all on function public.translation_revision_immutable() from public;
