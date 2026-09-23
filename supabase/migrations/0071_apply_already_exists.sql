-- =============================================================================
-- 0071 — apply_to_job rozróżnia ponowienie od ponownej aplikacji (#361).
--
-- Dotąd istniejąca para (candidate_id, job_id) zawsze zwracała id istniejącej
-- aplikacji, więc nowa próba (np. po wycofaniu) kończyła się komunikatem sukcesu,
-- choć status się nie zmieniał i firma nie dostawała powiadomienia.
-- Teraz:
--   * ten sam p_idempotency_key co zapisany w aplikacji → retry → zwrot id (Invariant #4);
--   * inny klucz (albo brak zapisanego klucza) → wyjątek APPLICATION_ALREADY_EXISTS.
-- Reszta funkcji skopiowana 1:1 z 0070.
-- Rollback: odtworzyć apply_to_job z 0070. Migracja nie zmienia danych.
-- =============================================================================

create or replace function public.apply_to_job(
  p_job_id uuid,
  p_idempotency_key text,
  p_phone text default null,
  p_availability text default null,
  p_message text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_company uuid; v_app_id uuid; v_locale text; v_job_title text;
        v_existing_key text;
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
    select id, idempotency_key into v_app_id, v_existing_key
      from public.applications where candidate_id = v_uid and job_id = p_job_id;
    -- Ten sam klucz = ponowienie tej samej próby (retry/podwójne kliknięcie) → sukces, bez
    -- duplikatu. Inny klucz = nowa, świadoma próba na ofertę, na którą kandydat już
    -- aplikował (także wycofaną/odrzuconą) → jawny błąd zamiast fałszywego sukcesu (#361).
    if v_existing_key is distinct from p_idempotency_key then
      raise exception 'APPLICATION_ALREADY_EXISTS' using errcode = '23505';
    end if;
    return v_app_id;
  end if;

  -- Powiadom/e-mail tylko aktywnych recruiter+ z aktywnym profilem (0070).
  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    select cm.profile_id, 'application_received', 'application_received', 'application', v_app_id
    from public.company_members cm
    where cm.company_id = v_company and public.company_recipient_ok(v_company, cm.profile_id);

  perform public.enqueue_email(cm.profile_id, 'newApplication', 'application', v_app_id,
                               'app-' || v_app_id::text || '-' || cm.profile_id::text,
                               jsonb_build_object('candidateName', coalesce(public.profile_full_name(v_uid), '—'),
                                                  'jobTitle', coalesce(v_job_title, '')))
    from public.company_members cm
    where cm.company_id = v_company and public.company_recipient_ok(v_company, cm.profile_id);

  return v_app_id;
end $$;
