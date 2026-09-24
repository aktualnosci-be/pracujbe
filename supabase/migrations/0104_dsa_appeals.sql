-- =============================================================================
-- 0104 — DSA: odwołania od decyzji moderacyjnych, terminy, retencja spraw i dane do raportu
-- przejrzystości (#43). Numer według kolejki koordynatora (po 0100–0103).
--
-- Buduje na sprawie `dsa_notice` (0094, #41) i decyzji moderacyjnej (0099, #42).
--
-- 1. `moderation_appeals` — wewnętrzny system rozpatrywania skarg. Odwołać się mogą:
--    - autor treści (aktywny owner/admin firmy) — od ograniczenia (`job_removed`,
--      `company_suspended`), RPC `submit_moderation_appeal` pod sesją;
--    - zgłaszający — od decyzji o braku działań (`no_action`), RPC `submit_report_appeal`
--      (service_role; tożsamość = numer sprawy + kod dostępu, jak `get_report_case`).
--    Żadna strona nie widzi danych drugiej: autor dostaje wyłącznie swoje decyzje i swoje
--    odwołania, zgłaszający wyłącznie wynik swojej sprawy. Jedno odwołanie na decyzję.
-- 2. Termin odwołania liczony od POINFORMOWANIA strony (`moderation_informed_at`): pierwsze
--    faktycznie wysłane powiadomienie e-mail o decyzji (status sent/delivered/opened/clicked —
--    odbicie nie liczy się jako poinformowanie) albo odczyt powiadomienia w panelu (autor).
--    Dopóki strona nie została poinformowana, termin nie biegnie.
-- 3. Rozpatrzenie przez człowieka: `admin_decide_appeal` — `upheld` (decyzja utrzymana) albo
--    `reversed`. Osoba rozpatrująca musi być inna niż autor decyzji, jeśli w serwisie jest inny
--    aktywny administrator (REVIEWER_CONFLICT); gdy nie ma — zapis `same_reviewer = true`.
--    Skutek w tej samej transakcji:
--    - odwołanie autora uwzględnione → cofnięcie ograniczenia (`moderation_restorations`,
--      zdjęcie blokady, status sprzed decyzji — wspólny rdzeń `moderation_restore_core`);
--    - odwołanie zgłaszającego uwzględnione → NOWA decyzja ograniczająca (`appeal_id`),
--      egzekucja jak w `admin_decide_report`, sprawa przechodzi dismissed → resolved
--      i wskazuje nową decyzję (strażnik sprawy dopuszcza to wyłącznie w tej ścieżce).
--    Historia (`report_events`), audyt (`moderation.appeal_submitted/_decided`), powiadomienia
--    przez outbox w JĘZYKU ODBIORCY (Invariant #1). Błąd dowolnej części cofa całość.
-- 4. Retencja: `dsa_retention_report()` (podgląd, bez zapisu) i `dsa_retention_run(p_dry_run)`
--    (service_role; zapis przebiegu w `dsa_retention_runs`). Sprawa kwalifikuje się dopiero,
--    gdy każda jej decyzja jest poza drogą odwołania (odwołanie rozpatrzone, ograniczenie
--    cofnięte albo termin odwołania upłynął od POINFORMOWANIA) i minął okres retencji.
--    Czyszczenie nie usuwa wierszy: anonimizuje dane osobowe i dowód (kontakt zgłaszającego,
--    opis, adres, snapshot, kod dostępu, fakty/powody/uzasadnienia, payload e-maili), zostawia
--    kategorie, rodzaje, daty i numery — agregaty raportu przejrzystości przetrwają retencję.
-- 5. Raport przejrzystości: `dsa_transparency_report(from, to)` (agregaty) i
--    `dsa_statements_export(from, to)` (wiersz na decyzję) — bez danych osobowych i bez treści
--    faktów. Tylko service_role (panel admina po `requireAdmin`).
--
-- Wartości TYMCZASOWE do zatwierdzenia w mapie obowiązków (#40): okno odwołania 6 miesięcy,
-- termin rozpatrzenia odwołania 14 dni, retencja 12 miesięcy od zamknięcia drogi odwołania;
-- zakres publikacji raportu i przekazywania do bazy DSA. Uruchamianie czyszczenia
-- (harmonogram) — dopiero po tym zatwierdzeniu.
--
-- Rollback (odwołania są dowodem — przed rollbackiem wyeksportować `moderation_appeals`
-- i `dsa_retention_runs`): drop functions submit_moderation_appeal, submit_report_appeal,
-- admin_decide_appeal, moderation_restore_core, moderation_informed_at,
-- moderation_appeal_deadline, moderation_appeal_guard, dsa_retention_*, dsa_transparency_report,
-- dsa_statements_export, dsa_appeal_window, dsa_appeal_review_period, dsa_case_retention;
-- przywrócić z 0099: admin_restore_moderation, reports_decision_guard, moderation_append_only,
-- get_company_moderation_decisions, get_report_case, check `report_events.event_type`,
-- unikat `moderation_decisions(report_id)`; z 0094: reports_notice_immutable,
-- reports_dsa_notice_complete, report_events_select_own; drop tables dsa_retention_runs,
-- moderation_appeals; drop nowych kolumn. Zanonimizowanych danych rollback nie przywraca.
-- =============================================================================

-- --- 0. Wartości tymczasowe (#40) --------------------------------------------------------
create or replace function public.dsa_appeal_window()
returns interval language sql immutable set search_path = public, pg_temp as $$ select interval '6 months' $$;
create or replace function public.dsa_appeal_review_period()
returns interval language sql immutable set search_path = public, pg_temp as $$ select interval '14 days' $$;
create or replace function public.dsa_case_retention()
returns interval language sql immutable set search_path = public, pg_temp as $$ select interval '12 months' $$;
revoke all on function public.dsa_appeal_window() from public;
revoke all on function public.dsa_appeal_review_period() from public;
revoke all on function public.dsa_case_retention() from public;
grant execute on function public.dsa_appeal_window() to service_role;
grant execute on function public.dsa_appeal_review_period() to service_role;
grant execute on function public.dsa_case_retention() to service_role;

-- --- 1. Odwołania --------------------------------------------------------------------------
create table if not exists public.moderation_appeals (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique,
  decision_id       uuid not null references public.moderation_decisions(id) on delete restrict,
  report_id         uuid not null references public.reports(id) on delete restrict,
  appellant_role    text not null check (appellant_role in ('author', 'reporter')),
  appellant_id      uuid references public.profiles(id) on delete set null,
  appellant_locale  text not null references public.supported_locales(code),
  grounds           text,
  idempotency_key   uuid not null unique,
  status            text not null default 'pending' check (status in ('pending', 'upheld', 'reversed')),
  submitted_at      timestamptz not null default now(),
  due_at            timestamptz not null,
  outcome_reasoning text,
  new_decision_id   uuid references public.moderation_decisions(id) on delete restrict,
  restoration_id    uuid references public.moderation_restorations(id) on delete restrict,
  decided_by        uuid references public.profiles(id) on delete set null,
  decided_at        timestamptz,
  same_reviewer     boolean,
  redacted_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint moderation_appeals_grounds check (
    (grounds is null and redacted_at is not null) or char_length(grounds) between 20 and 2000
  ),
  constraint moderation_appeals_reasoning check (
    outcome_reasoning is null or char_length(outcome_reasoning) between 20 and 1000
  ),
  -- Stan rozpatrzenia jest kompletny albo go nie ma.
  constraint moderation_appeals_decided check (
    (status = 'pending' and decided_at is null and outcome_reasoning is null
       and new_decision_id is null and restoration_id is null and same_reviewer is null)
    or (status in ('upheld', 'reversed') and decided_at is not null and same_reviewer is not null
       and (outcome_reasoning is not null or redacted_at is not null))
  ),
  -- Uwzględnienie ma skutek; utrzymanie — żadnego.
  constraint moderation_appeals_effect check (
    (status <> 'reversed'
      or (appellant_role = 'author' and restoration_id is not null and new_decision_id is null)
      or (appellant_role = 'reporter' and new_decision_id is not null and restoration_id is null))
    and (status <> 'upheld' or (new_decision_id is null and restoration_id is null))
  )
);
create unique index if not exists moderation_appeals_decision_uq on public.moderation_appeals(decision_id);
create index if not exists moderation_appeals_queue_idx
  on public.moderation_appeals(due_at) where status = 'pending';
create index if not exists moderation_appeals_report_idx on public.moderation_appeals(report_id);

alter table public.moderation_appeals enable row level security;
revoke all on public.moderation_appeals from public, anon, authenticated;

-- Decyzja wydana po uwzględnieniu odwołania zgłaszającego wskazuje to odwołanie. Sprawa ma
-- jedną decyzję pierwotną i najwyżej jedną z każdego odwołania.
alter table public.moderation_decisions
  add column if not exists appeal_id   uuid references public.moderation_appeals(id) on delete restrict,
  add column if not exists redacted_at timestamptz;
drop index if exists public.moderation_decisions_report_uq;
create unique index if not exists moderation_decisions_report_uq
  on public.moderation_decisions(report_id) where appeal_id is null;
create unique index if not exists moderation_decisions_appeal_uq
  on public.moderation_decisions(appeal_id) where appeal_id is not null;

-- Retencja: fakty/powód mogą zostać zanonimizowane (tylko przez `dsa_retention_run`).
alter table public.moderation_decisions alter column facts drop not null;
alter table public.moderation_decisions drop constraint if exists moderation_decisions_facts_check;
alter table public.moderation_decisions add constraint moderation_decisions_facts_check check (
  (facts is null and redacted_at is not null) or char_length(facts) between 20 and 1000
);
alter table public.moderation_restorations
  add column if not exists redacted_at timestamptz;
alter table public.moderation_restorations alter column reason drop not null;
alter table public.moderation_restorations drop constraint if exists moderation_restorations_reason_check;
alter table public.moderation_restorations add constraint moderation_restorations_reason_check check (
  (reason is null and redacted_at is not null) or char_length(reason) between 20 and 1000
);

-- Niezmienność decyzji i przywróceń (0099) + jedyny wyjątek retencji: fakty/powód → null.
create or replace function public.moderation_append_only()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_fk constant text[] := array['job_id', 'company_id', 'decided_by', 'restored_by'];
  v_redact constant text[] := array['facts', 'reason', 'redacted_at'];
  v_key text;
begin
  if tg_op = 'UPDATE'
     and coalesce(current_setting('pracujbe.retention', true), '') = 'on'
     and to_jsonb(old)->>'redacted_at' is null and to_jsonb(new)->>'redacted_at' is not null
     and to_jsonb(new)->>'facts' is null and to_jsonb(new)->>'reason' is null
     and (to_jsonb(new) - v_redact) = (to_jsonb(old) - v_redact) then
    return new;
  end if;
  -- Jedyna inna dozwolona zmiana: odwołanie FK przechodzi na null (usunięcie konta/treści).
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

-- Odwołanie: treść niezmienna; rozpatrzenie raz (pending → upheld/reversed) wyłącznie przez
-- `admin_decide_appeal`; retencja anonimizuje uzasadnienia; FK profili mogą przejść na null.
create or replace function public.moderation_appeal_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_decided constant text[] := array['status', 'outcome_reasoning', 'decided_by', 'decided_at',
    'same_reviewer', 'new_decision_id', 'restoration_id', 'updated_at'];
  v_redact constant text[] := array['grounds', 'outcome_reasoning', 'redacted_at', 'updated_at'];
  v_fk constant text[] := array['appellant_id', 'decided_by'];
begin
  if tg_op = 'DELETE' then
    raise exception 'PERMISSION_DENIED: odwołania nie można usunąć' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.redacted_at is not null then
      raise exception 'PERMISSION_DENIED: nowe odwołanie czeka na rozpatrzenie' using errcode = '42501';
    end if;
    return new;
  end if;

  if coalesce(current_setting('pracujbe.retention', true), '') = 'on'
     and old.redacted_at is null and new.redacted_at is not null
     and new.grounds is null and new.outcome_reasoning is null
     and (to_jsonb(new) - v_redact) = (to_jsonb(old) - v_redact) then
    return new;
  end if;

  if (to_jsonb(new) - v_fk) = (to_jsonb(old) - v_fk)
     and (new.appellant_id is null or new.appellant_id = old.appellant_id)
     and (new.decided_by is null or new.decided_by is not distinct from old.decided_by) then
    return new;
  end if;

  if coalesce(current_setting('pracujbe.appeal', true), '') = 'on'
     and old.status = 'pending' and new.status in ('upheld', 'reversed')
     and (to_jsonb(new) - v_decided) = (to_jsonb(old) - v_decided) then
    -- Skutek dotyczy TEJ decyzji / TEGO odwołania.
    if new.restoration_id is not null and not exists (
         select 1 from public.moderation_restorations r
          where r.id = new.restoration_id and r.decision_id = new.decision_id) then
      raise exception 'PERMISSION_DENIED: przywrócenie nie dotyczy tej decyzji' using errcode = '42501';
    end if;
    if new.new_decision_id is not null and not exists (
         select 1 from public.moderation_decisions d
          where d.id = new.new_decision_id and d.appeal_id = new.id) then
      raise exception 'PERMISSION_DENIED: nowa decyzja nie wynika z tego odwołania' using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'PERMISSION_DENIED: odwołanie jest niezmienne' using errcode = '42501';
end $$;
revoke all on function public.moderation_appeal_guard() from public;

drop trigger if exists trg_moderation_appeal_guard on public.moderation_appeals;
create trigger trg_moderation_appeal_guard
  before insert or update or delete on public.moderation_appeals
  for each row execute function public.moderation_appeal_guard();

-- --- 2. Sprawa: retencja i ścieżka odwołania ---------------------------------------------
alter table public.reports add column if not exists redacted_at timestamptz;

-- Sprawa DSA kompletna albo zanonimizowana po retencji (dane osobowe i dowód → null).
alter table public.reports drop constraint if exists reports_dsa_notice_complete;
alter table public.reports add constraint reports_dsa_notice_complete check (
  kind <> 'dsa_notice' or (
    case_number is not null and idempotency_key is not null and category is not null
    and reporter_locale is not null and good_faith_at is not null and due_at is not null
    and target_type in ('job', 'company')
    and (redacted_at is not null or (
      access_code_hash is not null and details is not null and reporter_email is not null
      and target_snapshot is not null))
  )
);

-- Niezmienność zgłoszenia (0094) + wyjątek retencji.
create or replace function public.reports_notice_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_redact constant text[] := array['access_code_hash', 'content_url', 'reporter_name', 'reporter_email',
    'target_snapshot', 'details', 'reporter_id', 'redacted_at', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    if old.kind = 'dsa_notice' then
      raise exception 'PERMISSION_DENIED: sprawy zgłoszenia nie można usunąć' using errcode = '42501';
    end if;
    return old;
  end if;

  if old.kind = 'dsa_notice'
     and coalesce(current_setting('pracujbe.retention', true), '') = 'on'
     and old.redacted_at is null and new.redacted_at is not null then
    if (to_jsonb(new) - v_redact) is distinct from (to_jsonb(old) - v_redact)
       or new.access_code_hash is not null or new.content_url is not null or new.reporter_name is not null
       or new.reporter_email is not null or new.target_snapshot is not null or new.details is not null
       or new.reporter_id is not null then
      raise exception 'PERMISSION_DENIED: retencja tylko anonimizuje sprawę' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.kind = 'dsa_notice' or new.kind is distinct from old.kind then
    if new.kind is distinct from old.kind
       or new.case_number is distinct from old.case_number
       or new.access_code_hash is distinct from old.access_code_hash
       or new.idempotency_key is distinct from old.idempotency_key
       or new.category is distinct from old.category
       or new.content_url is distinct from old.content_url
       or new.reporter_name is distinct from old.reporter_name
       or new.reporter_email is distinct from old.reporter_email
       or new.reporter_locale is distinct from old.reporter_locale
       or new.good_faith_at is distinct from old.good_faith_at
       or new.target_snapshot is distinct from old.target_snapshot
       or new.due_at is distinct from old.due_at
       or new.target_type is distinct from old.target_type
       or new.target_id is distinct from old.target_id
       or new.reason is distinct from old.reason
       or new.details is distinct from old.details
       or new.created_at is distinct from old.created_at
       or new.redacted_at is distinct from old.redacted_at
       or (new.reporter_id is distinct from old.reporter_id and new.reporter_id is not null) then
      raise exception 'PERMISSION_DENIED: treść zgłoszenia jest niezmienna' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.reports_notice_immutable() from public;

-- Strażnik sprawy (0099) + jedyna ścieżka zmiany rozstrzygniętej sprawy: uwzględnione
-- odwołanie zgłaszającego (dismissed → resolved, decyzja z tego odwołania).
create or replace function public.reports_decision_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_decision text;
  v_appeal   boolean := false;
begin
  if new.decision_id is distinct from old.decision_id then
    if new.kind <> 'dsa_notice' then
      raise exception 'PERMISSION_DENIED: decyzji sprawy nie można zmienić' using errcode = '42501';
    end if;
    if old.decision_id is not null then
      v_appeal := coalesce(current_setting('pracujbe.appeal', true), '') = 'on'
        and exists (
          select 1 from public.moderation_decisions d
            join public.moderation_appeals a on a.id = d.appeal_id
           where d.id = new.decision_id and d.report_id = new.id
             and a.decision_id = old.decision_id and a.appellant_role = 'reporter');
      if not v_appeal then
        raise exception 'PERMISSION_DENIED: decyzji sprawy nie można zmienić' using errcode = '42501';
      end if;
    end if;
    select d.decision into v_decision from public.moderation_decisions d
      where d.id = new.decision_id and d.report_id = new.id;
    if not found then
      raise exception 'PERMISSION_DENIED: decyzja nie dotyczy tej sprawy' using errcode = '42501';
    end if;
  end if;

  if new.kind = 'dsa_notice' and new.status is distinct from old.status then
    if old.status in ('resolved', 'dismissed')
       and not (v_appeal and old.status = 'dismissed' and new.status = 'resolved') then
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

alter table public.report_events drop constraint if exists report_events_event_type_check;
alter table public.report_events add constraint report_events_event_type_check
  check (event_type in ('submitted', 'status_changed', 'decision', 'restored', 'flagged',
                        'appeal_submitted', 'appeal_decided', 'redacted'));

-- Zgłaszający widzi historię swojej sprawy bez zdarzeń odwołań (odwołanie autora to dane
-- drugiej strony; własne odwołanie zgłaszający widzi w `get_report_case`).
drop policy if exists report_events_select_own on public.report_events;
create policy report_events_select_own on public.report_events
  for select to authenticated
  using (
    event_type not in ('appeal_submitted', 'appeal_decided')
    and exists (
      select 1 from public.reports r
      where r.id = report_events.report_id and r.reporter_id = auth.uid()
    ));

-- --- 3. Terminy ----------------------------------------------------------------------------
-- Chwila poinformowania strony, której decyzja dotyczy (null = jeszcze nie poinformowana).
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

-- Koniec terminu odwołania (null = termin jeszcze nie biegnie).
create or replace function public.moderation_appeal_deadline(p_decision_id uuid)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $$
  select public.moderation_informed_at(p_decision_id) + public.dsa_appeal_window();
$$;
revoke all on function public.moderation_appeal_deadline(uuid) from public, anon, authenticated;
grant execute on function public.moderation_appeal_deadline(uuid) to service_role;

-- Czy od decyzji przysługuje (jeszcze) odwołanie — bez sprawdzania tożsamości strony.
create or replace function public.moderation_appealable(p_decision_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when d.id is null or d.redacted_at is not null then 'NOT_FOUND'
    when exists (select 1 from public.moderation_appeals a where a.decision_id = d.id) then 'APPEAL_EXISTS'
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

create or replace function public.moderation_appeal_reference(p_id uuid)
returns text language sql immutable set search_path = public, pg_temp as $$
  select 'APL-' || upper(substr(replace(p_id::text, '-', ''), 1, 4) || '-'
         || substr(replace(p_id::text, '-', ''), 5, 4) || '-'
         || substr(replace(p_id::text, '-', ''), 9, 4));
$$;
revoke all on function public.moderation_appeal_reference(uuid) from public;

-- --- 4. Rdzeń przywrócenia (wspólny: ręczne cofnięcie i uwzględnione odwołanie autora) ----
create or replace function public.moderation_restore_core(p_decision_id uuid, p_reason text, p_notify boolean)
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

  if p_notify and v_dec.company_id is not null then
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
revoke all on function public.moderation_restore_core(uuid, text, boolean) from public, anon, authenticated;

create or replace function public.admin_restore_moderation(p_decision_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  return public.moderation_restore_core(p_decision_id, p_reason, true);
end $$;
revoke all on function public.admin_restore_moderation(uuid, text) from public, anon;
grant execute on function public.admin_restore_moderation(uuid, text) to authenticated;

-- --- 5. Odwołanie autora (sesja) -----------------------------------------------------------
create or replace function public.submit_moderation_appeal(
  p_decision_id     uuid,
  p_idempotency_key uuid,
  p_grounds         text
) returns table (appeal_id uuid, reference text, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid     uuid := auth.uid();
  v_grounds text := btrim(coalesce(p_grounds, ''));
  v_dec     record;
  v_exist   record;
  v_state   text;
  v_id      uuid := gen_random_uuid();
  v_ref     text;
  v_locale  text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_idempotency_key is null then
    raise exception 'VALIDATION_FAILED: brak klucza idempotencji' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('appeal:' || p_idempotency_key::text, 0));
  select a.id, a.reference, a.decision_id, a.appellant_id into v_exist
    from public.moderation_appeals a where a.idempotency_key = p_idempotency_key;
  if found then
    if v_exist.decision_id is distinct from p_decision_id or v_exist.appellant_id is distinct from v_uid then
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

  -- Blokada decyzji serializuje równoległe odwołania od niej.
  select d.id, d.decision, d.company_id, d.report_id, d.reference into v_dec
    from public.moderation_decisions d where d.id = p_decision_id for update;
  -- Decyzja cudza, bez ograniczenia albo nieistniejąca → ten sam NOT_FOUND.
  if not found or v_dec.decision = 'no_action' or not exists (
       select 1 from public.company_members cm
        where cm.company_id = v_dec.company_id and cm.profile_id = v_uid
          and cm.is_active = true and cm.role in ('owner', 'admin')) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_state := public.moderation_appealable(p_decision_id);
  if v_state = 'APPEAL_EXISTS' then raise exception 'APPEAL_EXISTS' using errcode = '23505'; end if;
  if v_state = 'APPEAL_WINDOW_CLOSED' then raise exception 'APPEAL_WINDOW_CLOSED' using errcode = '22023'; end if;
  if v_state = 'INVALID_TRANSITION' then raise exception 'INVALID_TRANSITION: decyzja cofnięta' using errcode = '22023'; end if;
  if v_state <> 'OK' then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  v_ref := public.moderation_appeal_reference(v_id);
  v_locale := public.resolve_recipient_locale(v_uid);
  insert into public.moderation_appeals(
    id, reference, decision_id, report_id, appellant_role, appellant_id, appellant_locale, grounds,
    idempotency_key, due_at)
  values (
    v_id, v_ref, p_decision_id, v_dec.report_id, 'author', v_uid, v_locale, v_grounds,
    p_idempotency_key, now() + public.dsa_appeal_review_period());

  insert into public.report_events(report_id, event_type, actor_id, decision_id)
    values (v_dec.report_id, 'appeal_submitted', v_uid, p_decision_id);
  perform public.write_audit('moderation.appeal_submitted', 'report', v_dec.report_id, null,
    jsonb_build_object('appealId', v_id, 'reference', v_ref, 'decisionId', p_decision_id,
                       'appellantRole', 'author'));

  perform public.enqueue_email(v_uid, 'appealReceived', 'moderation_appeal', v_id,
    'appeal-received-' || v_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'appealReference', v_ref, 'decisionReference', v_dec.reference, 'appellantRole', 'author',
      'companyName', (select c.name from public.companies c where c.id = v_dec.company_id))));

  return query select v_id, v_ref, true;
end $$;
revoke all on function public.submit_moderation_appeal(uuid, uuid, text) from public, anon;
grant execute on function public.submit_moderation_appeal(uuid, uuid, text) to authenticated;

-- --- 6. Odwołanie zgłaszającego (numer sprawy + kod dostępu; service_role) ----------------
create or replace function public.submit_report_appeal(
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

  -- Zgłaszający odwołuje się wyłącznie od decyzji o braku działań w swojej sprawie.
  if v_report.decision_id is null
     or (select d.decision from public.moderation_decisions d where d.id = v_report.decision_id) <> 'no_action' then
    raise exception 'INVALID_TRANSITION: od tej decyzji odwołanie nie przysługuje' using errcode = '22023';
  end if;
  v_state := public.moderation_appealable(v_report.decision_id);
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
    idempotency_key, due_at)
  values (
    v_id, v_ref, v_report.decision_id, v_report.id, 'reporter', v_profile, v_locale, v_grounds,
    p_idempotency_key, now() + public.dsa_appeal_review_period());

  insert into public.report_events(report_id, event_type, actor_id, decision_id)
    values (v_report.id, 'appeal_submitted', v_profile, v_report.decision_id);
  perform public.write_audit('moderation.appeal_submitted', 'report', v_report.id, null,
    jsonb_build_object('appealId', v_id, 'reference', v_ref, 'decisionId', v_report.decision_id,
                       'appellantRole', 'reporter'));

  perform public.enqueue_email_to_address(
    v_report.reporter_email::text, v_locale, v_profile, 'appealReceived', 'moderation_appeal', v_id,
    'appeal-received-' || v_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'appealReference', v_ref, 'caseNumber', v_report.case_number, 'appellantRole', 'reporter',
      'recipientName', v_report.reporter_name)));

  return query select v_id, v_ref, true;
end $$;
revoke all on function public.submit_report_appeal(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_report_appeal(text, text, uuid, text) to service_role;

-- --- 7. Rozpatrzenie odwołania (admin, inny niż autor decyzji, gdy to możliwe) -------------
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

  -- Ponowny przegląd przez innego człowieka niż autor decyzji — o ile jest inny administrator.
  v_same := v_dec.decided_by is not distinct from v_uid;
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
      'restorationId', v_rest, 'sameReviewer', v_same)));

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
        'recipientName', v_report.reporter_name)));
  end if;

  return v_appeal.id;
