-- =============================================================================
-- 0146_job_translation_sync.sql — #33: automatyczne tłumaczenie ofert i ponowienie po każdej
-- edycji (na rdzeniu kolejki 0145, #31/#32).
--
-- Numer nadany przez integratora (0146). Zależy od 0145_translation_queue.sql.
--
-- Zasada: kolejka tłumaczeń oferty jest SKUTKIEM zatwierdzonego stanu oferty, a nie osobnym
-- wywołaniem w każdej ścieżce zapisu. Odroczone triggery (constraint trigger, INITIALLY
-- DEFERRED) na jobs / job_translations / job_requirements / companies wołają przy COMMIT
-- `sync_job_translation_source(job)`, która czyta stan oferty z tej samej transakcji:
--
--   * oferta publiczna (active, nieusunięta, niewygasła, firma verified i nieusunięta,
--     is_demo = false) → `record_translation_source` z polami tekstowymi w języku oferty
--     (`default_locale`): nowa treść = nowa rewizja + zadania dla pozostałych języków
--     portalu, stare zadania superseded, stare przekłady is_stale; ta sama treść = no-op;
--     ponowna aktywacja (wznowienie/ponowne otwarcie) = requeued,
--   * oferta niepubliczna (szkic, wstrzymana, zamknięta, wygasła, firma zawieszona, demo) →
--     `deactivate_translation_source(purge = false)` — zaległe zadania superseded, spóźniony
--     wynik niczego nie publikuje; szkic, który nigdy nie był publiczny, nie tworzy wpisu,
--   * oferta usunięta (deleted_at albo brak wiersza) → purge (rewizje, zadania, przekłady,
--     korekty ręczne).
--
-- Dzięki temu każda ścieżka — publish_job, update_published_job, pause/resume/reopen,
-- expire_due_jobs, decyzja moderacyjna, zmiana statusu firmy, bezpośredni DML serwera —
-- kolejkuje dokładnie zatwierdzoną treść, a rollback zapisu nie zostawia śladu w kolejce.
-- Wynagrodzenie, miasto, daty i flagi nie są polami tłumaczenia: ich zmiana nie tworzy
-- rewizji i jest od razu wspólna dla wszystkich języków (czytane z `jobs`).
--
-- Pola źródła (klucze zgodne z `translation_canonical_fields`): title, description,
-- working_hours, shifts, company_description, meta_title, meta_description,
-- responsibilities.N, conditions.N, benefits.N, highlights.N, requirements_mandatory.N,
-- requirements_optional.N (wymagania w języku oferty, w kolejności `position`).
-- Oferta ponad limit pól/znaków rdzenia (80 pól / 60 000 znaków) nie blokuje publikacji:
-- źródło jest ukrywane (przekłady nieaktualne), wynik `skipped`.
--
-- Wersja pipeline: `translation_pipeline_version()` = stała TS `TRANSLATION_PIPELINE_VERSION`
-- (src/lib/translation/pipeline.ts; test kontraktu `translation-job-sync.test.ts`).
--
-- Worker (dostawca AI) jest za flagą `AI_TRANSLATION_ENABLED` (domyślnie wyłączony): bez niej
-- zadania czekają w kolejce bez kosztu.
--
-- Rollback: drop triggerów trg_job_translation_sync_* i funkcji z tej migracji; kolejka 0145
-- zostaje (dane nie są zmieniane).
-- =============================================================================

create or replace function public.translation_pipeline_version()
returns text language sql immutable set search_path = public, pg_temp as $$
  select 'translation-v1+prompt-v1+glossary-v1'::text;
$$;
revoke all on function public.translation_pipeline_version() from public;
grant execute on function public.translation_pipeline_version() to service_role;

-- --- Pola źródła oferty -----------------------------------------------------------------------
create or replace function public.job_translation_source_fields(p_job_id uuid)
returns table (source_locale text, fields jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  with j as (
    select j.id, j.default_locale, j.title from public.jobs j where j.id = p_job_id
  ), t as (
    select jt.* from public.job_translations jt, j
     where jt.job_id = j.id and jt.locale = j.default_locale
  ), lists as (
    select 'responsibilities' as k, v, o from t, unnest(t.responsibilities) with ordinality u(v, o)
    union all select 'conditions', v, o from t, unnest(t.conditions) with ordinality u(v, o)
    union all select 'benefits', v, o from t, unnest(t.benefits) with ordinality u(v, o)
    union all select 'highlights', v, o from t, unnest(t.highlights) with ordinality u(v, o)
    union all
    select 'requirements_' || r.kind::text, r.content,
           row_number() over (partition by r.kind order by r.position, r.created_at, r.id)
      from public.job_requirements r, j
     where r.job_id = j.id and r.locale = j.default_locale
  )
  select j.default_locale,
         jsonb_strip_nulls(jsonb_build_object(
           'title', coalesce((select t.title from t), j.title),
           'description', (select t.description from t),
           'working_hours', (select t.working_hours from t),
           'shifts', (select t.shifts from t),
           'company_description', (select t.company_description from t),
           'meta_title', (select t.meta_title from t),
           'meta_description', (select t.meta_description from t)))
         || coalesce((select jsonb_object_agg(l.k || '.' || (l.o - 1), l.v)
                        from lists l where l.v is not null and l.o <= 1000), '{}'::jsonb)
    from j;
$$;
revoke all on function public.job_translation_source_fields(uuid) from public;
grant execute on function public.job_translation_source_fields(uuid) to service_role;

-- --- Synchronizacja stanu oferty z kolejką ------------------------------------------------------
-- Zwraca: created / unchanged / requeued (oferta publiczna), hidden, skipped, purged.
create or replace function public.sync_job_translation_source(p_job_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job record;
  v_src record;
  v_res jsonb;
begin
  if p_job_id is null then return 'purged'; end if;

  select j.status::text as status, j.deleted_at, j.expires_at, j.is_demo,
         c.status::text as company_status, c.deleted_at as company_deleted_at
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
    v_res := public.record_translation_source('job', p_job_id, v_src.source_locale, v_src.fields,
                                              public.translation_pipeline_version(), 0);
  exception when sqlstate '22023' then
    -- Treść poza limitami rdzenia: publikacja idzie dalej, stare przekłady nie udają aktualnych.
    perform public.deactivate_translation_source('job', p_job_id, false);
    return 'skipped';
  end;
  return v_res->>'status';
end $$;
revoke all on function public.sync_job_translation_source(uuid) from public;
grant execute on function public.sync_job_translation_source(uuid) to service_role;

-- --- Odroczone triggery ------------------------------------------------------------------------------
create or replace function public.trg_job_translation_sync()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job uuid;
  v_company uuid;
begin
  if tg_table_name = 'companies' then
    v_company := case when tg_op = 'DELETE' then old.id else new.id end;
    -- Tylko oferty, które są (albo były) w kolejce, albo mogą stać się publiczne.
    for v_job in
      select j.id from public.jobs j
       where j.company_id = v_company
         and (j.status = 'active'
              or exists (select 1 from public.translation_sources s
                          where s.entity_type = 'job' and s.entity_id = j.id))
    loop
      perform public.sync_job_translation_source(v_job);
    end loop;
    return null;
  elsif tg_table_name = 'jobs' then
    v_job := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_job := case when tg_op = 'DELETE' then old.job_id else new.job_id end;
  end if;
  -- Szkic, który nigdy nie był publiczny, nie ma czego synchronizować (bez kosztu dla kreatora).
  if tg_op <> 'DELETE' and tg_table_name <> 'jobs'
     and not exists (select 1 from public.jobs j where j.id = v_job and j.status = 'active')
     and not exists (select 1 from public.translation_sources s
                      where s.entity_type = 'job' and s.entity_id = v_job) then
    return null;
  end if;
  perform public.sync_job_translation_source(v_job);
  return null;
end $$;
revoke all on function public.trg_job_translation_sync() from public;

drop trigger if exists trg_job_translation_sync_jobs on public.jobs;
create constraint trigger trg_job_translation_sync_jobs
  after insert or delete or update of status, deleted_at, expires_at, default_locale, is_demo, title
  on public.jobs deferrable initially deferred
  for each row execute function public.trg_job_translation_sync();

drop trigger if exists trg_job_translation_sync_translations on public.job_translations;
create constraint trigger trg_job_translation_sync_translations
  after insert or update or delete on public.job_translations deferrable initially deferred
  for each row execute function public.trg_job_translation_sync();

drop trigger if exists trg_job_translation_sync_requirements on public.job_requirements;
create constraint trigger trg_job_translation_sync_requirements
  after insert or update or delete on public.job_requirements deferrable initially deferred
  for each row execute function public.trg_job_translation_sync();

drop trigger if exists trg_job_translation_sync_companies on public.companies;
create constraint trigger trg_job_translation_sync_companies
  after update of status, deleted_at on public.companies deferrable initially deferred
  for each row execute function public.trg_job_translation_sync();
