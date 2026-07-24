-- =============================================================================
-- 0040_state_and_role_hardening.sql
-- Remediacja audytu produkcyjnego 2026-07-24 — P1-03/P1-04/P1-05/P1-06.
--
-- P1-03: dane firmy mógł edytować KAŻDY aktywny członek (companies UPDATE = is_company_member).
--        → wymagamy owner/admin (is_company_admin).
-- P1-04: konto pracodawcy/admina mogło założyć profil kandydata i aplikować (RPC sprawdzały
--        tylko sesję). → egzekwujemy profiles.role='candidate' w ensure_candidate_profile
--        (pokrywa onboarding: set_candidate_*, finish_onboarding) oraz w apply_to_job.
-- P1-05: transition_application dopuszczał przejścia niepoprawne logicznie (hired->rejected,
--        withdrawn->hired) i wyścig (brak blokady/CAS). → walidacja targetu przed rzutem,
--        FOR UPDATE, MACIERZ przejść, compare-and-swap.
-- P1-06: withdraw_application blokował tylko ponowne 'withdrawn' — pozwalał wycofać po
--        hired/rejected/offer_*. → wycofanie tylko ze stanów aktywnych.
-- =============================================================================

-- --- P1-03: edycja danych firmy tylko owner/admin ------------------------------
drop policy if exists companies_update_member on public.companies;
create policy companies_update_member on public.companies
  for update to authenticated
  using (public.is_company_admin(id))
  with check (public.is_company_admin(id));

-- --- P1-04: helper roli + egzekwowanie roli kandydata --------------------------
create or replace function public.current_profile_role()
returns text language sql stable security definer set search_path = public as $$
  select role::text from public.profiles where id = auth.uid();
$$;

create or replace function public.ensure_candidate_profile()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cp uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  -- P1-04: tylko konto kandydata może mieć/tworzyć profil kandydata (model ról).
  if public.current_profile_role() <> 'candidate' then
    raise exception 'PERMISSION_DENIED: profil kandydata tylko dla konta kandydata' using errcode = '42501';
  end if;
  insert into public.candidate_profiles(profile_id) values (auth.uid())
    on conflict (profile_id) do nothing;
  select id into v_cp from public.candidate_profiles where profile_id = auth.uid();
  return v_cp;
end $$;
revoke all on function public.ensure_candidate_profile() from public;