end $$;
revoke all on function public.admin_decide_appeal(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_decide_appeal(uuid, text, text, text, text, text, text) to authenticated;

-- --- 8. Odczyt: autor i zgłaszający ------------------------------------------------------
drop function if exists public.get_company_moderation_decisions(uuid);
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

create or replace function public.get_report_case(p_case_number text, p_access_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_report record;
  v_appeal record;
  v_first  uuid;
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
    where a.report_id = v_report.id and a.appellant_role = 'reporter';

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
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'type', e.event_type, 'toStatus', e.to_status, 'at', e.created_at) order by e.id)
        from public.report_events e
        where e.report_id = v_report.id and e.event_type in ('submitted', 'status_changed')), '[]'::jsonb));
end $$;
revoke all on function public.get_report_case(text, text) from public, anon, authenticated;
grant execute on function public.get_report_case(text, text) to service_role;

-- --- 9. Retencja ---------------------------------------------------------------------------
create table if not exists public.dsa_retention_runs (
  id         uuid primary key default gen_random_uuid(),
  run_at     timestamptz not null default now(),
  dry_run    boolean not null,
  summary    jsonb not null
);
alter table public.dsa_retention_runs enable row level security;
revoke all on public.dsa_retention_runs from public, anon, authenticated;
drop trigger if exists trg_dsa_retention_runs_append_only on public.dsa_retention_runs;
create trigger trg_dsa_retention_runs_append_only
  before update or delete on public.dsa_retention_runs
  for each row execute function public.report_events_append_only();

