-- =============================================================================
-- 0037_recruiter_gating.sql
-- Remediacja audytu 2026-07-24 — C3 (follow-up SEC-09): propozycje i zmiany statusu aplikacji
-- wymagają roli recruiter+ (owner/admin/recruiter), spójnie z C2 (zarządzanie ofertami/PII).
-- Wcześniej wystarczało dowolne aktywne członkostwo (is_company_member/is_job_company_member) —
-- zwykły `member` mógł wysyłać propozycje i zmieniać statusy aplikacji.
--
-- Zmiana: enforce_offer_integrity (INSERT) i transition_application używają can_manage_jobs/
-- is_job_manager. respond_to_offer (strona kandydata) bez zmian.
-- =============================================================================

-- --- Propozycje: INSERT wymaga recruiter+ (send_offer idzie przez ten trigger) ---
create or replace function public.enforce_offer_integrity()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_company uuid; v_company_status text; v_job_status text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      select j.company_id, c.status::text, j.status::text
        into v_company, v_company_status, v_job_status
        from public.jobs j join public.companies c on c.id = j.company_id
        where j.id = new.job_id;
      if v_company is null then raise exception 'JOB_NOT_ACTIVE: oferta nie istnieje' using errcode = '42501'; end if;
      if not public.can_manage_jobs(v_company) then
        raise exception 'PERMISSION_DENIED: wysłanie propozycji wymaga roli recruiter+' using errcode = '42501';
      end if;
      if v_company_status <> 'verified' then raise exception 'COMPANY_NOT_VERIFIED' using errcode = '42501'; end if;
      if v_job_status <> 'active' then raise exception 'JOB_NOT_ACTIVE' using errcode = '42501'; end if;
      new.company_id := v_company;
      new.sender_id := auth.uid();
      if new.status is null or new.status not in ('draft', 'sent') then new.status := 'sent'; end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if auth.uid() is not null then
      if new.job_id is distinct from old.job_id
         or new.candidate_id is distinct from old.candidate_id
         or new.company_id is distinct from old.company_id
         or new.sender_id is distinct from old.sender_id then
        raise exception 'PERMISSION_DENIED: nie można zmienić powiązań propozycji' using errcode = '42501';
      end if;
      if new.idempotency_key is distinct from old.idempotency_key
         or new.message is distinct from old.message
         or new.locale is distinct from old.locale
         or new.sent_at is distinct from old.sent_at then
        raise exception 'PERMISSION_DENIED: payload propozycji jest niezmienny' using errcode = '42501';
      end if;
      if new.candidate_id = auth.uid()
         and new.status is distinct from old.status
         and new.status not in ('accepted', 'declined') then
        raise exception 'PERMISSION_DENIED: kandydat może jedynie zaakceptować/odrzucić propozycję' using errcode = '42501';
      end if;
      if new.candidate_id <> auth.uid()
         and new.status is distinct from old.status
         and new.status in ('accepted', 'declined') then
        raise exception 'PERMISSION_DENIED: akceptacja/odrzucenie propozycji tylko przez kandydata'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $function$;

-- --- Zmiana statusu aplikacji wymaga recruiter+ ------------------------------
create or replace function public.transition_application(
  p_application_id uuid,
  p_target text
) returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_job uuid; v_candidate uuid; v_from public.application_status;
        v_to public.application_status := p_target::public.application_status;
        v_job_title text; v_company_name text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select a.job_id, a.candidate_id, a.status, j.title, c.name
    into v_job, v_candidate, v_from, v_job_title, v_company_name
    from public.applications a
    join public.jobs j on j.id = a.job_id
    join public.companies c on c.id = j.company_id
    where a.id = p_application_id;
  if v_job is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_job_manager(v_job) then
    raise exception 'PERMISSION_DENIED: zmiana statusu wymaga roli recruiter+' using errcode = '42501';
  end if;
  if v_to not in ('viewed','shortlisted','interview','offer_sent','rejected','hired') then
    raise exception 'VALIDATION_FAILED: niedozwolone przejście statusu' using errcode = '42501';
  end if;
  if v_from = v_to then return; end if;

  update public.applications set status = v_to, updated_at = now() where id = p_application_id;

  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    values (v_candidate, 'application_status_changed', 'application_status_changed', 'application', p_application_id);
  perform public.enqueue_email(v_candidate, 'statusChanged', 'application', p_application_id,
                               'appstatus-' || p_application_id::text || '-' || v_to::text,
                               jsonb_build_object('companyName', coalesce(v_company_name, ''),
                                                  'jobTitle', coalesce(v_job_title, ''),
                                                  'status', v_to::text));
end $$;