-- --- P1-04 + P1-01(notyfikacje): apply_to_job wymaga roli kandydata; powiadamia recruiter+ --
create or replace function public.apply_to_job(
  p_job_id uuid,
  p_idempotency_key text,
  p_phone text default null,
  p_availability text default null,
  p_message text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_company uuid; v_app_id uuid; v_locale text; v_job_title text;
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
    select id into v_app_id from public.applications where candidate_id = v_uid and job_id = p_job_id;
    return v_app_id;
  end if;

  -- P1-01: powiadom/e-mail tylko do recruiter+ (owner/admin/recruiter), nie do każdego membera.
  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    select cm.profile_id, 'application_received', 'application_received', 'application', v_app_id
    from public.company_members cm
    where cm.company_id = v_company and cm.is_active = true and cm.role in ('owner','admin','recruiter');

  perform public.enqueue_email(cm.profile_id, 'newApplication', 'application', v_app_id,
                               'app-' || v_app_id::text || '-' || cm.profile_id::text,
                               jsonb_build_object('candidateName', coalesce(public.profile_full_name(v_uid), '—'),
                                                  'jobTitle', coalesce(v_job_title, '')))
    from public.company_members cm
    where cm.company_id = v_company and cm.is_active = true and cm.role in ('owner','admin','recruiter');

  return v_app_id;
end $$;

-- --- P1-05: maszyna stanów aplikacji (macierz + FOR UPDATE + CAS) --------------
create or replace function public.transition_application(
  p_application_id uuid,
  p_target text
) returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_job uuid; v_candidate uuid; v_from public.application_status;
        v_to public.application_status; v_job_title text; v_company_name text; v_allowed boolean;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  -- Walidacja targetu jako TEKST przed rzutowaniem (kontrolowany błąd, nie surowy błąd enuma).
  if p_target is null or p_target not in ('viewed','shortlisted','interview','offer_sent','rejected','hired') then
    raise exception 'VALIDATION_FAILED: niedozwolony status docelowy' using errcode = '42501';
  end if;
  v_to := p_target::public.application_status;

  -- Blokada wiersza aplikacji (koniec wyścigu równoległych żądań).
  select a.job_id, a.candidate_id, a.status, j.title, c.name
    into v_job, v_candidate, v_from, v_job_title, v_company_name
    from public.applications a
    join public.jobs j on j.id = a.job_id
    join public.companies c on c.id = j.company_id
    where a.id = p_application_id
    for update of a;

  if v_job is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_job_manager(v_job) then
    raise exception 'PERMISSION_DENIED: zmiana statusu wymaga roli recruiter+' using errcode = '42501';
  end if;
  if v_from = v_to then return; end if; -- idempotencja

  -- Macierz dozwolonych przejść: tylko „do przodu"; stany końcowe bez wyjścia
  -- (blokuje np. hired->rejected, rejected->hired, withdrawn->hired).
  v_allowed := case v_from
    when 'draft'       then v_to in ('viewed','shortlisted','interview','offer_sent','rejected')
    when 'submitted'   then v_to in ('viewed','shortlisted','interview','offer_sent','rejected')
    when 'viewed'      then v_to in ('shortlisted','interview','offer_sent','rejected','hired')
    when 'shortlisted' then v_to in ('interview','offer_sent','rejected','hired')
    when 'interview'   then v_to in ('shortlisted','offer_sent','rejected','hired')
    when 'offer_sent'  then v_to in ('hired','rejected')
    else false
  end;
  if not v_allowed then
    raise exception 'VALIDATION_FAILED: niedozwolone przejście statusu % -> %', v_from, v_to
      using errcode = '42501';
  end if;

  -- Compare-and-swap: zapis tylko gdy status niezmieniony od odczytu (podwójna ochrona z FOR UPDATE).
  update public.applications set status = v_to, updated_at = now()
    where id = p_application_id and status = v_from;
  if not found then
    raise exception 'VALIDATION_FAILED: stan aplikacji zmienił się równolegle' using errcode = '42501';
  end if;

  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    values (v_candidate, 'application_status_changed', 'application_status_changed', 'application', p_application_id);
  perform public.enqueue_email(v_candidate, 'statusChanged', 'application', p_application_id,
                               'appstatus-' || p_application_id::text || '-' || v_to::text,
                               jsonb_build_object('companyName', coalesce(v_company_name, ''),
                                                  'jobTitle', coalesce(v_job_title, ''),
                                                  'status', v_to::text));
end $$;

-- --- P1-06: wycofanie aplikacji tylko ze stanów aktywnych ----------------------
create or replace function public.withdraw_application(p_application_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is null then
    raise exception 'PERMISSION_DENIED: brak sesji' using errcode = '42501';
  end if;

  select status::text into v_status
  from public.applications
  where id = p_application_id and candidate_id = auth.uid() and deleted_at is null
  for update;

  if v_status is null then
    raise exception 'NOT_FOUND: aplikacja nie istnieje lub brak dostępu' using errcode = 'P0002';
  end if;

  -- Idempotencja: już wycofana → zwróć bez zmiany.
  if v_status = 'withdrawn' then return v_status; end if;

  -- P1-06: wycofać można tylko z aktywnego procesu; stany końcowe (hired/rejected/
  -- offer_accepted/offer_declined) są niezmienne (integralność historii rekrutacji).
  if v_status not in ('draft','submitted','viewed','shortlisted','interview','offer_sent') then
    raise exception 'VALIDATION_FAILED: nie można wycofać aplikacji w stanie %', v_status
      using errcode = '42501';
  end if;

  update public.applications
    set status = 'withdrawn', updated_at = now()
    where id = p_application_id and candidate_id = auth.uid() and status::text = v_status;
  if not found then
    raise exception 'VALIDATION_FAILED: stan aplikacji zmienił się równolegle' using errcode = '42501';
  end if;

  return 'withdrawn';
end $$;
revoke all on function public.withdraw_application(uuid) from public;
grant execute on function public.withdraw_application(uuid) to authenticated;
