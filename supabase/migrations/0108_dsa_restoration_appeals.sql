-- =============================================================================
-- 0108 — DSA: odwołanie zgłaszającego od COFNIĘCIA ograniczenia (#43, „Otwarte”).
-- Numer TYMCZASOWY (ostatni w main + 1) — ostateczny nada integrator.
--
-- Buduje na maszynie odwołań z 0104 (ta sama tabela, ten sam `admin_decide_appeal`):
-- 1. `moderation_appeals.appealed_restoration_id` — odwołanie od cofnięcia
--    (`moderation_restorations`), wyłącznie zgłaszającego. Jedno odwołanie od decyzji
--    (jak dotąd) i jedno od każdego cofnięcia; odwołanie od cofnięcia wskazuje decyzję, której
--    cofnięcie dotyczy (`decision_id`), więc skutek uwzględnienia jest ten sam co przy
--    odwołaniu zgłaszającego od braku działań: NOWA decyzja ograniczająca z `appeal_id`.
-- 2. Poinformowanie zgłaszającego: `admin_restore_moderation` (ręczne cofnięcie) kolejkuje
--    e-mail `reportRestored` w JĘZYKU ZGŁASZAJĄCEGO (Invariant #1: profil →
--    `resolve_recipient_locale`, gość — język formularza). Termin odwołania biegnie od
--    faktycznego wysłania tego e-maila (`moderation_restoration_informed_at`) — jak w 0104.
-- 3. Od cofnięcia, które jest skutkiem uwzględnionego odwołania AUTORA (albo zbiega się
--    z jego odwołaniem w toku), odwołanie nie przysługuje — to już rozstrzygnięcie po
--    ponownym przeglądzie (INVALID_TRANSITION); e-mail też nie wychodzi. Odwołać się można
--    tylko od cofnięcia decyzji, która nadal rozstrzyga sprawę.
-- 4. Rozpatrzenie: inny człowiek niż osoba, która COFNĘŁA ograniczenie (REVIEWER_CONFLICT,
--    gdy jest inny administrator; inaczej `same_reviewer`).
-- 5. Retencja (`dsa_retention_cases`/`_run`), raport (`againstRestoration`) i eksport
--    (wiersz na decyzję) uwzględniają nowy rodzaj odwołania; e-maile o cofnięciu tracą treść
--    przy anonimizacji sprawy.
--
-- Treść prawna o procedurze — bez zmian: znacznik „do uzupełnienia” (#40). Wartości terminów
-- (`dsa_appeal_window` itd.) — nadal tymczasowe z 0104.
--
-- Rollback (odwołania są dowodem — przed rollbackiem wyeksportować `moderation_appeals`):
-- drop functions submit_report_restoration_appeal, moderation_restoration_informed_at,
-- moderation_restoration_appeal_deadline, moderation_restoration_appealable,
-- moderation_appeal_restoration_check (+ trigger); przywrócić z 0104: admin_restore_moderation,
-- moderation_appealable, admin_decide_appeal, get_report_case, dsa_retention_cases,
-- dsa_retention_run, dsa_transparency_report, dsa_statements_export, unikat
-- `moderation_appeals_decision_uq(decision_id)` (wymaga usunięcia odwołań od cofnięcia);
-- drop column `appealed_restoration_id`.
-- =============================================================================

-- --- 1. Odwołanie od cofnięcia -------------------------------------------------------------
alter table public.moderation_appeals
  add column if not exists appealed_restoration_id uuid
    references public.moderation_restorations(id) on delete restrict;
alter table public.moderation_appeals drop constraint if exists moderation_appeals_restoration_role;
alter table public.moderation_appeals add constraint moderation_appeals_restoration_role check (
  appealed_restoration_id is null or appellant_role = 'reporter'
);

drop index if exists public.moderation_appeals_decision_uq;
create unique index if not exists moderation_appeals_decision_uq
  on public.moderation_appeals(decision_id) where appealed_restoration_id is null;
create unique index if not exists moderation_appeals_restoration_uq
  on public.moderation_appeals(appealed_restoration_id) where appealed_restoration_id is not null;

-- Cofnięcie musi dotyczyć decyzji odwołania (strażnik niezależny od RPC).
create or replace function public.moderation_appeal_restoration_check()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.appealed_restoration_id is not null and not exists (
       select 1 from public.moderation_restorations mr
        where mr.id = new.appealed_restoration_id and mr.decision_id = new.decision_id) then
    raise exception 'PERMISSION_DENIED: cofnięcie nie dotyczy tej decyzji' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.moderation_appeal_restoration_check() from public;
drop trigger if exists trg_moderation_appeal_restoration_check on public.moderation_appeals;
create trigger trg_moderation_appeal_restoration_check
  before insert on public.moderation_appeals
  for each row execute function public.moderation_appeal_restoration_check();

-- --- 2. Terminy od poinformowania zgłaszającego o cofnięciu -------------------------------
create or replace function public.moderation_restoration_informed_at(p_restoration_id uuid)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $$
  select min(e.sent_at) from public.email_deliveries e
   where e.entity_type = 'moderation_restoration' and e.entity_id = p_restoration_id
     and e.template = 'reportRestored'
     and e.status in ('sent', 'delivered', 'opened', 'clicked') and e.sent_at is not null;
$$;
revoke all on function public.moderation_restoration_informed_at(uuid) from public, anon, authenticated;
grant execute on function public.moderation_restoration_informed_at(uuid) to service_role;

create or replace function public.moderation_restoration_appeal_deadline(p_restoration_id uuid)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $$
  select public.moderation_restoration_informed_at(p_restoration_id) + public.dsa_appeal_window();
$$;
revoke all on function public.moderation_restoration_appeal_deadline(uuid) from public, anon, authenticated;
grant execute on function public.moderation_restoration_appeal_deadline(uuid) to service_role;

-- Czy od cofnięcia przysługuje (jeszcze) odwołanie zgłaszającego.
create or replace function public.moderation_restoration_appealable(p_restoration_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when mr.id is null or mr.redacted_at is not null or d.redacted_at is not null then 'NOT_FOUND'
    when exists (select 1 from public.moderation_appeals a where a.appealed_restoration_id = mr.id) then 'APPEAL_EXISTS'
    -- Skutek odwołania autora (albo jego odwołanie w toku) — rozstrzygnięcie po przeglądzie.
    when exists (select 1 from public.moderation_appeals a
                  where a.decision_id = mr.decision_id and a.appellant_role = 'author'
                    and (a.status in ('pending', 'reversed') or a.restoration_id = mr.id)) then 'INVALID_TRANSITION'
    -- Tylko cofnięcie decyzji, która nadal rozstrzyga sprawę.
    when not exists (select 1 from public.reports r
                      where r.id = d.report_id and r.kind = 'dsa_notice' and r.decision_id = d.id) then 'INVALID_TRANSITION'
    when public.moderation_restoration_appeal_deadline(mr.id) < now() then 'APPEAL_WINDOW_CLOSED'
    else 'OK'
  end
  from (select p_restoration_id as id) k
  left join public.moderation_restorations mr on mr.id = k.id
  left join public.moderation_decisions d on d.id = mr.decision_id;
$$;
revoke all on function public.moderation_restoration_appealable(uuid) from public, anon, authenticated;
grant execute on function public.moderation_restoration_appealable(uuid) to service_role;

-- --- 3. Ręczne cofnięcie informuje zgłaszającego ------------------------------------------
create or replace function public.admin_restore_moderation(p_decision_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id     uuid;
  v_report record;
  v_locale text;
  v_profile uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  v_id := public.moderation_restore_core(p_decision_id, p_reason, true);

  -- Zgłaszający: sama informacja o zmianie wyniku (bez powodu i danych autora), w JEGO języku.
  -- Tylko gdy od cofnięcia przysługuje odwołanie — wiadomość otwiera jego termin.
  if public.moderation_restoration_appealable(v_id) = 'OK' then
    select r.id, r.case_number, r.reporter_id, r.reporter_email, r.reporter_locale, r.reporter_name
      into v_report
      from public.reports r
      join public.moderation_decisions d on d.report_id = r.id
     where d.id = p_decision_id and r.kind = 'dsa_notice' and r.redacted_at is null;
    if found and v_report.reporter_email is not null then
      if v_report.reporter_id is not null
         and exists (select 1 from public.profiles p where p.id = v_report.reporter_id and p.deleted_at is null) then
        v_profile := v_report.reporter_id;
        v_locale := public.resolve_recipient_locale(v_profile);
      else
        v_locale := v_report.reporter_locale;
      end if;
      perform public.enqueue_email_to_address(
        v_report.reporter_email::text, v_locale, v_profile, 'reportRestored', 'moderation_restoration', v_id,
        'report-restored-' || v_id::text,
        jsonb_strip_nulls(jsonb_build_object(
          'caseNumber', v_report.case_number, 'recipientName', v_report.reporter_name)));
    end if;
  end if;
  return v_id;
end $$;
revoke all on function public.admin_restore_moderation(uuid, text) from public, anon;
grant execute on function public.admin_restore_moderation(uuid, text) to authenticated;

-- --- 4. Odwołanie zgłaszającego od cofnięcia (numer sprawy + kod dostępu; service_role) ---
create or replace function public.submit_report_restoration_appeal(
  p_case_number     text,
  p_access_code     text,
  p_idempotency_key uuid,
  p_grounds         text
) returns table (appeal_id uuid, reference text, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_grounds text := btrim(coalesce(p_grounds, ''));
  v_report  record;
  v_exist   record;
  v_rest    record;
  v_state   text;
  v_id      uuid := gen_random_uuid();
  v_ref     text;
  v_locale  text;
  v_profile uuid;
begin
  if p_idempotency_key is null then
    raise exception 'VALIDATION_FAILED: brak klucza idempotencji' using errcode = '22023';
  end if;
  if p_case_number is null or p_access_code is null
     or char_length(p_case_number) > 32 or p_access_code !~ '^[A-Z2-7]{24}$' then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Blokada sprawy serializuje równoległe odwołania.
  select r.id, r.case_number, r.decision_id, r.reporter_id, r.reporter_email, r.reporter_locale,
         r.reporter_name, r.access_code_hash
    into v_report
    from public.reports r
    where r.kind = 'dsa_notice' and r.case_number = upper(btrim(p_case_number))
    for update;
  if not found or v_report.access_code_hash is null
     or v_report.access_code_hash <> encode(sha256(convert_to(p_access_code, 'UTF8')), 'hex') then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('appeal:' || p_idempotency_key::text, 0));
  select a.id, a.reference, a.report_id into v_exist
    from public.moderation_appeals a where a.idempotency_key = p_idempotency_key;
  if found then
    if v_exist.report_id is distinct from v_report.id then
      raise exception 'VALIDATION_FAILED: klucz idempotencji użyty w innym odwołaniu' using errcode = '22023';
    end if;
    return query select v_exist.id, v_exist.reference, false;
    return;
  end if;

  if char_length(v_grounds) < 20 then
    raise exception 'VALIDATION_FAILED: GROUNDS_REQUIRED' using errcode = '22023';
  end if;
  if char_length(v_grounds) > 2000 then
    raise exception 'VALIDATION_FAILED: GROUNDS_TOO_LONG' using errcode = '22023';
  end if;

  -- Cofnięcie decyzji, która rozstrzyga sprawę (najwyżej jedno — unikat w 0099).
  select mr.id, mr.decision_id into v_rest
    from public.moderation_restorations mr where mr.decision_id = v_report.decision_id;
  if v_rest.id is null then
    raise exception 'INVALID_TRANSITION: brak cofnięcia ograniczenia w tej sprawie' using errcode = '22023';
  end if;
  v_state := public.moderation_restoration_appealable(v_rest.id);
  if v_state = 'APPEAL_EXISTS' then raise exception 'APPEAL_EXISTS' using errcode = '23505'; end if;
  if v_state = 'APPEAL_WINDOW_CLOSED' then raise exception 'APPEAL_WINDOW_CLOSED' using errcode = '22023'; end if;
  if v_state <> 'OK' then raise exception 'INVALID_TRANSITION' using errcode = '22023'; end if;

  if v_report.reporter_id is not null
     and exists (select 1 from public.profiles p where p.id = v_report.reporter_id and p.deleted_at is null) then
    v_profile := v_report.reporter_id;
    v_locale := public.resolve_recipient_locale(v_profile);
  else
    v_locale := v_report.reporter_locale;
  end if;

  v_ref := public.moderation_appeal_reference(v_id);
  insert into public.moderation_appeals(
    id, reference, decision_id, report_id, appellant_role, appellant_id, appellant_locale, grounds,
    idempotency_key, due_at, appealed_restoration_id)
  values (
    v_id, v_ref, v_rest.decision_id, v_report.id, 'reporter', v_profile, v_locale, v_grounds,
    p_idempotency_key, now() + public.dsa_appeal_review_period(), v_rest.id);

  insert into public.report_events(report_id, event_type, actor_id, decision_id)
    values (v_report.id, 'appeal_submitted', v_profile, v_rest.decision_id);
  perform public.write_audit('moderation.appeal_submitted', 'report', v_report.id, null,
    jsonb_build_object('appealId', v_id, 'reference', v_ref, 'decisionId', v_rest.decision_id,
                       'appealedRestorationId', v_rest.id, 'appellantRole', 'reporter'));

  perform public.enqueue_email_to_address(
    v_report.reporter_email::text, v_locale, v_profile, 'appealReceived', 'moderation_appeal', v_id,
    'appeal-received-' || v_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'appealReference', v_ref, 'caseNumber', v_report.case_number, 'appellantRole', 'reporter',
      'appealTarget', 'restoration', 'recipientName', v_report.reporter_name)));

  return query select v_id, v_ref, true;
end $$;
revoke all on function public.submit_report_restoration_appeal(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_report_restoration_appeal(text, text, uuid, text) to service_role;

-- --- 5. Maszyna odwołań z 0104 — wersje uwzględniające odwołanie od cofnięcia -------------

create or replace function public.moderation_appealable(p_decision_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when d.id is null or d.redacted_at is not null then 'NOT_FOUND'
    when exists (select 1 from public.moderation_appeals a
                  where a.decision_id = d.id and a.appealed_restoration_id is null) then 'APPEAL_EXISTS'
    when d.decision <> 'no_action'
         and exists (select 1 from public.moderation_restorations r where r.decision_id = d.id) then 'INVALID_TRANSITION'
    -- Brak działań: odwołanie tylko od decyzji pierwotnej, która nadal rozstrzyga sprawę.
    when d.decision = 'no_action' and (d.appeal_id is not null
         or not exists (select 1 from public.reports r where r.id = d.report_id and r.decision_id = d.id)) then 'INVALID_TRANSITION'
    when public.moderation_appeal_deadline(d.id) < now() then 'APPEAL_WINDOW_CLOSED'
    else 'OK'
  end
  from (select p_decision_id as id) k
  left join public.moderation_decisions d on d.id = k.id;
$$;
revoke all on function public.moderation_appealable(uuid) from public, anon, authenticated;
grant execute on function public.moderation_appealable(uuid) to service_role;

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
  -- odwołanie — o ile jest inny administrator. Odwołanie od cofnięcia (#43, 0108): autorem
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
        where p.role = 'admin' and p.deleted_at is null and p.id <> v_uid) then
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

create or replace function public.get_report_case(p_case_number text, p_access_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_report record;
  v_appeal record;
  v_first  uuid;
  v_rest   record;
  v_rappeal record;
begin
  if p_case_number is null or p_access_code is null
     or char_length(p_case_number) > 32 or p_access_code !~ '^[A-Z2-7]{24}$' then
    return null;
  end if;
  select r.id, r.case_number, r.status::text as status, r.target_type::text as target_type,
         r.category, r.created_at, r.due_at, r.access_code_hash, d.decision
    into v_report
    from public.reports r
    left join public.moderation_decisions d on d.id = r.decision_id
    where r.kind = 'dsa_notice' and r.case_number = upper(btrim(p_case_number));
  if not found or v_report.access_code_hash is null
     or v_report.access_code_hash <> encode(sha256(convert_to(p_access_code, 'UTF8')), 'hex') then
    return null;
  end if;

  -- Decyzja pierwotna sprawy (odwołanie zgłaszającego dotyczy wyłącznie jej).
  select d.id into v_first from public.moderation_decisions d
    where d.report_id = v_report.id and d.appeal_id is null;
  select a.reference, a.status, a.submitted_at, a.due_at, a.decided_at, a.outcome_reasoning
    into v_appeal
    from public.moderation_appeals a
    where a.report_id = v_report.id and a.appellant_role = 'reporter' and a.appealed_restoration_id is null;

  -- Ostatnie cofnięcie ograniczenia w sprawie i odwołanie zgłaszającego od niego (0108).
  select mr.id, mr.restored_at into v_rest
    from public.moderation_restorations mr
    join public.moderation_decisions d on d.id = mr.decision_id
    where d.report_id = v_report.id
    order by mr.restored_at desc, mr.id desc limit 1;
  select a.reference, a.status, a.submitted_at, a.due_at, a.decided_at, a.outcome_reasoning
    into v_rappeal
    from public.moderation_appeals a where a.appealed_restoration_id = v_rest.id;

  return jsonb_build_object(
    'caseNumber', v_report.case_number,
    'status', v_report.status,
    'targetType', v_report.target_type,
    'category', v_report.category,
    'createdAt', v_report.created_at,
    'dueAt', v_report.due_at,
    'outcome', case when v_report.decision is null then null
                    when v_report.decision = 'no_action' then 'no_action'
                    else 'action_taken' end,
    'appealState', case when v_first is null or v_report.decision is distinct from 'no_action' then null
                        else public.moderation_appealable(v_first) end,
    'appealDeadline', case when v_first is null then null else public.moderation_appeal_deadline(v_first) end,
    'appeal', case when v_appeal.reference is null then null else jsonb_build_object(
        'reference', v_appeal.reference, 'status', v_appeal.status,
        'submittedAt', v_appeal.submitted_at, 'dueAt', v_appeal.due_at,
        'decidedAt', v_appeal.decided_at, 'reasoning', v_appeal.outcome_reasoning) end,
    'restoration', case when v_rest.id is null then null else jsonb_build_object(
        'restoredAt', v_rest.restored_at,
        'appealState', public.moderation_restoration_appealable(v_rest.id),
        'appealDeadline', public.moderation_restoration_appeal_deadline(v_rest.id),
        'appeal', case when v_rappeal.reference is null then null else jsonb_build_object(
            'reference', v_rappeal.reference, 'status', v_rappeal.status,
            'submittedAt', v_rappeal.submitted_at, 'dueAt', v_rappeal.due_at,
            'decidedAt', v_rappeal.decided_at, 'reasoning', v_rappeal.outcome_reasoning) end) end,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'type', e.event_type, 'toStatus', e.to_status, 'at', e.created_at) order by e.id)
        from public.report_events e
        where e.report_id = v_report.id and e.event_type in ('submitted', 'status_changed')), '[]'::jsonb));
end $$;
revoke all on function public.get_report_case(text, text) from public, anon, authenticated;
grant execute on function public.get_report_case(text, text) to service_role;

create or replace function public.dsa_retention_cases()
returns table (report_id uuid, retention_start timestamptz, eligible_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id, s.start_at, s.start_at + public.dsa_case_retention()
    from public.reports r
    cross join lateral (
      select case when bool_or(x.end_at is null) then null
                  else greatest(r.resolved_at, max(x.end_at)) end as start_at
        from (
          select case
                   -- Odwołanie zgłaszającego od cofnięcia (0108): null, gdy w toku.
                   when ra.id is not null then ra.decided_at
                   -- Cofnięcie, od którego przysługuje odwołanie: koniec terminu od
                   -- POINFORMOWANIA zgłaszającego (null, gdy nie poinformowano).
                   when mr.id is not null
                        and public.moderation_restoration_appealable(mr.id) in ('OK', 'APPEAL_WINDOW_CLOSED')
                     then public.moderation_restoration_appeal_deadline(mr.id)
                   when a.id is not null then a.decided_at          -- null, gdy odwołanie w toku
                   when mr.id is not null then mr.restored_at        -- ograniczenie cofnięte
                   else public.moderation_appeal_deadline(d.id)     -- null, gdy nie poinformowano
                 end as end_at
            from public.moderation_decisions d
            left join public.moderation_appeals a
              on a.decision_id = d.id and a.appealed_restoration_id is null
            left join public.moderation_restorations mr on mr.decision_id = d.id
            left join public.moderation_appeals ra on ra.appealed_restoration_id = mr.id
           where d.report_id = r.id
        ) x
    ) s
   where r.kind = 'dsa_notice' and r.redacted_at is null and r.status in ('resolved', 'dismissed');
$$;
revoke all on function public.dsa_retention_cases() from public, anon, authenticated;
grant execute on function public.dsa_retention_cases() to service_role;

create or replace function public.dsa_retention_run(p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_summary   jsonb := public.dsa_retention_report();
  v_reports   uuid[];
  v_decisions uuid[];
  v_appeals   uuid[];
  v_restorations uuid[];
  v_emails    integer := 0;
  v_run       uuid;
begin
  if p_dry_run is distinct from false then
    insert into public.dsa_retention_runs(dry_run, summary) values (true, v_summary) returning id into v_run;
    return v_summary || jsonb_build_object('runId', v_run, 'dryRun', true);
  end if;

  -- Blokady spraw: równoległe odwołanie/decyzja czeka albo przebieg pomija zmienioną sprawę.
  select coalesce(array_agg(s.id), '{}') into v_reports
    from (select r.id from public.reports r
           where r.id in (select c.report_id from public.dsa_retention_cases() c where c.eligible_at <= now())
           for update skip locked) s;
  select coalesce(array_agg(d.id), '{}') into v_decisions
    from public.moderation_decisions d where d.report_id = any(v_reports);
  select coalesce(array_agg(a.id), '{}') into v_appeals
    from public.moderation_appeals a where a.report_id = any(v_reports);
  select coalesce(array_agg(mr.id), '{}') into v_restorations
    from public.moderation_restorations mr where mr.decision_id = any(v_decisions);

  perform set_config('pracujbe.retention', 'on', true);
  update public.reports
     set access_code_hash = null, content_url = null, reporter_name = null, reporter_email = null,
         target_snapshot = null, details = null, reporter_id = null, redacted_at = now(), updated_at = now()
   where id = any(v_reports);
  update public.moderation_decisions set facts = null, redacted_at = now()
   where id = any(v_decisions) and redacted_at is null;
  update public.moderation_restorations set reason = null, redacted_at = now()
   where decision_id = any(v_decisions) and redacted_at is null;
  update public.moderation_appeals
     set grounds = null, outcome_reasoning = null, redacted_at = now(), updated_at = now()
   where id = any(v_appeals) and redacted_at is null;
  perform set_config('pracujbe.retention', '', true);

  -- Treść e-maili (fakty, uzasadnienia, kod dostępu). Wiadomość, która po takim czasie wciąż
  -- czeka w kolejce, nie zostanie już wysłana (bez treści nie da się jej złożyć).
  update public.email_deliveries
     set payload = '{}'::jsonb,
         status = case when status = 'queued' then 'failed'::public.email_status else status end,
         error_message = case when status = 'queued' then 'dsa_retention' else error_message end,
         updated_at = now()
   where ((entity_type = 'report' and entity_id = any(v_reports))
       or (entity_type = 'moderation_decision' and entity_id = any(v_decisions))
       or (entity_type = 'moderation_appeal' and entity_id = any(v_appeals))
       or (entity_type = 'moderation_restoration' and entity_id = any(v_restorations)));
  get diagnostics v_emails = row_count;

  insert into public.report_events(report_id, event_type)
    select unnest(v_reports), 'redacted';

  v_summary := v_summary || jsonb_build_object(
    'redactedCases', cardinality(v_reports), 'redactedDecisions', cardinality(v_decisions),
    'redactedAppeals', cardinality(v_appeals), 'redactedEmails', v_emails);
  insert into public.dsa_retention_runs(dry_run, summary) values (false, v_summary) returning id into v_run;
  perform public.write_audit('dsa.retention_run', 'dsa_retention_run', v_run, null, v_summary);
  return v_summary || jsonb_build_object('runId', v_run, 'dryRun', false);
end $$;
revoke all on function public.dsa_retention_run(boolean) from public, anon, authenticated;
grant execute on function public.dsa_retention_run(boolean) to service_role;

create or replace function public.dsa_transparency_report(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '1830 days' then
    raise exception 'VALIDATION_FAILED: okres raportu' using errcode = '22023';
  end if;

  with n as (
    select r.* from public.reports r
     where r.kind = 'dsa_notice' and r.created_at >= p_from and r.created_at < p_to
  ), d as (
    select md.*, r.created_at as notice_at, r.due_at as notice_due_at
      from public.moderation_decisions md join public.reports r on r.id = md.report_id
     where md.decided_at >= p_from and md.decided_at < p_to
  ), a as (
    select ma.* from public.moderation_appeals ma
     where ma.submitted_at >= p_from and ma.submitted_at < p_to
  ), rs as (
    select mr.*, exists (select 1 from public.moderation_appeals x where x.restoration_id = mr.id) as via_appeal
      from public.moderation_restorations mr
     where mr.restored_at >= p_from and mr.restored_at < p_to
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'notices', jsonb_build_object(
      'total', (select count(*) from n),
      'byCategory', (select jsonb_object_agg(k, (select count(*) from n where n.category = k))
                       from unnest(array['fraud', 'impersonation', 'discrimination', 'illegal_conditions',
                                         'data_misuse', 'other']) k),
      'byTargetType', (select jsonb_object_agg(k, (select count(*) from n where n.target_type::text = k))
                         from unnest(array['job', 'company']) k),
      'pending', (select count(*) from n where n.status in ('open', 'reviewing'))),
    'decisions', jsonb_build_object(
      'total', (select count(*) from d),
      'byDecision', (select jsonb_object_agg(k, (select count(*) from d where d.decision = k))
                       from unnest(array['no_action', 'job_removed', 'company_suspended']) k),
      'byGround', (select jsonb_object_agg(k, (select count(*) from d where d.ground_type = k))
                     from unnest(array['terms', 'law']) k),
      'fromAppeal', (select count(*) from d where d.appeal_id is not null),
      'automatedDetection', (select count(*) from d where d.automated_detection),
      'automatedDecision', (select count(*) from d where d.automated_decision),
      'medianHoursToDecision', (select round((percentile_cont(0.5) within group (
                                  order by extract(epoch from d.decided_at - d.notice_at) / 3600))::numeric, 1)
                                  from d where d.appeal_id is null),
      'withinDueDate', (select count(*) from d where d.appeal_id is null and d.decided_at <= d.notice_due_at)),
    'appeals', jsonb_build_object(
      'total', (select count(*) from a),
      'byAppellant', (select jsonb_object_agg(k, (select count(*) from a where a.appellant_role = k))
                        from unnest(array['author', 'reporter']) k),
      'againstRestoration', (select count(*) from a where a.appealed_restoration_id is not null),
      'byStatus', (select jsonb_object_agg(k, (select count(*) from a where a.status = k))
                     from unnest(array['pending', 'upheld', 'reversed']) k),
      'reversedDecisions', (select count(*) from a where a.status = 'reversed'),
      'medianHoursToDecision', (select round((percentile_cont(0.5) within group (
                                  order by extract(epoch from a.decided_at - a.submitted_at) / 3600))::numeric, 1)
                                  from a where a.decided_at is not null),
      'withinDueDate', (select count(*) from a where a.decided_at is not null and a.decided_at <= a.due_at),
      'sameReviewer', (select count(*) from a where a.same_reviewer)),
    'restorations', jsonb_build_object(
      'total', (select count(*) from rs),
      'viaAppeal', (select count(*) from rs where rs.via_appeal),
      'manual', (select count(*) from rs where not rs.via_appeal)))
  into v_result;
  return v_result;
end $$;
revoke all on function public.dsa_transparency_report(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.dsa_transparency_report(timestamptz, timestamptz) to service_role;

create or replace function public.dsa_statements_export(p_from timestamptz, p_to timestamptz)
returns table (
  decision_reference text, decided_at timestamptz, decision text, content_type text,
  notice_category text, notice_received_at timestamptz, ground_type text, ground_reference text,
  automated_detection boolean, automated_decision boolean, from_appeal boolean,
  appeal_status text, restored boolean
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '1830 days' then
    raise exception 'VALIDATION_FAILED: okres raportu' using errcode = '22023';
  end if;
  return query
    select d.reference, d.decided_at, d.decision,
           case d.decision when 'job_removed' then 'job' when 'company_suspended' then 'company'
                else r.target_type::text end,
           r.category, r.created_at, d.ground_type, d.ground_reference,
           d.automated_detection, d.automated_decision, d.appeal_id is not null,
           a.status, exists (select 1 from public.moderation_restorations mr where mr.decision_id = d.id)
      from public.moderation_decisions d
      join public.reports r on r.id = d.report_id
      left join public.moderation_appeals a on a.decision_id = d.id and a.appealed_restoration_id is null
     where d.decided_at >= p_from and d.decided_at < p_to
     order by d.decided_at, d.reference;
end $$;
revoke all on function public.dsa_statements_export(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.dsa_statements_export(timestamptz, timestamptz) to service_role;
