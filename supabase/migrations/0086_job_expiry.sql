-- =============================================================================
-- 0086_job_expiry.sql
-- #72: spójne wygaszanie ofert po `expires_at` — operacja domenowa dla maintenance
-- oraz reguły cyklu życia dla ofert po terminie.
--
-- 1. expire_due_jobs() → integer (tylko service_role): atomowo zmienia WYŁĄCZNIE
--    status 'active' z niepustym `expires_at <= now()` na 'expired' i zwraca liczbę
--    zmienionych rekordów. Szkic, wstrzymana, zamknięta, bez daty lub z datą przyszłą —
--    bez zmian. Wiersze zablokowane przez równoległą transakcję są pomijane
--    (SKIP LOCKED) i trafią do następnego przebiegu: dwa równoległe lub ponowione
--    wywołania nie zgłaszają błędu i nie zmieniają rekordu dwa razy. Funkcja nie wysyła
--    powiadomień ani e-maili (brak efektów ubocznych do zdublowania).
--    Publiczne odczyty i aplikowanie nadal same filtrują `expires_at > now()` (0048,
--    get_job_match_profile 0074) — poprawność nie zależy od crona.
-- 2. publish_job (0073) — szkic z `expires_at <= now()` → JOB_EXPIRED (zamiast aktywnej,
--    a publicznie niewidocznej oferty). Reszta 1:1 z 0073.
-- 3. set_job_status (0062):
--    * `resume` wstrzymanej oferty po terminie → JOB_EXPIRED (data nie jest już czyszczona
--      po cichu; oferta nie staje się bezterminowa bez decyzji użytkownika);
--    * `reopen` dozwolone także dla oferty active/paused po terminie (cron mógł jeszcze
--      nie przejść) — ponowne otwarcie usuwa przeszłą datę, jak dotąd dla closed/expired.
--    Reszta 1:1 z 0062.
-- 4. Indeks częściowy pod zapytanie maintenance.
--
-- Rollback: wyłączyć harmonogram maintenance (operacja jest idempotentna i bez efektów
-- ubocznych), następnie NOWA migracja naprawcza: drop function public.expire_due_jobs(),
-- drop index public.idx_jobs_active_expires_at, odtworzyć publish_job z 0073 i
-- set_job_status z 0062. Nie edytować tej migracji po zastosowaniu. Migracja nie zmienia
-- danych (status zmienia dopiero wywołanie expire_due_jobs).
-- =============================================================================

-- --- 1. expire_due_jobs ------------------------------------------------------------
create or replace function public.expire_due_jobs()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  with due as (
    select j.id
      from public.jobs j
      where j.status = 'active'
        and j.expires_at is not null
        and j.expires_at <= now()
      for update skip locked
  )
  update public.jobs j
    set status = 'expired'
    from due
    where j.id = due.id
      and j.status = 'active';
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.expire_due_jobs() from public, anon, authenticated;
grant execute on function public.expire_due_jobs() to service_role;

create index if not exists idx_jobs_active_expires_at
  on public.jobs(expires_at)
  where status = 'active' and expires_at is not null;

-- --- 2. publish_job (0073) + kontrola expires_at -----------------------------------
create or replace function public.publish_job(p_job_id uuid, p_slug text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid; v_cstatus text; v_status text;
  v_title text; v_city text; v_region text; v_slug text; v_new_slug text;
  v_has_translation boolean; v_has_mandatory boolean;
  v_expires timestamptz;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  select j.company_id, c.status::text, j.status::text, j.title, j.city, j.region, j.slug, j.expires_at
    into v_company, v_cstatus, v_status, v_title, v_city, v_region, v_slug, v_expires
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

-- --- 3. set_job_status (0062) — resume/reopen po terminie ---------------------------
create or replace function public.set_job_status(p_job_id uuid, p_action text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid; v_cstatus text; v_status text; v_target text;
  v_title text; v_city text; v_region text;
  v_has_translation boolean; v_has_mandatory boolean;
  v_expires timestamptz; v_past_due boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_action not in ('pause', 'resume', 'close', 'reopen') then
    raise exception 'VALIDATION_FAILED: nieznana operacja' using errcode = '42501';
  end if;

  select j.company_id, c.status::text, j.status::text, j.title, j.city, j.region, j.expires_at
    into v_company, v_cstatus, v_status, v_title, v_city, v_region, v_expires
    from public.jobs j join public.companies c on c.id = j.company_id
    where j.id = p_job_id and j.deleted_at is null
    for update of j;

  if v_company is null then raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002'; end if;
  if not public.can_manage_jobs(v_company) then
    raise exception 'PERMISSION_DENIED: zarządzanie ofertą wymaga roli recruiter+' using errcode = '42501';
  end if;

  v_past_due := v_expires is not null and v_expires <= now();

  -- #72: wznowienie po terminie wymaga świadomego ponownego otwarcia (które usuwa datę).
  if p_action = 'resume' and v_status = 'paused' and v_past_due then
    raise exception 'JOB_EXPIRED: termin ważności oferty minął — otwórz ją ponownie' using errcode = '42501';
  end if;

  v_target := case
    when p_action = 'pause'  and v_status = 'active' and not v_past_due then 'paused'
    when p_action = 'resume' and v_status = 'paused'               then 'active'
    when p_action = 'close'  and v_status in ('active', 'paused')  then 'closed'
    when p_action = 'reopen' and v_status in ('closed', 'expired') then 'active'
    when p_action = 'reopen' and v_status in ('active', 'paused') and v_past_due then 'active'
    else null
  end;
  if v_target is null then
    raise exception 'VALIDATION_FAILED: niedozwolone przejście % z stanu %', p_action, v_status
      using errcode = '42501';
  end if;

  if v_target = 'active' then
    if v_cstatus <> 'verified' then
      raise exception 'COMPANY_NOT_VERIFIED: firma nie jest zweryfikowana' using errcode = '42501';
    end if;

    if p_action = 'reopen' then
      if v_title is null or btrim(v_title) = '' or v_title ilike 'draft%' or v_title ilike '%placeholder%'
         or v_city is null or btrim(v_city) = '' or v_region is null or btrim(v_region) = '' then
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
        raise exception 'VALIDATION_FAILED: oferta niekompletna (opis i obowiązki)' using errcode = '42501';
      end if;
      select exists (
        select 1 from public.job_requirements r
        where r.job_id = p_job_id and r.kind = 'mandatory' and coalesce(btrim(r.content), '') <> ''
      ) into v_has_mandatory;
      if not v_has_mandatory then
        raise exception 'VALIDATION_FAILED: brak wymagań obowiązkowych' using errcode = '42501';
      end if;
    end if;
  end if;

  update public.jobs
    set status = v_target::public.job_status,
        -- Przeszłą datę usuwa tylko ponowne otwarcie (resume po terminie jest odrzucane wyżej).
        expires_at = case
          when p_action = 'reopen' and v_past_due then null
          else expires_at
        end,
        published_at = case when v_target = 'active' and published_at is null then now() else published_at end,
        updated_at = now()
    where id = p_job_id and status::text = v_status;
  if not found then
    raise exception 'VALIDATION_FAILED: oferta zmieniła stan równolegle' using errcode = '42501';
  end if;

  return v_target;
end $$;
revoke all on function public.set_job_status(uuid, text) from public;
grant execute on function public.set_job_status(uuid, text) to authenticated;
