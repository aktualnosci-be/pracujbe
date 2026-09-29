-- =============================================================================
-- 0179_dsa_appeal_reviewer_active.sql
--
-- #909: nieaktywny administrator (profiles.is_active = false) blokował rozpatrzenie
-- odwołania DSA. Loader kolejki (`listAppeals`, src/lib/data/admin-dsa.ts) i RPC
-- `admin_decide_appeal` (0104, nadpisane w 0109) liczyły „innego administratora"
-- WYŁĄCZNIE po `role = 'admin' AND deleted_at IS NULL`, pomijając `is_active`. Konto
-- wyłączone operacyjnie (bez roli/usunięcia) nie może się zalogować (src/lib/auth/session.ts
-- odrzuca sesję), ale nadal liczyło się jako „dostępny inny recenzent" — autor pierwotnej
-- decyzji dostawał REVIEWER_CONFLICT, mimo że nikt inny nie mógł wejść do panelu i rozpatrzyć
-- odwołania. Kontrakt „inny AKTYWNY administrator" (PR #518) ma teraz spójne egzekwowanie
-- w RPC i w loaderze podglądu konfliktu.
--
-- Fix: dopisać `AND is_active = true` do warunku „inny administrator" w obu miejscach —
-- RPC (poniżej, create or replace tej samej sygnatury co 0109) i loader (admin-dsa.ts,
-- ten sam plik commitu). Reszta ciała funkcji bez zmian względem 0109.
-- =============================================================================