-- Sprawy zamknięte z datą końca drogi odwołania. `retention_start` = null → sprawa czeka
-- (odwołanie w toku albo termin odwołania jeszcze nie biegnie — strona nie została poinformowana).
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
                   when a.id is not null then a.decided_at          -- null, gdy odwołanie w toku
                   when mr.id is not null then mr.restored_at        -- ograniczenie cofnięte
                   else public.moderation_appeal_deadline(d.id)     -- null, gdy nie poinformowano
                 end as end_at
            from public.moderation_decisions d
            left join public.moderation_appeals a on a.decision_id = d.id
            left join public.moderation_restorations mr on mr.decision_id = d.id
           where d.report_id = r.id
        ) x
    ) s
   where r.kind = 'dsa_notice' and r.redacted_at is null and r.status in ('resolved', 'dismissed');
$$;
revoke all on function public.dsa_retention_cases() from public, anon, authenticated;
grant execute on function public.dsa_retention_cases() to service_role;

-- Podgląd (bez zapisu): ile spraw i powiązanych rekordów zanonimizowałby przebieg teraz.
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

create or replace function public.dsa_retention_run(p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_summary   jsonb := public.dsa_retention_report();
  v_reports   uuid[];
  v_decisions uuid[];
  v_appeals   uuid[];
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
       or (entity_type = 'moderation_appeal' and entity_id = any(v_appeals)));
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

-- --- 10. Raport przejrzystości (agregaty, bez danych osobowych) ---------------------------
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

-- Wiersz na decyzję — do ewentualnego przekazania do bazy DSA. Bez faktów (wolny tekst mógłby
-- zawierać dane osobowe), bez tożsamości stron i moderatora. Zakres do zatwierdzenia w #40.
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
      left join public.moderation_appeals a on a.decision_id = d.id
     where d.decided_at >= p_from and d.decided_at < p_to
     order by d.decided_at, d.reference;
end $$;
revoke all on function public.dsa_statements_export(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.dsa_statements_export(timestamptz, timestamptz) to service_role;
