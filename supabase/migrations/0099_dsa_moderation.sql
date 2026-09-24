-- =============================================================================
-- 0099 — decyzja moderacyjna z uzasadnieniem i atomową egzekucją (#42).
--
-- Buduje na sprawie `dsa_notice` z 0094 (#41). Sprawę DSA rozstrzyga WYŁĄCZNIE nazwana akcja
-- domenowa `admin_decide_report`: decyzja + skutek wobec treści + stan sprawy + historia +
-- audyt + powiadomienia (outbox) w jednej transakcji. Błąd dowolnej części cofa całość
-- i zostawia sprawę otwartą.
--
-- 1. `moderation_decisions` — niezmienny zapis decyzji (uzasadnienie): rodzaj
--    (`no_action` | `job_removed` | `company_suspended`), zasięg (oferta / firma wraz z jej
--    ofertami), fakty, podstawa (`terms` | `law`) z odwołaniem do postanowienia, udział
--    automatyzacji (`automated_detection` — wykrycie/flaga; `automated_decision` zawsze false,
--    decyduje człowiek: `decided_by` = admin z sesji), stan treści przed decyzją (do
--    przywrócenia) i numer decyzji do odwołań. Zapis tylko przez RPC; tabela bez grantów dla
--    klientów (autor czyta swoje decyzje przez `get_company_moderation_decisions`).
-- 2. Skutek: `job_removed` → oferta `closed` + blokada `jobs.moderation_decision_id`;
--    `company_suspended` → firma `suspended` + blokada `companies.moderation_decision_id`
--    (oferty firmy znikają z list publicznych, które wymagają firmy `verified`). Blokada
--    trzyma status: ani pracodawca (`set_job_status` reopen), ani admin
--    (`admin_set_company_status`), ani service_role nie zmienią statusu zablokowanej treści
--    (MODERATION_LOCKED). Blokadę ustawia/zdejmuje tylko decyzja/przywrócenie (flaga
--    transakcji `pracujbe.moderation`).
-- 3. Kontrola spójności (constraint trigger DEFERRABLE, przy COMMIT): decyzja bez
--    odpowiadającego skutku (treść nie jest ograniczona albo sprawa nie jest rozstrzygnięta
--    tą decyzją) → MODERATION_EFFECT_MISSING — także przy zapisie z pominięciem RPC.
-- 4. `reports`: sprawę DSA zamyka (resolved/dismissed) tylko decyzja (`decision_id`);
--    samo `admin_resolve_report(…, 'resolved')` jest odtąd odrzucane (INVALID_TRANSITION) —
--    wcześniej zmieniało status, zostawiając treść publiczną. Rozstrzygniętej sprawy DSA nie
--    otwiera się ponownie zmianą statusu (odwołania = #43).
-- 5. Blokada/CAS: sprawa `FOR UPDATE` + `p_expected_status` (STALE_STATE), treść `FOR UPDATE`;
--    jedna decyzja na sprawę (unikat). Dwie równoległe decyzje → jedna wygrywa, druga
--    STALE_STATE bez skutków.
-- 6. Powiadomienia: autor (aktywni właściciele firmy) — in-app + e-mail z uzasadnieniem
--    (`moderationJobRemoved` / `moderationCompanySuspended`) przez `enqueue_email` w JEGO
--    języku (Invariant #1); zgłaszający — e-mail z samym wynikiem (`reportDecisionActioned` /
--    `reportDecisionNoAction`), bez faktów i danych autora, w jego języku (profil →
--    `resolve_recipient_locale`, gość → język zgłoszenia).
-- 7. Przywrócenie: `admin_restore_moderation` (uzasadnienie wymagane) — niezmienny wpis
--    `moderation_restorations`, zdjęcie blokady (albo przekazanie jej innej aktywnej decyzji
--    o tej samej treści), status sprzed decyzji (oferta active/paused tylko przed terminem,
--    inaczej zostaje closed), historia, audyt, e-mail `moderationRestored` do autora.
-- 8. Kolejka ręcznego przeglądu: `reports.review_priority` / `review_flag` ustawia tylko
--    `flag_report_for_review` (service_role — np. automat/AI). Flaga niczego nie rozstrzyga:
--    decyzja wymaga sesji admina.
-- 9. `get_report_case` zwraca też wynik (`outcome`) bez uzasadnienia.
--
-- Rollback (decyzje są dowodem — przed rollbackiem wyeksportować `moderation_decisions`
-- i `moderation_restorations`): zdjąć blokady (`update jobs/companies set
-- moderation_decision_id = null` przy wyłączonych triggerach blokady), drop functions
-- admin_decide_report, admin_restore_moderation, flag_report_for_review,
-- get_company_moderation_decisions, guard_job_moderation_lock, guard_company_moderation_lock,
-- reports_decision_guard, moderation_effect_check, moderation_append_only; drop tables
-- moderation_restorations, moderation_decisions; drop nowych kolumn jobs/companies/reports/
-- report_events; przywrócić check `report_events.event_type` i `get_report_case` z 0094.
-- =============================================================================

-- --- 1. Decyzje i przywrócenia ----------------------------------------------------------
create table if not exists public.moderation_decisions (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,
  report_id           uuid not null references public.reports(id) on delete restrict,
  decision            text not null check (decision in ('no_action', 'job_removed', 'company_suspended')),
  job_id              uuid references public.jobs(id) on delete set null,
  company_id          uuid references public.companies(id) on delete set null,
  facts               text not null check (char_length(facts) between 20 and 1000),
  ground_type         text check (ground_type in ('terms', 'law')),
  ground_reference    text check (ground_reference is null or char_length(ground_reference) between 3 and 300),
  automated_detection boolean not null default false,
  automated_decision  boolean not null default false check (automated_decision = false),
  previous_status     text,
  decided_by          uuid references public.profiles(id) on delete set null,
  decided_at          timestamptz not null default now(),
  -- Ograniczenie treści ma podstawę; zasięg zgodny z rodzajem.
  constraint moderation_decisions_ground check (
    decision = 'no_action' or (ground_type is not null and ground_reference is not null)
  ),
  constraint moderation_decisions_scope check (
    (decision = 'job_removed' and job_id is not null and company_id is not null)
    or (decision = 'company_suspended' and company_id is not null)
    or decision = 'no_action'
  )
);
create unique index if not exists moderation_decisions_report_uq on public.moderation_decisions(report_id);
create index if not exists moderation_decisions_job_idx on public.moderation_decisions(job_id) where job_id is not null;
create index if not exists moderation_decisions_company_idx on public.moderation_decisions(company_id, decided_at desc);

create table if not exists public.moderation_restorations (
  id          uuid primary key default gen_random_uuid(),
  decision_id uuid not null unique references public.moderation_decisions(id) on delete restrict,
  reason      text not null check (char_length(reason) between 20 and 1000),
  restored_by uuid references public.profiles(id) on delete set null,
  restored_at timestamptz not null default now()
);

alter table public.moderation_decisions enable row level security;
alter table public.moderation_restorations enable row level security;
revoke all on public.moderation_decisions from public, anon, authenticated;
revoke all on public.moderation_restorations from public, anon, authenticated;

-- Niezmienność: bez UPDATE/DELETE dla każdej roli (usunięcie profilu/treści = SET NULL przez FK).
create or replace function public.moderation_append_only()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_fk constant text[] := array['job_id', 'company_id', 'decided_by', 'restored_by'];
  v_key text;
begin
  -- Jedyna dozwolona zmiana: odwołanie FK przechodzi na null (usunięcie konta/treści,
  -- `on delete set null`). Treść decyzji pozostaje nienaruszona.
  if tg_op = 'UPDATE' and (to_jsonb(new) - v_fk) = (to_jsonb(old) - v_fk) then
    foreach v_key in array v_fk loop
      if to_jsonb(new) ? v_key
         and to_jsonb(new)->v_key is distinct from to_jsonb(old)->v_key
         and jsonb_typeof(to_jsonb(new)->v_key) <> 'null' then
        raise exception 'PERMISSION_DENIED: decyzja moderacyjna jest niezmienna' using errcode = '42501';
      end if;
    end loop;
    return new;
  end if;
  raise exception 'PERMISSION_DENIED: decyzja moderacyjna jest niezmienna' using errcode = '42501';
end $$;
revoke all on function public.moderation_append_only() from public;

drop trigger if exists trg_moderation_decisions_append_only on public.moderation_decisions;
create trigger trg_moderation_decisions_append_only
  before update or delete on public.moderation_decisions
  for each row execute function public.moderation_append_only();
drop trigger if exists trg_moderation_restorations_append_only on public.moderation_restorations;
create trigger trg_moderation_restorations_append_only
  before update or delete on public.moderation_restorations
  for each row execute function public.moderation_append_only();

-- --- 2. Blokada moderacyjna treści -----------------------------------------------------
alter table public.jobs
  add column if not exists moderation_decision_id uuid references public.moderation_decisions(id) on delete set null;
alter table public.companies
  add column if not exists moderation_decision_id uuid references public.moderation_decisions(id) on delete set null;

create or replace function public.guard_job_moderation_lock()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('pracujbe.moderation', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      if new.moderation_decision_id is not null then
        raise exception 'PERMISSION_DENIED: blokadę moderacyjną ustawia tylko decyzja' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.moderation_decision_id is distinct from old.moderation_decision_id then
      raise exception 'PERMISSION_DENIED: blokadę moderacyjną zmienia tylko decyzja' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.moderation_decision_id is not null
     and new.moderation_decision_id is not null
     and new.status is distinct from old.status then
    raise exception 'MODERATION_LOCKED: oferta wycofana decyzją moderacyjną' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_job_moderation_lock() from public;

drop trigger if exists trg_guard_job_moderation_lock on public.jobs;
create trigger trg_guard_job_moderation_lock
  before insert or update on public.jobs
  for each row execute function public.guard_job_moderation_lock();

create or replace function public.guard_company_moderation_lock()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('pracujbe.moderation', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      if new.moderation_decision_id is not null then
        raise exception 'PERMISSION_DENIED: blokadę moderacyjną ustawia tylko decyzja' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.moderation_decision_id is distinct from old.moderation_decision_id then
      raise exception 'PERMISSION_DENIED: blokadę moderacyjną zmienia tylko decyzja' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.moderation_decision_id is not null
     and new.moderation_decision_id is not null
     and (new.status is distinct from old.status or new.status_reason is distinct from old.status_reason) then
    raise exception 'MODERATION_LOCKED: firma zawieszona decyzją moderacyjną' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_company_moderation_lock() from public;

drop trigger if exists trg_guard_company_moderation_lock on public.companies;
create trigger trg_guard_company_moderation_lock
  before insert or update on public.companies
  for each row execute function public.guard_company_moderation_lock();

-- --- 3. Sprawa: zamknięcie tylko decyzją, kolejka przeglądu -----------------------------
alter table public.reports
  add column if not exists decision_id     uuid references public.moderation_decisions(id) on delete restrict,
  add column if not exists review_priority smallint not null default 0,
  add column if not exists review_flag     text;
alter table public.reports
  add constraint reports_review_priority_chk check (review_priority between 0 and 3),
  add constraint reports_review_flag_len check (review_flag is null or char_length(review_flag) <= 200);
create index if not exists reports_dsa_queue_idx
  on public.reports(review_priority desc, due_at) where kind = 'dsa_notice' and status in ('open', 'reviewing');

create or replace function public.reports_decision_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_decision text;
begin
  if new.decision_id is distinct from old.decision_id then
    if old.decision_id is not null or new.kind <> 'dsa_notice' then
      raise exception 'PERMISSION_DENIED: decyzji sprawy nie można zmienić' using errcode = '42501';
    end if;
    select d.decision into v_decision from public.moderation_decisions d
      where d.id = new.decision_id and d.report_id = new.id;
    if not found then
      raise exception 'PERMISSION_DENIED: decyzja nie dotyczy tej sprawy' using errcode = '42501';
    end if;
  end if;

  if new.kind = 'dsa_notice' and new.status is distinct from old.status then
    if old.status in ('resolved', 'dismissed') then
      raise exception 'INVALID_TRANSITION: rozstrzygnięta sprawa DSA (odwołanie — osobna procedura)'
        using errcode = '22023';
    end if;
    if new.status in ('resolved', 'dismissed') then
      if new.decision_id is null then
        raise exception 'INVALID_TRANSITION: sprawę DSA rozstrzyga decyzja moderacyjna'
          using errcode = '22023';
      end if;
      select d.decision into v_decision from public.moderation_decisions d where d.id = new.decision_id;
      if (v_decision = 'no_action') <> (new.status = 'dismissed') then
        raise exception 'INVALID_TRANSITION: status sprawy niezgodny z decyzją' using errcode = '22023';
      end if;
    end if;
  end if;

  if (new.review_priority is distinct from old.review_priority or new.review_flag is distinct from old.review_flag)
     and coalesce(current_setting('pracujbe.review_flag', true), '') <> 'on' then
    raise exception 'PERMISSION_DENIED: priorytet przeglądu tylko przez flag_report_for_review'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.reports_decision_guard() from public;

drop trigger if exists trg_reports_decision_guard on public.reports;
create trigger trg_reports_decision_guard
  before update on public.reports
  for each row execute function public.reports_decision_guard();

-- Historia sprawy: decyzja, przywrócenie, flaga przeglądu.
alter table public.report_events
  add column if not exists decision_id uuid references public.moderation_decisions(id) on delete restrict;
alter table public.report_events drop constraint if exists report_events_event_type_check;
alter table public.report_events add constraint report_events_event_type_check
  check (event_type in ('submitted', 'status_changed', 'decision', 'restored', 'flagged'));

-- --- 4. Spójność decyzji i skutku (przy COMMIT) -----------------------------------------
-- SECURITY DEFINER: odroczony trigger działa przy COMMIT w roli wywołującego (np. authenticated).
create or replace function public.moderation_effect_check()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ok boolean;
begin
  if exists (select 1 from public.moderation_restorations r where r.decision_id = new.id) then
    v_ok := true;
  elsif new.decision = 'job_removed' then
    select j.status = 'closed' and j.moderation_decision_id is not null into v_ok
      from public.jobs j where j.id = new.job_id;
  elsif new.decision = 'company_suspended' then
    select c.status = 'suspended' and c.moderation_decision_id is not null into v_ok
      from public.companies c where c.id = new.company_id;
  else
    v_ok := true;
  end if;

  if coalesce(v_ok, false) then
    select r.decision_id = new.id
           and r.status = case when new.decision = 'no_action' then 'dismissed' else 'resolved' end::public.report_status
      into v_ok
      from public.reports r where r.id = new.report_id;
  end if;

  if not coalesce(v_ok, false) then
    raise exception 'MODERATION_EFFECT_MISSING: decyzja bez wykonanego skutku' using errcode = '23514';
  end if;
  return null;
end $$;
revoke all on function public.moderation_effect_check() from public;

drop trigger if exists trg_moderation_effect_check on public.moderation_decisions;
create constraint trigger trg_moderation_effect_check
  after insert on public.moderation_decisions
  deferrable initially deferred
  for each row execute function public.moderation_effect_check();

-- --- 5. Decyzja (RPC) ------------------------------------------------------------------
create or replace function public.admin_decide_report(
  p_report_id           uuid,
  p_expected_status     text,
  p_decision            text,
  p_facts               text,
  p_ground_type         text default null,
  p_ground_reference    text default null,
  p_automated_detection boolean default false
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_facts    text := btrim(coalesce(p_facts, ''));
  v_ref      text := nullif(btrim(coalesce(p_ground_reference, '')), '');
  v_ground   text := nullif(btrim(coalesce(p_ground_type, '')), '');
  v_report   record;
  v_lock     uuid;
  v_title    text;
  v_job_id   uuid;
  v_company_id uuid;
  v_prev     text;
  v_id       uuid := gen_random_uuid();
  v_number   text;
  v_to       public.report_status;
  v_owner    uuid;
  v_locale   text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;

  if p_decision is null or p_decision not in ('no_action', 'job_removed', 'company_suspended') then
    raise exception 'VALIDATION_FAILED: DECISION' using errcode = '22023';
  end if;
  if char_length(v_facts) < 20 then
    raise exception 'VALIDATION_FAILED: FACTS_REQUIRED' using errcode = '22023';
  end if;
  if char_length(v_facts) > 1000 then
    raise exception 'VALIDATION_FAILED: FACTS_TOO_LONG' using errcode = '22023';
  end if;
  if p_decision <> 'no_action' then
    if v_ground is null or v_ground not in ('terms', 'law') then
      raise exception 'VALIDATION_FAILED: GROUND_REQUIRED' using errcode = '22023';
    end if;
    if v_ref is null or char_length(v_ref) < 3 then
      raise exception 'VALIDATION_FAILED: GROUND_REFERENCE_REQUIRED' using errcode = '22023';
    end if;
    if char_length(v_ref) > 300 then
      raise exception 'VALIDATION_FAILED: GROUND_REFERENCE_TOO_LONG' using errcode = '22023';
    end if;
  else
    -- Brak działań: podstawa nie dotyczy.
    v_ground := null;
    v_ref := null;
  end if;

  select r.id, r.kind, r.status, r.target_type::text as target_type, r.target_id, r.case_number,
         r.reporter_id, r.reporter_email, r.reporter_locale, r.reporter_name
    into v_report
    from public.reports r where r.id = p_report_id
    for update;
  if not found or v_report.kind <> 'dsa_notice' then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_expected_status is null or v_report.status::text is distinct from p_expected_status then
    raise exception 'STALE_STATE: status sprawy zmienił się (%)', v_report.status;
  end if;
  if v_report.status not in ('open', 'reviewing') then
    raise exception 'INVALID_TRANSITION: sprawa rozstrzygnięta' using errcode = '22023';
  end if;

  -- Zasięg: oferta albo firma (zgłoszenie oferty może skutkować zawieszeniem jej firmy).
  if v_report.target_type = 'job' then
    v_job_id := v_report.target_id;
    select j.company_id into v_company_id from public.jobs j where j.id = v_job_id;
  elsif v_report.target_type = 'company' then
    v_company_id := v_report.target_id;
    if p_decision = 'job_removed' then
      raise exception 'VALIDATION_FAILED: DECISION_SCOPE' using errcode = '22023';
    end if;
  end if;

  if p_decision = 'job_removed' then
    select j.status::text, j.moderation_decision_id, j.title
      into v_prev, v_lock, v_title
      from public.jobs j where j.id = v_job_id and j.deleted_at is null
      for update;
    if not found then raise exception 'NOT_FOUND: treść nie istnieje' using errcode = 'P0002'; end if;
  elsif p_decision = 'company_suspended' then
    select c.status::text, c.moderation_decision_id
      into v_prev, v_lock
      from public.companies c where c.id = v_company_id and c.deleted_at is null
      for update;
    if not found then raise exception 'NOT_FOUND: treść nie istnieje' using errcode = 'P0002'; end if;
  end if;

  -- Treść już zablokowana inną decyzją: stan sprzed PIERWSZEGO ograniczenia (do przywrócenia).
  if v_lock is not null then
    select d.previous_status into v_prev from public.moderation_decisions d where d.id = v_lock;
  end if;

  -- Numer decyzji do odwołań (bez tożsamości moderatora).
  v_number := 'DEC-' || upper(substr(replace(v_id::text, '-', ''), 1, 4) || '-'
              || substr(replace(v_id::text, '-', ''), 5, 4) || '-'
              || substr(replace(v_id::text, '-', ''), 9, 4));

  insert into public.moderation_decisions(
    id, reference, report_id, decision, job_id, company_id, facts, ground_type, ground_reference,
    automated_detection, previous_status, decided_by)
  values (
    v_id, v_number, v_report.id, p_decision,
    case when p_decision = 'job_removed' then v_job_id end,
    case when p_decision <> 'no_action' then v_company_id end,
    v_facts, v_ground, v_ref, coalesce(p_automated_detection, false), v_prev, auth.uid());

  -- Skutek. Treść już ograniczona inną decyzją zostaje ograniczona (blokada bez zmian).
  perform set_config('pracujbe.moderation', 'on', true);
  if p_decision = 'job_removed' and v_lock is null then
    update public.jobs
      set status = 'closed', moderation_decision_id = v_id, updated_at = now()
      where id = v_job_id;
  elsif p_decision = 'company_suspended' and v_lock is null then
    update public.companies
      set status = 'suspended', status_reason = v_facts, moderation_decision_id = v_id, updated_at = now()
      where id = v_company_id;
  end if;
  perform set_config('pracujbe.moderation', '', true);

  v_to := case when p_decision = 'no_action' then 'dismissed' else 'resolved' end;
  update public.reports
    set status = v_to, decision_id = v_id, resolved_by = auth.uid(), resolved_at = now(), updated_at = now()
    where id = v_report.id;

  insert into public.report_events(report_id, event_type, to_status, actor_id, decision_id)
    values (v_report.id, 'decision', v_to, auth.uid(), v_id);

  perform public.write_audit('moderation.decided', 'report', v_report.id,
    jsonb_build_object('status', v_report.status::text),
    jsonb_strip_nulls(jsonb_build_object(
      'status', v_to::text, 'decision', p_decision, 'decisionId', v_id, 'reference', v_number,
      'jobId', case when p_decision = 'job_removed' then v_job_id end,
      'companyId', case when p_decision <> 'no_action' then v_company_id end,
      'previousStatus', v_prev, 'groundType', v_ground, 'groundReference', v_ref,
      'automatedDetection', coalesce(p_automated_detection, false))));

  -- Autor treści: uzasadnienie (fakty, podstawa, automatyzacja, droga odwołania) w JEGO języku.
  if p_decision <> 'no_action' then
    for v_owner in
      select cm.profile_id
        from public.company_members cm
        where cm.company_id = v_company_id
          and cm.role = 'owner'
          and public.company_recipient_ok(v_company_id, cm.profile_id)
    loop
      insert into public.notifications (profile_id, type, title, entity_type, entity_id, data)
        values (v_owner, 'system'::public.notification_type, 'moderation_decision', 'company', v_company_id,
                jsonb_build_object('kind', 'moderation', 'decision', p_decision, 'decisionId', v_id));

      perform public.enqueue_email(v_owner,
        case when p_decision = 'job_removed' then 'moderationJobRemoved' else 'moderationCompanySuspended' end,
        'moderation_decision', v_id,
        'moderation-decision-' || v_id::text || '-' || v_owner::text,
        jsonb_strip_nulls(jsonb_build_object(
          'companyName', (select c.name from public.companies c where c.id = v_company_id),
          'jobTitle', v_title,
          'facts', v_facts, 'groundType', v_ground, 'groundReference', v_ref,
          'automatedDetection', coalesce(p_automated_detection, false),
          'decisionReference', v_number)));
    end loop;
  end if;

  -- Zgłaszający: sam wynik (bez faktów i danych autora), w jego języku.
  v_locale := v_report.reporter_locale;
  if v_report.reporter_id is not null
     and exists (select 1 from public.profiles p where p.id = v_report.reporter_id and p.deleted_at is null) then
    v_locale := public.resolve_recipient_locale(v_report.reporter_id);
  end if;
  perform public.enqueue_email_to_address(
    v_report.reporter_email::text, v_locale, v_report.reporter_id,
    case when p_decision = 'no_action' then 'reportDecisionNoAction' else 'reportDecisionActioned' end,
    'report', v_report.id, 'report-decision-' || v_report.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'caseNumber', v_report.case_number,
      'targetType', v_report.target_type,
      'recipientName', v_report.reporter_name)));

  return v_id;
end $$;
revoke all on function public.admin_decide_report(uuid, text, text, text, text, text, boolean)
  from public, anon;
grant execute on function public.admin_decide_report(uuid, text, text, text, text, text, boolean)
  to authenticated;

-- --- 6. Przywrócenie (RPC) -------------------------------------------------------------
create or replace function public.admin_restore_moderation(p_decision_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_dec     record;
  v_job     record;
  v_company record;
  v_next    uuid;
  v_id      uuid;
  v_owner   uuid;
  v_title   text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if char_length(v_reason) < 20 then
    raise exception 'VALIDATION_FAILED: REASON_REQUIRED' using errcode = '22023';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'VALIDATION_FAILED: REASON_TOO_LONG' using errcode = '22023';
  end if;

  select d.* into v_dec from public.moderation_decisions d where d.id = p_decision_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_dec.decision = 'no_action' then
    raise exception 'INVALID_TRANSITION: decyzja bez ograniczenia' using errcode = '22023';
  end if;
  -- Blokada sprawy decyzji serializuje przywrócenia tej samej decyzji.
  perform 1 from public.reports r where r.id = v_dec.report_id for update;
  if exists (select 1 from public.moderation_restorations r where r.decision_id = p_decision_id) then
    raise exception 'STALE_STATE: decyzja już cofnięta';
  end if;

  insert into public.moderation_restorations(decision_id, reason, restored_by)
    values (p_decision_id, v_reason, auth.uid())
    returning id into v_id;

  perform set_config('pracujbe.moderation', 'on', true);
  if v_dec.decision = 'job_removed' then
    select j.id, j.status::text as status, j.moderation_decision_id, j.expires_at, j.title
      into v_job from public.jobs j where j.id = v_dec.job_id for update;
    if found and v_job.moderation_decision_id = p_decision_id then
      -- Inna aktywna decyzja o tej ofercie przejmuje blokadę (treść zostaje ograniczona).
      select d.id into v_next from public.moderation_decisions d
        where d.decision = 'job_removed' and d.job_id = v_dec.job_id and d.id <> p_decision_id
          and not exists (select 1 from public.moderation_restorations r where r.decision_id = d.id)
        order by d.decided_at, d.id limit 1;
      if v_next is not null then
        update public.jobs set moderation_decision_id = v_next where id = v_dec.job_id;
      else
        update public.jobs
          set moderation_decision_id = null,
              status = case when v_dec.previous_status in ('active', 'paused')
                             and (v_job.expires_at is null or v_job.expires_at > now())
                            then v_dec.previous_status::public.job_status
                            else 'closed'::public.job_status end,
              updated_at = now()
          where id = v_dec.job_id;
      end if;
    end if;
    v_title := v_job.title;
  else
    select c.id, c.moderation_decision_id into v_company
      from public.companies c where c.id = v_dec.company_id for update;
    if found and v_company.moderation_decision_id = p_decision_id then
      select d.id into v_next from public.moderation_decisions d
        where d.decision = 'company_suspended' and d.company_id = v_dec.company_id and d.id <> p_decision_id
          and not exists (select 1 from public.moderation_restorations r where r.decision_id = d.id)
        order by d.decided_at, d.id limit 1;
      if v_next is not null then
        update public.companies set moderation_decision_id = v_next where id = v_dec.company_id;
      else
        update public.companies
          set moderation_decision_id = null,
              status = coalesce(v_dec.previous_status, 'pending')::public.company_status,
              status_reason = null,
              updated_at = now()
          where id = v_dec.company_id;
      end if;
    end if;
  end if;
  perform set_config('pracujbe.moderation', '', true);

  insert into public.report_events(report_id, event_type, actor_id, decision_id)
    values (v_dec.report_id, 'restored', auth.uid(), p_decision_id);

  perform public.write_audit('moderation.restored', 'report', v_dec.report_id,
    jsonb_build_object('decisionId', p_decision_id, 'decision', v_dec.decision),
    jsonb_build_object('restorationId', v_id, 'reason', v_reason, 'reference', v_dec.reference,
                       'stillRestricted', v_next is not null));

  if v_dec.company_id is not null then
    for v_owner in
      select cm.profile_id
        from public.company_members cm
        where cm.company_id = v_dec.company_id
          and cm.role = 'owner'
          and public.company_recipient_ok(v_dec.company_id, cm.profile_id)
    loop
      insert into public.notifications (profile_id, type, title, entity_type, entity_id, data)
        values (v_owner, 'system'::public.notification_type, 'moderation_restored', 'company', v_dec.company_id,
                jsonb_build_object('kind', 'moderation', 'decision', 'restored', 'decisionId', p_decision_id));

      perform public.enqueue_email(v_owner, 'moderationRestored', 'moderation_decision', p_decision_id,
        'moderation-restored-' || p_decision_id::text || '-' || v_owner::text,
        jsonb_strip_nulls(jsonb_build_object(
          'companyName', (select c.name from public.companies c where c.id = v_dec.company_id),
          'jobTitle', v_title,
          'reason', v_reason,
          'decisionReference', v_dec.reference)));
    end loop;
  end if;

  return v_id;
end $$;
revoke all on function public.admin_restore_moderation(uuid, text) from public, anon;
grant execute on function public.admin_restore_moderation(uuid, text) to authenticated;

-- --- 7. Flaga kolejki przeglądu (automat/AI tylko flaguje) ------------------------------
create or replace function public.flag_report_for_review(p_report_id uuid, p_priority integer, p_flag text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_flag text := nullif(btrim(coalesce(p_flag, '')), '');
begin
  if p_priority is null or p_priority not between 0 and 3 then
    raise exception 'VALIDATION_FAILED: priorytet' using errcode = '22023';
  end if;
  if v_flag is not null and char_length(v_flag) > 200 then
    raise exception 'VALIDATION_FAILED: flaga' using errcode = '22023';
  end if;
  perform set_config('pracujbe.review_flag', 'on', true);
  update public.reports
    set review_priority = p_priority, review_flag = v_flag, updated_at = now()
    where id = p_report_id and kind = 'dsa_notice' and status in ('open', 'reviewing');
  if not found then
    perform set_config('pracujbe.review_flag', '', true);
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform set_config('pracujbe.review_flag', '', true);
  insert into public.report_events(report_id, event_type) values (p_report_id, 'flagged');
end $$;
revoke all on function public.flag_report_for_review(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.flag_report_for_review(uuid, integer, text) to service_role;

-- --- 8. Decyzje dotyczące firmy — dla jej właściciela/administratora --------------------
create or replace function public.get_company_moderation_decisions(p_company_id uuid)
returns table (
  id uuid, reference text, decision text, job_id uuid, job_title text, facts text,
  ground_type text, ground_reference text, automated_detection boolean,
  decided_at timestamptz, restored_at timestamptz, restore_reason text
) language sql stable security definer set search_path = public, pg_temp as $$
  select d.id, d.reference, d.decision, d.job_id, j.title, d.facts, d.ground_type, d.ground_reference,
         d.automated_detection, d.decided_at, r.restored_at, r.reason
    from public.moderation_decisions d
    left join public.jobs j on j.id = d.job_id
    left join public.moderation_restorations r on r.decision_id = d.id
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

-- --- 9. Sprawdzenie sprawy: wynik bez uzasadnienia --------------------------------------
create or replace function public.get_report_case(p_case_number text, p_access_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_report record;
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
  if not found
     or v_report.access_code_hash <> encode(sha256(convert_to(p_access_code, 'UTF8')), 'hex') then
    return null;
  end if;
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
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'type', e.event_type, 'toStatus', e.to_status, 'at', e.created_at) order by e.id)
        from public.report_events e
        where e.report_id = v_report.id and e.event_type in ('submitted', 'status_changed')), '[]'::jsonb));
end $$;
revoke all on function public.get_report_case(text, text) from public, anon, authenticated;
grant execute on function public.get_report_case(text, text) to service_role;
