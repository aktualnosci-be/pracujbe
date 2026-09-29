-- =============================================================================
-- Rollback 0188 (paczka M-1: DSA — trwały dowód poinformowania, limity, kod dostępu,
-- zawieszenie firmy niezweryfikowanej). Przywraca definicje z 0084/0094/0104/0109.
-- UWAGA: tabela `moderation_informed` jest pochodna (odtwarzalna z `email_deliveries` i
-- powiadomień) — jej usunięcie przywraca dawne wyprowadzanie terminów odwołania. Kod dostępu
-- usunięty z payloadu zleceń nie wraca (i nie ma po co).
-- =============================================================================

-- 1. Strażnik kodu dostępu.
drop trigger if exists trg_email_deliveries_scrub_access_code on public.email_deliveries;
drop function if exists public.email_deliveries_scrub_access_code();

-- 2. Dowód poinformowania: triggery i funkcje pomocnicze, potem definicje terminów z 0104/0109.
drop trigger if exists trg_email_deliveries_track_moderation_informed on public.email_deliveries;
drop trigger if exists trg_moderation_decisions_informed_no_recipient on public.moderation_decisions;
drop trigger if exists trg_moderation_restorations_informed_no_recipient on public.moderation_restorations;
drop function if exists public.email_deliveries_track_moderation_informed();
drop function if exists public.moderation_informed_no_recipient();

create or replace function public.moderation_informed_at(p_decision_id uuid)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $$
  select case when d.decision = 'no_action' then
      (select min(e.sent_at) from public.email_deliveries e
        where e.entity_type = 'report' and e.entity_id = d.report_id
          and e.template = 'reportDecisionNoAction'
          and e.status in ('sent', 'delivered', 'opened', 'clicked') and e.sent_at is not null)
    else
      least(
        (select min(e.sent_at) from public.email_deliveries e
          where e.entity_type = 'moderation_decision' and e.entity_id = d.id
            and e.template in ('moderationJobRemoved', 'moderationCompanySuspended')
            and e.status in ('sent', 'delivered', 'opened', 'clicked') and e.sent_at is not null),
        (select min(n.read_at) from public.notifications n
          where n.entity_type = 'company' and n.entity_id = d.company_id
            and n.data->>'kind' = 'moderation' and n.data->>'decisionId' = d.id::text
            and n.read_at is not null))
    end
  from public.moderation_decisions d where d.id = p_decision_id;
$$;
revoke all on function public.moderation_informed_at(uuid) from public, anon, authenticated;
grant execute on function public.moderation_informed_at(uuid) to service_role;

create or replace function public.moderation_restoration_informed_at(p_restoration_id uuid)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $$
  select min(e.sent_at) from public.email_deliveries e
   where e.entity_type = 'moderation_restoration' and e.entity_id = p_restoration_id
     and e.template = 'reportRestored'
     and e.status in ('sent', 'delivered', 'opened', 'clicked') and e.sent_at is not null;
$$;
revoke all on function public.moderation_restoration_informed_at(uuid) from public, anon, authenticated;
grant execute on function public.moderation_restoration_informed_at(uuid) to service_role;

create or replace function public.get_company_moderation_decisions(p_company_id uuid)
returns table (
  id uuid, reference text, decision text, job_id uuid, job_title text, facts text,
  ground_type text, ground_reference text, automated_detection boolean,
  decided_at timestamptz, restored_at timestamptz, restore_reason text,
  appeal_state text, appeal_deadline timestamptz,
  appeal_id uuid, appeal_reference text, appeal_status text, appeal_submitted_at timestamptz,
  appeal_due_at timestamptz, appeal_decided_at timestamptz, appeal_reasoning text
) language sql stable security definer set search_path = public, pg_temp as $$
  select d.id, d.reference, d.decision, d.job_id, j.title, d.facts, d.ground_type, d.ground_reference,
         d.automated_detection, d.decided_at, r.restored_at, r.reason,
         public.moderation_appealable(d.id), public.moderation_appeal_deadline(d.id),
         a.id, a.reference, a.status, a.submitted_at, a.due_at, a.decided_at, a.outcome_reasoning
    from public.moderation_decisions d
    left join public.jobs j on j.id = d.job_id
    left join public.moderation_restorations r on r.decision_id = d.id
    left join public.moderation_appeals a on a.decision_id = d.id and a.appellant_role = 'author'
    where d.company_id = p_company_id
      and d.decision <> 'no_action'
      and exists (
        select 1 from public.company_members cm
          where cm.company_id = p_company_id and cm.profile_id = auth.uid()
            and cm.is_active = true and cm.role in ('owner', 'admin'))
    order by d.decided_at desc, d.id
    limit 50;
