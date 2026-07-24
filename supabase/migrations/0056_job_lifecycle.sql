-- =============================================================================
-- 0056_job_lifecycle.sql
-- Remediacja audytu 2026-07-24 (AUDIT_REPORT) — P1-04: brak cyklu życia ofert.
--
-- Problem: pracodawca mógł tylko UTWORZYĆ ofertę. Opublikowanej nie dało się wstrzymać, zamknąć
-- ani ponownie otworzyć — błędne/wygasłe treści wymagały ingerencji w bazę. RLS pozwalał na
-- bezpośredni UPDATE statusu (poza 'active', które chroni guard trigger), więc przejścia nie
-- miały ŻADNEJ maszyny stanów: active→draft, closed→paused itp. przechodziły bez kontroli.
--
-- Naprawa: JEDNA transakcyjna funkcja `set_job_status(job, action)` z macierzą przejść:
--   pause : active            → paused
--   resume: paused            → active   (limit planu + firma verified)
--   close : active | paused   → closed
--   reopen: closed | expired  → active   (limit planu + firma verified + KOMPLETNOŚĆ jak publish)
-- oraz guard trigger `guard_job_status`, który odbiera klientowi bezpośrednią zmianę statusu
-- (dotąd chronione było tylko przejście na 'active'). Draft→active zostaje wyłącznie w publish_job.
-- =============================================================================

-- --- guard: zmiana statusu oferty tylko przez RPC (publish_job / set_job_status) --------------
create or replace function public.guard_job_status()
returns trigger language plpgsql set search_path = public as $$
begin
  -- SECURITY DEFINER RPC (właściciel: postgres) oraz backend service_role piszą dalej.
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' and new.status <> 'draft' then
    raise exception 'PERMISSION_DENIED: oferta może powstać wyłącznie jako szkic'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    raise exception 'PERMISSION_DENIED: zmiana statusu oferty wyłącznie przez publish_job/set_job_status'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_job_status on public.jobs;
create trigger trg_guard_job_status
  before insert or update on public.jobs
  for each row execute function public.guard_job_status();

-- --- set_job_status: transakcyjna maszyna stanów cyklu życia oferty ---------------------------
create or replace function public.set_job_status(p_job_id uuid, p_action text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_company uuid; v_cstatus text; v_status text; v_target text;
  v_title text; v_city text; v_region text;
  v_has_translation boolean; v_has_mandatory boolean;
  v_max integer; v_active integer; v_expires timestamptz;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_action not in ('pause', 'resume', 'close', 'reopen') then
    raise exception 'VALIDATION_FAILED: nieznana operacja' using errcode = '42501';
  end if;

  -- Blokada wiersza oferty — serializuje równoległe zmiany statusu (koniec wyścigu).
  select j.company_id, c.status::text, j.status::text, j.title, j.city, j.region, j.expires_at
    into v_company, v_cstatus, v_status, v_title, v_city, v_region, v_expires
    from public.jobs j join public.companies c on c.id = j.company_id
    where j.id = p_job_id and j.deleted_at is null
    for update of j;

  if v_company is null then raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002'; end if;
  if not public.can_manage_jobs(v_company) then
    raise exception 'PERMISSION_DENIED: zarządzanie ofertą wymaga roli recruiter+' using errcode = '42501';
  end if;

  -- Macierz przejść (koniec dowolnych skoków statusu).
  v_target := case
    when p_action = 'pause'  and v_status = 'active'                    then 'paused'
    when p_action = 'resume' and v_status = 'paused'                    then 'active'
    when p_action = 'close'  and v_status in ('active', 'paused')       then 'closed'
    when p_action = 'reopen' and v_status in ('closed', 'expired')      then 'active'
    else null
  end;
  if v_target is null then
    raise exception 'VALIDATION_FAILED: niedozwolone przejście % z stanu %', p_action, v_status
      using errcode = '42501';
  end if;

  -- Aktywacja (resume/reopen) wymaga zweryfikowanej firmy i mieści się w limicie planu (P1-01).
  if v_target = 'active' then
    if v_cstatus <> 'verified' then
      raise exception 'COMPANY_NOT_VERIFIED: firma nie jest zweryfikowana' using errcode = '42501';
    end if;
    v_max := public.company_max_active_jobs(v_company);
    select count(*) into v_active from public.jobs
      where company_id = v_company and status = 'active' and deleted_at is null;
    if v_active >= v_max then
      raise exception 'ENTITLEMENT_LIMIT: limit aktywnych ofert w planie (%)', v_max using errcode = '42501';
    end if;

    -- Ponowne otwarcie zamkniętej/wygasłej oferty = te same kryteria kompletności co publikacja.
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

  -- CAS na stanie źródłowym (równoległa zmiana nie może przejść dwa razy).
  update public.jobs
    set status = v_target::public.job_status,
        -- Reopen wygasłej/zamkniętej oferty: zdejmij przeszłą datę ważności, by nie znikła od razu
        -- z warstwy publicznej (P1-11 filtruje expires_at <= now()).
        expires_at = case
          when v_target = 'active' and v_expires is not null and v_expires <= now() then null
          else expires_at
        end,
        -- Pierwsza aktywacja po reopenie bez published_at (np. import) ustawia znacznik publikacji.
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