create or replace function public.admin_decide_appeal(
  p_appeal_id        uuid,
  p_expected_status  text,
  p_outcome          text,
  p_reasoning        text,
  p_new_decision     text default null,
  p_ground_type      text default null,
  p_ground_reference text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid       uuid := auth.uid();
  v_reasoning text := btrim(coalesce(p_reasoning, ''));
  v_ground    text := nullif(btrim(coalesce(p_ground_type, '')), '');
  v_gref      text := nullif(btrim(coalesce(p_ground_reference, '')), '');
  v_appeal    record;
  v_dec       record;
  v_report    record;
  v_same      boolean;
  v_rest      uuid;
  v_new       uuid;
  v_number    text;
  v_job_id    uuid;
  v_company_id uuid;
  v_prev      text;
  v_lock      uuid;
  v_title     text;
  v_owner     uuid;
  v_locale    text;
  v_reviewed  uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if p_outcome is null or p_outcome not in ('upheld', 'reversed') then
    raise exception 'VALIDATION_FAILED: OUTCOME' using errcode = '22023';
  end if;
  if char_length(v_reasoning) < 20 then
    raise exception 'VALIDATION_FAILED: REASONING_REQUIRED' using errcode = '22023';
  end if;
  if char_length(v_reasoning) > 1000 then
    raise exception 'VALIDATION_FAILED: REASONING_TOO_LONG' using errcode = '22023';
  end if;

  select a.* into v_appeal from public.moderation_appeals a where a.id = p_appeal_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_expected_status is null or v_appeal.status is distinct from p_expected_status then
    raise exception 'STALE_STATE: status odwołania zmienił się (%)', v_appeal.status;
  end if;
  if v_appeal.status <> 'pending' then
    raise exception 'INVALID_TRANSITION: odwołanie rozpatrzone' using errcode = '22023';
  end if;

  select d.* into v_dec from public.moderation_decisions d where d.id = v_appeal.decision_id;
  select r.id, r.status, r.target_type::text as target_type, r.target_id, r.case_number,
         r.reporter_id, r.reporter_email, r.reporter_name
    into v_report from public.reports r where r.id = v_appeal.report_id for update;

  -- Ponowny przegląd przez innego człowieka niż autor rozstrzygnięcia, od którego jest
  -- odwołanie — o ile jest inny AKTYWNY administrator (#909: wyłączone konto nie liczy
  -- się jako dostępny recenzent). Odwołanie od cofnięcia (#43, 0109): autorem
  -- rozstrzygnięcia jest osoba, która cofnęła ograniczenie, nie autor decyzji.
  if v_appeal.appealed_restoration_id is not null then
    select mr.restored_by into v_reviewed
      from public.moderation_restorations mr where mr.id = v_appeal.appealed_restoration_id;
  else
    v_reviewed := v_dec.decided_by;
  end if;
  v_same := v_reviewed is not distinct from v_uid;
  if v_same and exists (
       select 1 from public.profiles p
        where p.role = 'admin' and p.deleted_at is null and p.is_active = true and p.id <> v_uid) then
    raise exception 'REVIEWER_CONFLICT: odwołanie rozpatruje inny administrator' using errcode = '42501';
  end if;

  if p_outcome = 'reversed' and v_appeal.appellant_role = 'author' then
    -- Cofnięcie ograniczenia (albo zapis cofnięcia już dokonanego ręcznie w międzyczasie).
    select r.id into v_rest from public.moderation_restorations r where r.decision_id = v_dec.id;
    if v_rest is null then
      v_rest := public.moderation_restore_core(v_dec.id, v_reasoning, false);
    end if;

  elsif p_outcome = 'reversed' then
    -- Ponowne zastosowanie skutku: nowa decyzja ograniczająca w sprawie zgłaszającego.
    if p_new_decision is null or p_new_decision not in ('job_removed', 'company_suspended') then
      raise exception 'VALIDATION_FAILED: DECISION' using errcode = '22023';
    end if;
    if v_ground is null or v_ground not in ('terms', 'law') then
      raise exception 'VALIDATION_FAILED: GROUND_REQUIRED' using errcode = '22023';
    end if;
    if v_gref is null or char_length(v_gref) < 3 then
      raise exception 'VALIDATION_FAILED: GROUND_REFERENCE_REQUIRED' using errcode = '22023';
    end if;
    if char_length(v_gref) > 300 then
      raise exception 'VALIDATION_FAILED: GROUND_REFERENCE_TOO_LONG' using errcode = '22023';
    end if;

    if v_report.target_type = 'job' then
      v_job_id := v_report.target_id;
      select j.company_id into v_company_id from public.jobs j where j.id = v_job_id;
    else
      v_company_id := v_report.target_id;
      if p_new_decision = 'job_removed' then
        raise exception 'VALIDATION_FAILED: DECISION_SCOPE' using errcode = '22023';
      end if;
    end if;

    if p_new_decision = 'job_removed' then
      select j.status::text, j.moderation_decision_id, j.title into v_prev, v_lock, v_title
        from public.jobs j where j.id = v_job_id and j.deleted_at is null for update;
    else
      select c.status::text, c.moderation_decision_id into v_prev, v_lock
        from public.companies c where c.id = v_company_id and c.deleted_at is null for update;
    end if;
    if not found then raise exception 'NOT_FOUND: treść nie istnieje' using errcode = 'P0002'; end if;
    if v_lock is not null then
      select d.previous_status into v_prev from public.moderation_decisions d where d.id = v_lock;
    end if;

    v_new := gen_random_uuid();
    v_number := 'DEC-' || upper(substr(replace(v_new::text, '-', ''), 1, 4) || '-'
                || substr(replace(v_new::text, '-', ''), 5, 4) || '-'
                || substr(replace(v_new::text, '-', ''), 9, 4));
    insert into public.moderation_decisions(
      id, reference, report_id, decision, job_id, company_id, facts, ground_type, ground_reference,
      automated_detection, previous_status, decided_by, appeal_id)
    values (
      v_new, v_number, v_report.id, p_new_decision,
      case when p_new_decision = 'job_removed' then v_job_id end, v_company_id,
      v_reasoning, v_ground, v_gref, v_dec.automated_detection, v_prev, v_uid, v_appeal.id);

    perform set_config('pracujbe.moderation', 'on', true);
    if p_new_decision = 'job_removed' and v_lock is null then
      update public.jobs set status = 'closed', moderation_decision_id = v_new, updated_at = now()
        where id = v_job_id;
    elsif p_new_decision = 'company_suspended' and v_lock is null then
      update public.companies
        set status = 'suspended', status_reason = v_reasoning, moderation_decision_id = v_new, updated_at = now()
        where id = v_company_id;
    end if;
    perform set_config('pracujbe.moderation', '', true);

    perform set_config('pracujbe.appeal', 'on', true);
    update public.reports
      set status = 'resolved', decision_id = v_new, resolved_by = v_uid, resolved_at = now(), updated_at = now()
      where id = v_report.id;
    perform set_config('pracujbe.appeal', '', true);

    insert into public.report_events(report_id, event_type, to_status, actor_id, decision_id)
      values (v_report.id, 'decision', 'resolved', v_uid, v_new);
    perform public.write_audit('moderation.decided', 'report', v_report.id,
      jsonb_build_object('status', v_report.status::text, 'decisionId', v_dec.id),
      jsonb_strip_nulls(jsonb_build_object(
        'status', 'resolved', 'decision', p_new_decision, 'decisionId', v_new, 'reference', v_number,
        'appealId', v_appeal.id, 'jobId', case when p_new_decision = 'job_removed' then v_job_id end,
        'companyId', v_company_id, 'previousStatus', v_prev, 'groundType', v_ground,
        'groundReference', v_gref, 'automatedDetection', v_dec.automated_detection)));

    -- Autor treści: uzasadnienie nowej decyzji w JEGO języku (jak w admin_decide_report).
    for v_owner in
      select cm.profile_id from public.company_members cm
       where cm.company_id = v_company_id and cm.role = 'owner'
         and public.company_recipient_ok(v_company_id, cm.profile_id)
    loop
      insert into public.notifications (profile_id, type, title, entity_type, entity_id, data)
        values (v_owner, 'system'::public.notification_type, 'moderation_decision', 'company', v_company_id,
                jsonb_build_object('kind', 'moderation', 'decision', p_new_decision, 'decisionId', v_new));
      perform public.enqueue_email(v_owner,
        case when p_new_decision = 'job_removed' then 'moderationJobRemoved' else 'moderationCompanySuspended' end,
        'moderation_decision', v_new,
        'moderation-decision-' || v_new::text || '-' || v_owner::text,
        jsonb_strip_nulls(jsonb_build_object(
          'companyName', (select c.name from public.companies c where c.id = v_company_id),
          'jobTitle', v_title, 'facts', v_reasoning, 'groundType', v_ground, 'groundReference', v_gref,
          'automatedDetection', v_dec.automated_detection, 'decisionReference', v_number)));
    end loop;
  end if;

  perform set_config('pracujbe.appeal', 'on', true);
  update public.moderation_appeals
    set status = p_outcome, outcome_reasoning = v_reasoning, decided_by = v_uid, decided_at = now(),
        same_reviewer = v_same, restoration_id = v_rest, new_decision_id = v_new, updated_at = now()
    where id = v_appeal.id;
  perform set_config('pracujbe.appeal', '', true);

  insert into public.report_events(report_id, event_type, actor_id, decision_id)
    values (v_report.id, 'appeal_decided', v_uid, v_dec.id);
  perform public.write_audit('moderation.appeal_decided', 'report', v_report.id,
    jsonb_build_object('appealId', v_appeal.id, 'status', 'pending'),
    jsonb_strip_nulls(jsonb_build_object(
      'appealId', v_appeal.id, 'reference', v_appeal.reference, 'status', p_outcome,
      'appellantRole', v_appeal.appellant_role, 'decisionId', v_dec.id, 'newDecisionId', v_new,
      'restorationId', v_rest, 'appealedRestorationId', v_appeal.appealed_restoration_id,
      'sameReviewer', v_same)));

  -- Osoba odwołująca się: wynik z uzasadnieniem w JEJ języku, bez danych drugiej strony.
  if v_appeal.appellant_role = 'author' then
    if v_appeal.appellant_id is not null then
      insert into public.notifications (profile_id, type, title, entity_type, entity_id, data)
        values (v_appeal.appellant_id, 'system'::public.notification_type, 'moderation_appeal', 'company',
                v_dec.company_id,
                jsonb_build_object('kind', 'moderation', 'decision', 'appeal_' || p_outcome,
                                   'decisionId', v_dec.id, 'appealId', v_appeal.id));
      perform public.enqueue_email(v_appeal.appellant_id,
        case when p_outcome = 'upheld' then 'appealUpheld' else 'appealReversed' end, 'moderation_appeal', v_appeal.id,
        'appeal-decided-' || v_appeal.id::text,
        jsonb_strip_nulls(jsonb_build_object(
          'appealReference', v_appeal.reference, 'decisionReference', v_dec.reference,
          'appellantRole', 'author', 'reasoning', v_reasoning,
          'companyName', (select c.name from public.companies c where c.id = v_dec.company_id))));
    end if;
  else
    v_locale := v_appeal.appellant_locale;
    if v_report.reporter_id is not null
       and exists (select 1 from public.profiles p where p.id = v_report.reporter_id and p.deleted_at is null) then
      v_locale := public.resolve_recipient_locale(v_report.reporter_id);
    end if;
    perform public.enqueue_email_to_address(
      v_report.reporter_email::text, v_locale, v_report.reporter_id,
      case when p_outcome = 'upheld' then 'appealUpheld' else 'appealReversed' end, 'moderation_appeal',
      v_appeal.id, 'appeal-decided-' || v_appeal.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'appealReference', v_appeal.reference, 'caseNumber', v_report.case_number,
        'appellantRole', 'reporter', 'reasoning', v_reasoning,
        'appealTarget', case when v_appeal.appealed_restoration_id is not null then 'restoration' end,
        'recipientName', v_report.reporter_name)));
  end if;

  return v_appeal.id;
end $$;
revoke all on function public.admin_decide_appeal(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_decide_appeal(uuid, text, text, text, text, text, text) to authenticated;