$$;
revoke all on function public.get_company_moderation_decisions(uuid) from public, anon;
grant execute on function public.get_company_moderation_decisions(uuid) to authenticated;

create or replace function public.dsa_retention_report()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with c as (select * from public.dsa_retention_cases()),
       due as (select report_id from c where eligible_at <= now())
  select jsonb_build_object(
    'evaluatedAt', now(),
    'policy', jsonb_build_object(
      'appealWindowDays', extract(day from (now() + public.dsa_appeal_window()) - now())::int,
      'retentionDays', extract(day from (now() + public.dsa_case_retention()) - now())::int),
    'eligibleCases', (select count(*) from due),
    'eligibleDecisions', (select count(*) from public.moderation_decisions d where d.report_id in (select report_id from due) and d.redacted_at is null),
    'eligibleAppeals', (select count(*) from public.moderation_appeals a where a.report_id in (select report_id from due) and a.redacted_at is null),
    'eligibleRestorations', (select count(*) from public.moderation_restorations mr
                               join public.moderation_decisions d on d.id = mr.decision_id
                              where d.report_id in (select report_id from due) and mr.redacted_at is null),
    'waitingForAppealPath', (select count(*) from c where retention_start is null),
    'withinRetention', (select count(*) from c where eligible_at > now()),
    'openCases', (select count(*) from public.reports r where r.kind = 'dsa_notice' and r.status in ('open', 'reviewing')),
    'redactedCases', (select count(*) from public.reports r where r.kind = 'dsa_notice' and r.redacted_at is not null),
    'nextEligibleAt', (select min(eligible_at) from c where eligible_at > now()));
$$;
revoke all on function public.dsa_retention_report() from public, anon, authenticated;
grant execute on function public.dsa_retention_report() to service_role;


drop function if exists public.moderation_record_informed(text, uuid, text, timestamptz, uuid);
drop function if exists public.moderation_subject_email_state(text, uuid);
drop function if exists public.moderation_subject_deliveries(text, uuid);
drop table if exists public.moderation_informed;
drop function if exists public.moderation_informed_guard();

-- 3. Indeks otwartych spraw DSA (funkcja zgłoszenia z 0094 przywrócona wyżej, bez blokady).
drop index if exists public.reports_dsa_open_uq;

