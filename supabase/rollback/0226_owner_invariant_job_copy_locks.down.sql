-- =============================================================================
-- Rollback 0226_owner_invariant_job_copy_locks.sql — przywraca definicje sprzed migracji:
-- set_company_member_role / set_company_member_active (0086), enforce_owner_invariants (0185)
-- i duplicate_job_as_draft (0148). UWAGA: przywraca wyścig #778 (firma bez właściciela) i odczyt
-- źródła kopii bez blokady (#1098).
-- Test: supabase/tests/owner-copy-locks-rollback.sql (scripts/test-rls.sh).
-- =============================================================================

create or replace function public.set_company_member_role(p_member_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_m public.company_members%rowtype; v_role public.company_member_role;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('owner', 'admin', 'recruiter', 'member') then
    raise exception 'VALIDATION_FAILED: rola' using errcode = '22023';
  end if;
  v_role := p_role::public.company_member_role;
  select * into v_m from public.company_members cm where cm.id = p_member_id for update;
  if not found or not public.is_company_admin(v_m.company_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_m.profile_id = auth.uid() then
    raise exception 'VALIDATION_FAILED: własne członkostwo' using errcode = '22023';
  end if;
  if not public.can_manage_company_role(v_m.company_id, v_m.role)
     or not public.can_manage_company_role(v_m.company_id, v_role) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if not v_m.is_active then
    raise exception 'VALIDATION_FAILED: członkostwo nieaktywne' using errcode = '22023';
  end if;
  if v_m.role = v_role then return; end if;
  if v_m.role = 'owner' and public.count_other_active_owners(v_m.company_id, v_m.id) = 0 then
    raise exception 'VALIDATION_FAILED: firma musi mieć co najmniej jednego aktywnego właściciela'
      using errcode = '42501';
  end if;
  update public.company_members set role = v_role where id = v_m.id;
  perform public.write_audit('company.member_role_changed', 'company', v_m.company_id,
    jsonb_build_object('member_id', v_m.id, 'role', v_m.role),
    jsonb_build_object('member_id', v_m.id, 'role', v_role));
end $$;
revoke all on function public.set_company_member_role(uuid, text) from public, anon;
grant execute on function public.set_company_member_role(uuid, text) to authenticated;

create or replace function public.set_company_member_active(p_member_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_m public.company_members%rowtype;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_active is null then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  select * into v_m from public.company_members cm where cm.id = p_member_id for update;
  if not found or not public.is_company_admin(v_m.company_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_m.profile_id = auth.uid() then
    raise exception 'VALIDATION_FAILED: własne członkostwo' using errcode = '22023';
  end if;
  if not public.can_manage_company_role(v_m.company_id, v_m.role) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if v_m.is_active = p_active then return; end if;
  if not p_active and v_m.role = 'owner'
     and public.count_other_active_owners(v_m.company_id, v_m.id) = 0 then
    raise exception 'VALIDATION_FAILED: firma musi mieć co najmniej jednego aktywnego właściciela'
      using errcode = '42501';
  end if;
  update public.company_members set is_active = p_active where id = v_m.id;
  perform public.write_audit(
    case when p_active then 'company.member_reactivated' else 'company.member_deactivated' end,
    'company', v_m.company_id,
    jsonb_build_object('member_id', v_m.id, 'is_active', v_m.is_active),
    jsonb_build_object('member_id', v_m.id, 'is_active', p_active));
end $$;
revoke all on function public.set_company_member_active(uuid, boolean) from public, anon;
grant execute on function public.set_company_member_active(uuid, boolean) to authenticated;

create or replace function public.enforce_owner_invariants()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Zaufane role (bootstrap/RPC definer=postgres, admin=service_role, seed) — pomijamy.
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'owner' and not public.is_company_owner(new.company_id) then
      raise exception 'PERMISSION_DENIED: rolę owner nadaje wyłącznie właściciel firmy'
        using errcode = '42501';
    end if;
    if not public.can_manage_company_role(new.company_id, new.role) then
      raise exception 'PERMISSION_DENIED: brak uprawnień do tej roli' using errcode = '42501';
    end if;
    return new;

  elsif tg_op = 'UPDATE' then
    -- 0165: tożsamość wiersza (firma, konto, zaproszenie, daty) tylko przez RPC.
    if new.id is distinct from old.id
       or new.company_id is distinct from old.company_id
       or new.profile_id is distinct from old.profile_id
       or new.invited_by is distinct from old.invited_by
       or new.invited_at is distinct from old.invited_at
       or new.joined_at is distinct from old.joined_at
       or new.created_at is distinct from old.created_at then
      raise exception 'PERMISSION_DENIED: kolumny tożsamości członkostwa są niezmienne'
        using errcode = '42501';
    end if;
    -- Nadanie lub odebranie roli owner tylko przez aktywnego ownera.
    if (new.role = 'owner') is distinct from (old.role = 'owner') then
      if not public.is_company_owner(new.company_id) then
        raise exception 'PERMISSION_DENIED: zmianę roli owner wykonuje wyłącznie właściciel firmy'
          using errcode = '42501';
      end if;
    end if;
    -- #403: zmiana roli/aktywności wymaga uprawnień do starej i nowej roli.
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      if not public.can_manage_company_role(old.company_id, old.role)
         or not public.can_manage_company_role(old.company_id, new.role) then
        raise exception 'PERMISSION_DENIED: brak uprawnień do tej roli' using errcode = '42501';
      end if;
    end if;
    -- Nie pozostaw firmy bez aktywnego ownera (demote lub dezaktywacja ostatniego).
    if (old.role = 'owner' and old.is_active)
       and (new.role <> 'owner' or new.is_active = false) then
      if not exists (
        select 1 from public.company_members cm
         where cm.company_id = old.company_id and cm.role = 'owner' and cm.is_active
           and cm.id <> old.id) then
        raise exception 'VALIDATION_FAILED: firma musi mieć co najmniej jednego aktywnego właściciela'
          using errcode = '42501';
      end if;
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    -- Usunięcie cudzego członkostwa tylko w granicach hierarchii (własne = opuszczenie firmy).
    if old.profile_id is distinct from auth.uid()
       and not public.can_manage_company_role(old.company_id, old.role) then
      raise exception 'PERMISSION_DENIED: brak uprawnień do tej roli' using errcode = '42501';
    end if;
    if old.role = 'owner' and old.is_active then
      if not exists (
        select 1 from public.company_members cm
         where cm.company_id = old.company_id and cm.role = 'owner' and cm.is_active
           and cm.id <> old.id) then
        raise exception 'VALIDATION_FAILED: nie można usunąć ostatniego aktywnego właściciela firmy'
          using errcode = '42501';
      end if;
    end if;
    return old;
  end if;
  return new;
end $$;

create or replace function public.duplicate_job_as_draft(p_job_id uuid, p_client_key uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_src public.jobs%rowtype;
  v_cstatus text; v_clock uuid;
  v_existing_src uuid; v_existing_new uuid; v_existing_company uuid;
  v_new uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_job_id is null or p_client_key is null then
    raise exception 'VALIDATION_FAILED: brak oferty albo klucza' using errcode = '42501';
  end if;

  -- Serializacja ponowień tego samego klucza (dwa równoległe kliknięcia = jeden szkic).
  perform pg_advisory_xact_lock(hashtextextended('job_duplicate:' || v_uid::text || ':' || p_client_key::text, 0));

  select d.source_job_id, d.new_job_id, d.company_id
    into v_existing_src, v_existing_new, v_existing_company
    from public.job_duplications d
    where d.created_by = v_uid and d.client_key = p_client_key;
  if v_existing_new is not null then
    if v_existing_src is distinct from p_job_id then
      raise exception 'VALIDATION_FAILED: klucz użyty dla innej oferty' using errcode = '42501';
    end if;
    if not public.can_manage_jobs(v_existing_company) then
      raise exception 'PERMISSION_DENIED: kopiowanie oferty wymaga roli recruiter+' using errcode = '42501';
    end if;
    return v_existing_new;
  end if;

  select * into v_src from public.jobs j where j.id = p_job_id and j.deleted_at is null;
  if v_src.id is null or not public.is_company_member(v_src.company_id) then
    raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002';
  end if;
  if not public.can_manage_jobs(v_src.company_id) then
    raise exception 'PERMISSION_DENIED: kopiowanie oferty wymaga roli recruiter+' using errcode = '42501';
  end if;

  select c.status::text, c.moderation_decision_id into v_cstatus, v_clock
    from public.companies c where c.id = v_src.company_id;
  if v_cstatus = 'suspended' or v_clock is not null then
    raise exception 'COMPANY_SUSPENDED: firma zawieszona' using errcode = '42501';
  end if;
  if v_src.moderation_decision_id is not null then
    raise exception 'MODERATION_LOCKED: oferta wycofana decyzją moderacyjną' using errcode = '42501';
  end if;

  insert into public.jobs (
    company_id, created_by, slug, default_locale, title, status, category, occupation,
    contract_type, city, region, address, remote, salary_min, salary_max, currency,
    salary_period, working_hours, shifts, start_immediately, immediate, start_date,
    min_experience_years, requires_driving_license, no_language_required, accommodation,
    transport, contact_email, is_demo)
  values (
    v_src.company_id, v_uid, 'draft-' || gen_random_uuid()::text, v_src.default_locale,
    v_src.title, 'draft', v_src.category, v_src.occupation, v_src.contract_type, v_src.city,
    v_src.region, v_src.address, v_src.remote, v_src.salary_min, v_src.salary_max,
    v_src.currency, v_src.salary_period, v_src.working_hours, v_src.shifts,
    v_src.start_immediately, v_src.immediate, v_src.start_date, v_src.min_experience_years,
    v_src.requires_driving_license, v_src.no_language_required, v_src.accommodation,
    v_src.transport, v_src.contact_email, v_src.is_demo)
  returning id into v_new;

  -- Tłumaczenie w języku oferty (tytuł zawsze z jobs.title — jak save_job_draft).
  insert into public.job_translations (job_id, locale, title, description, responsibilities,
                                       conditions, benefits, highlights, working_hours, shifts,
                                       company_description)
    select v_new, t.locale, v_src.title, t.description, t.responsibilities, t.conditions,
           t.benefits, t.highlights, t.working_hours, t.shifts, t.company_description
      from public.job_translations t
      where t.job_id = p_job_id and t.locale = v_src.default_locale;

  insert into public.job_requirements (job_id, locale, kind, position, content)
    select v_new, r.locale, r.kind, r.position, r.content
      from public.job_requirements r where r.job_id = p_job_id
      order by r.kind, r.position, r.created_at, r.id;

  insert into public.job_skills (job_id, skill_id, skill_label, is_mandatory)
    select v_new, s.skill_id, s.skill_label, s.is_mandatory
      from public.job_skills s where s.job_id = p_job_id
      order by s.created_at, s.id;

  insert into public.job_languages (job_id, language_label, level)
    select v_new, l.language_label, l.level
      from public.job_languages l where l.job_id = p_job_id
      order by l.created_at, l.id;

  insert into public.job_certificates (job_id, certificate_label)
    select v_new, c.certificate_label
      from public.job_certificates c where c.job_id = p_job_id
      order by c.created_at, c.id;

  -- Pytania: trigger 0103 liczy ryzyko i zgłasza NOWY przegląd dla nowego szkicu.
  insert into public.job_screening_questions (job_id, position, type, required, prompt, options)
    select v_new, q.position, q.type, q.required, q.prompt, q.options
      from public.job_screening_questions q where q.job_id = p_job_id
      order by q.position;

  insert into public.job_duplications (company_id, source_job_id, new_job_id, created_by, client_key)
    values (v_src.company_id, p_job_id, v_new, v_uid, p_client_key);

  perform public.write_audit('job.duplicated', 'job', v_new, null,
    jsonb_build_object('source_job_id', p_job_id, 'company_id', v_src.company_id,
                       'status', 'draft'));

  return v_new;
end $$;
revoke all on function public.duplicate_job_as_draft(uuid, uuid) from public, anon;
grant execute on function public.duplicate_job_as_draft(uuid, uuid) to authenticated;