-- 4. Zgłoszenie z 0094 (bez blokady per adres).
create or replace function public.submit_content_report(
  p_reporter_id     uuid,
  p_idempotency_key uuid,
  p_access_code     text,
  p_target_type     text,
  p_job_id          uuid,
  p_category        text,
  p_details         text,
  p_content_url     text,
  p_reporter_name   text,
  p_reporter_email  text,
  p_locale          text,
  p_good_faith      boolean
) returns table (report_id uuid, case_number text, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hash     text;
  v_email    public.citext;
  v_name     text := nullif(btrim(coalesce(p_reporter_name, '')), '');
  v_details  text := btrim(coalesce(p_details, ''));
  v_url      text := nullif(btrim(coalesce(p_content_url, '')), '');
  v_reporter uuid;
  v_locale   text;
  v_existing record;
  v_job      record;
  v_target   uuid;
  v_snapshot jsonb;
  v_case     text;
  v_id       uuid;
begin
  if p_idempotency_key is null then
    raise exception 'VALIDATION_FAILED: brak klucza idempotencji' using errcode = '22023';
  end if;
  if p_access_code is null or p_access_code !~ '^[A-Z2-7]{24}$' then
    raise exception 'VALIDATION_FAILED: kod dostępu' using errcode = '22023';
  end if;
  v_hash := encode(sha256(convert_to(p_access_code, 'UTF8')), 'hex');

  -- Ten sam klucz = to samo wysłanie (także przy wyścigu dwóch żądań).
  perform pg_advisory_xact_lock(hashtextextended('report:' || p_idempotency_key::text, 0));
  select r.id, r.case_number, r.access_code_hash into v_existing
    from public.reports r where r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.access_code_hash is distinct from v_hash then
      raise exception 'VALIDATION_FAILED: klucz idempotencji użyty z innym kodem' using errcode = '22023';
    end if;
    return query select v_existing.id, v_existing.case_number, false;
    return;
  end if;

  if p_good_faith is distinct from true then
    raise exception 'VALIDATION_FAILED: brak oświadczenia' using errcode = '22023';
  end if;
  if p_target_type not in ('job', 'company') then
    raise exception 'VALIDATION_FAILED: rodzaj treści' using errcode = '22023';
  end if;
  if p_category is null or p_category not in
     ('fraud', 'impersonation', 'discrimination', 'illegal_conditions', 'data_misuse', 'other') then
    raise exception 'VALIDATION_FAILED: kategoria' using errcode = '22023';
  end if;
  if char_length(v_details) < 20 or char_length(v_details) > 5000 then
    raise exception 'VALIDATION_FAILED: opis' using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 200 then
    raise exception 'VALIDATION_FAILED: imię' using errcode = '22023';
  end if;
  if v_url is not null and (char_length(v_url) > 2000 or v_url !~* '^https?://') then
    raise exception 'VALIDATION_FAILED: adres treści' using errcode = '22023';
  end if;
  v_email := lower(btrim(coalesce(p_reporter_email, '')));
  if char_length(v_email::text) not between 3 and 254
     or v_email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_FAILED: e-mail' using errcode = '22023';
  end if;
  if public.is_supported_locale(p_locale) is not true then
    raise exception 'VALIDATION_FAILED: język' using errcode = '22023';
  end if;

  -- Zalogowany zgłaszający: istniejący, aktywny profil; język wg Invariantu #1.
  if p_reporter_id is not null then
    select p.id into v_reporter from public.profiles p
      where p.id = p_reporter_id and p.deleted_at is null;
  end if;
  v_locale := case when v_reporter is not null
                   then public.resolve_recipient_locale(v_reporter)
                   else p_locale end;

  -- Tylko treść publiczna; prywatna i nieistniejąca → ten sam NOT_FOUND.
  if p_job_id is null or not public.job_is_public(p_job_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select j.id, j.slug, j.title, j.city, j.region, j.status::text as status, j.contract_type::text as contract_type,
         j.salary_min, j.salary_max, j.currency, j.salary_period::text as salary_period,
         j.published_at, j.expires_at, j.default_locale, j.company_id,
         c.name as company_name, c.website as company_website, c.city as company_city,
         c.vat_number as company_vat, c.description as company_description
    into v_job
    from public.jobs j join public.companies c on c.id = j.company_id
    where j.id = p_job_id and c.deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_target := case p_target_type when 'job' then v_job.id else v_job.company_id end;

  -- Limit w bazie: 5 spraw / adres / 24 h; jedna otwarta sprawa na adres i treść.
  if (select count(*) from public.reports r
        where r.kind = 'dsa_notice' and r.reporter_email = v_email
          and r.created_at > now() - interval '24 hours') >= 5
     or exists (select 1 from public.reports r
        where r.kind = 'dsa_notice' and r.reporter_email = v_email
          and r.target_type = p_target_type::public.report_target_type and r.target_id = v_target
          and r.status in ('open', 'reviewing')) then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;

  -- Dowód: stan treści w chwili zgłoszenia, zbudowany z bazy.
  v_snapshot := jsonb_build_object(
    'capturedAt', now(),
    'job', jsonb_build_object(
      'id', v_job.id, 'slug', v_job.slug, 'title', v_job.title,
      'city', v_job.city, 'region', v_job.region, 'status', v_job.status,
      'contractType', v_job.contract_type, 'salaryMin', v_job.salary_min,
      'salaryMax', v_job.salary_max, 'currency', v_job.currency,
      'salaryPeriod', v_job.salary_period, 'publishedAt', v_job.published_at,
      'expiresAt', v_job.expires_at,
      'translations', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'locale', t.locale, 'title', t.title, 'description', t.description,
                 'responsibilities', t.responsibilities, 'conditions', t.conditions,
                 'benefits', t.benefits) order by t.locale)
          from public.job_translations t where t.job_id = v_job.id), '[]'::jsonb),
      'requirements', coalesce((
        select jsonb_agg(jsonb_build_object('locale', q.locale, 'kind', q.kind, 'content', q.content)
                 order by q.locale, q.position)
          from public.job_requirements q where q.job_id = v_job.id), '[]'::jsonb)
    ),
    'company', jsonb_build_object(
      'id', v_job.company_id, 'name', v_job.company_name, 'website', v_job.company_website,
      'city', v_job.company_city, 'vatNumber', v_job.company_vat,
      'description', v_job.company_description
    )
  );

  -- Numer sprawy: 64 bity losowe (skrót z gen_random_uuid), ponowienie przy kolizji.
  loop
    v_case := 'DSA-' || upper(
      substr(encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'), 1, 16));
    v_case := substr(v_case, 1, 8) || '-' || substr(v_case, 9, 4) || '-' || substr(v_case, 13, 4) || '-' || substr(v_case, 17, 4);
    exit when not exists (select 1 from public.reports r where r.case_number = v_case);
  end loop;

  insert into public.reports(
    reporter_id, target_type, target_id, reason, details, status, kind, case_number,
    access_code_hash, idempotency_key, category, content_url, reporter_name,
    reporter_email, reporter_locale, good_faith_at, target_snapshot, due_at)
  values (
    v_reporter, p_target_type::public.report_target_type, v_target, p_category, v_details,
    'open', 'dsa_notice', v_case, v_hash, p_idempotency_key, p_category, v_url, v_name,
    v_email, v_locale, now(), v_snapshot, now() + interval '7 days')
  returning id into v_id;

  perform public.enqueue_email_to_address(
    v_email::text, v_locale, v_reporter, 'reportReceived', 'report', v_id,
    'report-received:' || v_id::text,
    jsonb_build_object(
      'caseNumber', v_case,
      'accessCode', p_access_code,
      'targetType', p_target_type,
      'recipientName', v_name));

  return query select v_id, v_case, true;
end $$;
revoke all on function public.submit_content_report(
  uuid, uuid, text, text, uuid, text, text, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.submit_content_report(
  uuid, uuid, text, text, uuid, text, text, text, text, text, text, boolean)
  to service_role;

-- 5. Macierz przejść firmy z 0084.
create or replace function public.admin_set_company_status(
  p_company_id uuid,
  p_status text,
  p_expected_status text default null,
  p_reason text default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_to public.company_status;
  v_expected public.company_status;
  v_from public.company_status;
  v_name text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_audit uuid;
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;

  begin
    v_to := p_status::public.company_status;
    v_expected := p_expected_status::public.company_status;
  exception when invalid_text_representation then
    raise exception 'VALIDATION_FAILED: nieznany status firmy' using errcode = '22023';
  end;

  select status, name into v_from, v_name
    from public.companies
    where id = p_company_id and deleted_at is null
    for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  if v_expected is not null and v_expected is distinct from v_from then
    raise exception 'STALE_STATE: status firmy zmienił się (% zamiast %)', v_from, v_expected;
  end if;

  if not (
    (v_from in ('unverified', 'pending') and v_to in ('verified', 'rejected'))
    or (v_from = 'verified' and v_to = 'suspended')
    or (v_from in ('rejected', 'suspended') and v_to = 'verified')
  ) then
    raise exception 'INVALID_TRANSITION: % -> %', v_from, v_to using errcode = '22023';
  end if;

  -- Po macierzy przejść: niedozwolone przejście zgłasza INVALID_TRANSITION, nie brak powodu.
  if v_to in ('rejected', 'suspended') and v_reason is null then
    raise exception 'VALIDATION_FAILED: REASON_REQUIRED' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'VALIDATION_FAILED: REASON_TOO_LONG' using errcode = '22023';
  end if;

  update public.companies
    set status = v_to,
        status_reason = case when v_to = 'verified' then null else v_reason end,
        verified_at = case when v_to = 'verified' then now() else verified_at end,
        verified_by = case when v_to = 'verified' then auth.uid() else verified_by end,
        updated_at = now()
    where id = p_company_id;

  -- Wpis audytu tej decyzji (trigger audit_company_change w tej transakcji). Dopasowanie po
  -- przejściu i aktorze, nie tylko po czasie: w jednej transakcji now() jest stałe, więc samo
  -- `order by created_at` wybrałoby dowolny wcześniejszy wpis (i klucz e-maila innej decyzji).
  select a.id into v_audit
    from public.audit_logs a
    where a.entity_type = 'company' and a.entity_id = p_company_id
      and a.action = 'company.status_changed'
      and a.actor_id = auth.uid()
      and a.before_data->>'status' = v_from::text
      and a.after_data->>'status' = v_to::text
      and a.created_at = now()
    order by a.id desc
    limit 1;
  if v_audit is null then
    raise exception 'INTERNAL: brak wpisu audytu decyzji' using errcode = 'P0001';
  end if;

  for v_owner in
    select cm.profile_id
      from public.company_members cm
      where cm.company_id = p_company_id
        and cm.role = 'owner'
        and public.company_recipient_ok(p_company_id, cm.profile_id)
  loop
    insert into public.notifications (profile_id, type, title, entity_type, entity_id, data)
      values (v_owner,
              case when v_to = 'verified' then 'company_verified'::public.notification_type
                   else 'system'::public.notification_type end,
              'company_status_changed', 'company', p_company_id,
              jsonb_build_object('kind', 'company_status', 'status', v_to::text));

    perform public.enqueue_email(v_owner,
                                 case v_to when 'verified' then 'companyVerified'
                                           when 'rejected' then 'companyRejected'
                                           else 'companySuspended' end,
                                 'company', p_company_id,
                                 'companystatus-' || v_audit::text || '-' || v_owner::text,
                                 jsonb_strip_nulls(jsonb_build_object(
                                   'companyName', v_name,
                                   'reason', case when v_to = 'verified' then null else v_reason end)));
  end loop;
end $$;
revoke all on function public.admin_set_company_status(uuid, text, text, text) from public, anon;
grant execute on function public.admin_set_company_status(uuid, text, text, text) to authenticated;
