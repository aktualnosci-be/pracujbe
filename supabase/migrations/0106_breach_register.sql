-- =============================================================================
-- 0106_breach_register.sql — #490: rejestr incydentów bezpieczeństwa i naruszeń ochrony
-- danych osobowych (RODO art. 33 ust. 5) w panelu administratora.
--
-- Numer migracji tymczasowy — ostateczny nada koordynator.
--
-- 1. breach_incidents — wpis rejestru: rodzaj (incydent bezpieczeństwa albo naruszenie
--    danych osobowych), czas stwierdzenia (od niego liczy się 72 h), opis, kategorie danych,
--    liczba osób, ocena ryzyka z uzasadnieniem, decyzja o zgłoszeniu do organu (art. 33)
--    i o zawiadomieniu osób (art. 34) z uzasadnieniem, daty zgłoszeń, działania, zamknięcie.
--    Spójność decyzji egzekwują CHECK-i (backstop) i funkcja breach_incident_validate
--    (kod pola w błędzie). Wersja wiersza (`version`) = CAS przy edycji (STALE_STATE).
-- 2. breach_incident_events — niezmienna historia zmian (pole: przed/po). Trigger
--    odrzuca UPDATE/DELETE dla KAŻDEJ roli; wpisu rejestru też nie da się usunąć.
-- 3. breach_notices + breach_notice_recipients — zawiadomienie dotkniętych osób przez
--    outbox (`enqueue_email`, szablon `breachNotice`). Treść wpisuje administrator dla
--    każdego języka odbiorców; język wiadomości = resolve_recipient_locale (Invariant #1).
--    Brak treści w języku któregoś odbiorcy → nic nie jest kolejkowane.
-- 4. RPC administratora (is_admin(), SECURITY DEFINER, audyt w audit_logs bez treści opisu):
--    admin_create_breach_incident (idempotentne po p_client_key),
--    admin_update_breach_incident, admin_close_breach_incident, admin_reopen_breach_incident,
--    admin_export_breach_incident (odczyt do eksportu + wpis w historii),
--    admin_notify_breach_subjects (idempotentne po p_client_key).
--
-- Dostęp: RLS włączone i wymuszone, bez polityk; anon/authenticated bez grantów na tabele.
-- Panel czyta service-rolem po potwierdzeniu roli admina (`src/lib/data/breaches.ts`).
-- Rejestr nie przechowuje treści CV ani kopii danych osób — pola opisowe mają limity,
-- a interfejs prosi o opis zakresu zamiast kopiowania danych.
--
-- Rollback: drop funkcji admin_*_breach_*, breach_incident_validate, breach_parse_ts,
-- breach_incident_protect, breach_event_immutable, breach_write_event; drop tabel
-- breach_notice_recipients, breach_notices, breach_incident_events, breach_incidents.
-- Migracja nie zmienia istniejących danych.
-- =============================================================================

-- --- 1. Rejestr ----------------------------------------------------------------------
create table if not exists public.breach_incidents (
  id                         uuid primary key default gen_random_uuid(),
  reference                  text not null unique,
  client_key                 uuid not null unique,
  kind                       text not null default 'personal_data_breach',
  title                      text not null,
  description                text not null,
  detected_at                timestamptz not null,
  occurred_at                timestamptz,
  data_categories            text[] not null default '{}',
  affected_count             integer,
  affected_count_estimated   boolean not null default true,
  risk_level                 text not null default 'not_assessed',
  risk_assessment            text not null default '',
  authority_decision         text not null default 'pending',
  authority_decision_reason  text not null default '',
  authority_notified_at      timestamptz,
  authority_reference        text not null default '',
  authority_delay_reason     text not null default '',
  subjects_decision          text not null default 'pending',
  subjects_decision_reason   text not null default '',
  subjects_notified_at       timestamptz,
  actions_taken              text not null default '',
  status                     text not null default 'open',
  closed_at                  timestamptz,
  closure_summary            text not null default '',
  version                    integer not null default 1,
  created_by                 uuid references public.profiles(id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint breach_kind check (kind in ('security_incident', 'personal_data_breach')),
  constraint breach_title_len check (char_length(btrim(title)) between 1 and 200),
  constraint breach_description_len check (char_length(btrim(description)) between 1 and 5000),
  constraint breach_occurred_before_detected check (occurred_at is null or occurred_at <= detected_at),
  constraint breach_categories check (
    data_categories <@ array['identity', 'contact', 'cv_files', 'applications', 'messages',
      'account_credentials', 'location', 'special_category', 'other']::text[]
    and cardinality(data_categories) <= 9),
  constraint breach_affected_count check (affected_count is null or affected_count between 0 and 100000000),
  constraint breach_risk_level check (risk_level in ('not_assessed', 'no_risk', 'risk', 'high_risk')),
  constraint breach_risk_assessment check (
    char_length(risk_assessment) <= 5000
    and (risk_level = 'not_assessed' or char_length(btrim(risk_assessment)) > 0)),
  constraint breach_authority_decision check (authority_decision in ('pending', 'notify', 'not_required')),
  constraint breach_authority_reason check (
    char_length(authority_decision_reason) <= 2000
    and (authority_decision = 'pending' or char_length(btrim(authority_decision_reason)) > 0)),
  -- Art. 33: prawdopodobne ryzyko → zgłoszenie (bez „nie wymaga zgłoszenia”).
  constraint breach_authority_vs_risk check (
    not (risk_level in ('risk', 'high_risk') and authority_decision = 'not_required')),
  constraint breach_authority_notified check (
    authority_notified_at is null
    or (authority_decision = 'notify' and authority_notified_at >= detected_at)),
  constraint breach_authority_reference_len check (char_length(authority_reference) <= 200),
  -- Zgłoszenie po 72 h od stwierdzenia wymaga podania przyczyn opóźnienia (art. 33 ust. 1).
  constraint breach_authority_delay check (
    char_length(authority_delay_reason) <= 2000
    and (authority_notified_at is null
         or authority_notified_at <= detected_at + interval '72 hours'
         or char_length(btrim(authority_delay_reason)) > 0)),
  constraint breach_subjects_decision check (
    subjects_decision in ('pending', 'notify', 'not_required', 'exception')),
  constraint breach_subjects_reason check (
    char_length(subjects_decision_reason) <= 2000
    and (subjects_decision = 'pending' or char_length(btrim(subjects_decision_reason)) > 0)),
  -- Art. 34: wysokie ryzyko → zawiadomienie osób albo udokumentowany wyjątek.
  constraint breach_subjects_vs_risk check (
    not (risk_level = 'high_risk' and subjects_decision = 'not_required')),
  constraint breach_subjects_notified check (
    subjects_notified_at is null
    or (subjects_decision = 'notify' and subjects_notified_at >= detected_at)),
  constraint breach_actions_len check (char_length(actions_taken) <= 5000),
  constraint breach_status check (status in ('open', 'closed')),
  constraint breach_closure check (
    char_length(closure_summary) <= 2000
    and ((status = 'open' and closed_at is null)
         or (status = 'closed' and closed_at is not null and char_length(btrim(closure_summary)) > 0))),
  constraint breach_version check (version >= 1)
);

create index if not exists idx_breach_incidents_created
  on public.breach_incidents (created_at desc, id desc);
create index if not exists idx_breach_incidents_status
  on public.breach_incidents (status, created_at desc, id desc);

alter table public.breach_incidents enable row level security;
alter table public.breach_incidents force row level security;
revoke all on public.breach_incidents from public, anon, authenticated;

-- --- 2. Niezmienna historia ------------------------------------------------------------
create table if not exists public.breach_incident_events (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.breach_incidents(id) on delete restrict,
  version     integer not null,
  event_type  text not null,
  actor_id    uuid references public.profiles(id) on delete set null,
  changes     jsonb not null default '{}'::jsonb,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  constraint breach_event_type check (event_type in (
    'created', 'updated', 'closed', 'reopened', 'subjects_notified', 'exported')),
  constraint breach_event_note_len check (char_length(note) <= 2000)
);
create index if not exists idx_breach_events_incident
  on public.breach_incident_events (incident_id, created_at, id);

alter table public.breach_incident_events enable row level security;
alter table public.breach_incident_events force row level security;
revoke all on public.breach_incident_events from public, anon, authenticated;

-- Jedyny dozwolony UPDATE: wyzerowanie autora przez FK `on delete set null` po usunięciu
-- konta (reszta wiersza bez zmian) — inaczej usunięcie konta admina byłoby niemożliwe.
create or replace function public.breach_event_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_col text := case tg_table_name when 'breach_incident_events' then 'actor_id' else 'created_by' end;
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(old) ->> v_col) is not null
     and (to_jsonb(new) ->> v_col) is null
     and (to_jsonb(new) - v_col) = (to_jsonb(old) - v_col) then
    return new;
  end if;
  raise exception 'BREACH_HISTORY_IMMUTABLE' using errcode = '42501';
end $$;
revoke all on function public.breach_event_immutable() from public;

drop trigger if exists trg_breach_events_immutable on public.breach_incident_events;
create trigger trg_breach_events_immutable
  before update or delete on public.breach_incident_events
  for each row execute function public.breach_event_immutable();
drop trigger if exists trg_breach_events_no_truncate on public.breach_incident_events;
create trigger trg_breach_events_no_truncate
  before truncate on public.breach_incident_events
  for each statement execute function public.breach_event_immutable();

-- Wpis rejestru: bez usuwania; numer, klucz, autor i data utworzenia bez zmian
-- (autor może tylko zniknąć — FK `on delete set null` przy usunięciu konta).
create or replace function public.breach_incident_protect()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'BREACH_REGISTER_NO_DELETE' using errcode = '42501';
  end if;
  if new.reference is distinct from old.reference
     or new.client_key is distinct from old.client_key
     or (new.created_by is distinct from old.created_by and new.created_by is not null)
     or new.created_at is distinct from old.created_at then
    raise exception 'BREACH_REGISTER_IMMUTABLE_FIELD' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.breach_incident_protect() from public;

drop trigger if exists trg_breach_incident_protect on public.breach_incidents;
create trigger trg_breach_incident_protect
  before update or delete on public.breach_incidents
  for each row execute function public.breach_incident_protect();
drop trigger if exists trg_breach_incidents_no_truncate on public.breach_incidents;
create trigger trg_breach_incidents_no_truncate
  before truncate on public.breach_incidents
  for each statement execute function public.breach_event_immutable();

-- --- 3. Zawiadomienia osób ---------------------------------------------------------------
create table if not exists public.breach_notices (
  id              uuid primary key default gen_random_uuid(),
  incident_id     uuid not null references public.breach_incidents(id) on delete restrict,
  client_key      uuid not null unique,
  content         jsonb not null,
  recipient_count integer not null,
  queued_count    integer not null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint breach_notice_counts check (recipient_count >= 0 and queued_count between 0 and recipient_count)
);
create index if not exists idx_breach_notices_incident
  on public.breach_notices (incident_id, created_at desc);

create table if not exists public.breach_notice_recipients (
  notice_id  uuid not null references public.breach_notices(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  locale     text not null,
  queued     boolean not null,
  primary key (notice_id, profile_id)
);

alter table public.breach_notices enable row level security;
alter table public.breach_notices force row level security;
revoke all on public.breach_notices from public, anon, authenticated;
alter table public.breach_notice_recipients enable row level security;
alter table public.breach_notice_recipients force row level security;
revoke all on public.breach_notice_recipients from public, anon, authenticated;

drop trigger if exists trg_breach_notices_immutable on public.breach_notices;
create trigger trg_breach_notices_immutable
  before update or delete on public.breach_notices
  for each row execute function public.breach_event_immutable();

-- --- 4. Walidacja i pomocnicze -------------------------------------------------------------
-- Błędy: 'VALIDATION_FAILED: <pole>:<kod>' — Server Action mapuje je na błąd przy polu.
create or replace function public.breach_parse_ts(p_value text, p_field text)
returns timestamptz language plpgsql stable set search_path = public, pg_temp as $$
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  return p_value::timestamptz;
exception when others then
  raise exception 'VALIDATION_FAILED: %:invalid', p_field using errcode = '22023';
end $$;
revoke all on function public.breach_parse_ts(text, text) from public;

create or replace function public.breach_incident_validate(r public.breach_incidents)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_future timestamptz := now() + interval '5 minutes';
begin
  if r.kind is null or r.kind not in ('security_incident', 'personal_data_breach') then
    raise exception 'VALIDATION_FAILED: kind:invalid' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(r.title, ''))) = 0 then
    raise exception 'VALIDATION_FAILED: title:required' using errcode = '22023'; end if;
  if char_length(r.title) > 200 then
    raise exception 'VALIDATION_FAILED: title:tooLong' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(r.description, ''))) = 0 then
    raise exception 'VALIDATION_FAILED: description:required' using errcode = '22023'; end if;
  if char_length(r.description) > 5000 then
    raise exception 'VALIDATION_FAILED: description:tooLong' using errcode = '22023'; end if;
  if r.detected_at is null then
    raise exception 'VALIDATION_FAILED: detectedAt:required' using errcode = '22023'; end if;
  if r.detected_at > v_future then
    raise exception 'VALIDATION_FAILED: detectedAt:future' using errcode = '22023'; end if;
  if r.occurred_at is not null and r.occurred_at > r.detected_at then
    raise exception 'VALIDATION_FAILED: occurredAt:afterDetected' using errcode = '22023'; end if;
  if not (r.data_categories <@ array['identity', 'contact', 'cv_files', 'applications', 'messages',
      'account_credentials', 'location', 'special_category', 'other']::text[]) then
    raise exception 'VALIDATION_FAILED: dataCategories:invalid' using errcode = '22023'; end if;
  if r.affected_count is not null and r.affected_count not between 0 and 100000000 then
    raise exception 'VALIDATION_FAILED: affectedCount:invalid' using errcode = '22023'; end if;
  if r.risk_level not in ('not_assessed', 'no_risk', 'risk', 'high_risk') then
    raise exception 'VALIDATION_FAILED: riskLevel:invalid' using errcode = '22023'; end if;
  if char_length(r.risk_assessment) > 5000 then
    raise exception 'VALIDATION_FAILED: riskAssessment:tooLong' using errcode = '22023'; end if;
  if r.risk_level <> 'not_assessed' and char_length(btrim(r.risk_assessment)) = 0 then
    raise exception 'VALIDATION_FAILED: riskAssessment:required' using errcode = '22023'; end if;

  if r.authority_decision not in ('pending', 'notify', 'not_required') then
    raise exception 'VALIDATION_FAILED: authorityDecision:invalid' using errcode = '22023'; end if;
  if r.risk_level in ('risk', 'high_risk') and r.authority_decision = 'not_required' then
    raise exception 'VALIDATION_FAILED: authorityDecision:conflictsWithRisk' using errcode = '22023'; end if;
  if char_length(r.authority_decision_reason) > 2000 then
    raise exception 'VALIDATION_FAILED: authorityDecisionReason:tooLong' using errcode = '22023'; end if;
  if r.authority_decision <> 'pending' and char_length(btrim(r.authority_decision_reason)) = 0 then
    raise exception 'VALIDATION_FAILED: authorityDecisionReason:required' using errcode = '22023'; end if;
  if r.authority_notified_at is not null then
    if r.authority_decision <> 'notify' then
      raise exception 'VALIDATION_FAILED: authorityNotifiedAt:decisionMismatch' using errcode = '22023'; end if;
    if r.authority_notified_at < r.detected_at then
      raise exception 'VALIDATION_FAILED: authorityNotifiedAt:beforeDetected' using errcode = '22023'; end if;
    if r.authority_notified_at > v_future then
      raise exception 'VALIDATION_FAILED: authorityNotifiedAt:future' using errcode = '22023'; end if;
  end if;
  if char_length(r.authority_reference) > 200 then
    raise exception 'VALIDATION_FAILED: authorityReference:tooLong' using errcode = '22023'; end if;
  if char_length(r.authority_delay_reason) > 2000 then
    raise exception 'VALIDATION_FAILED: authorityDelayReason:tooLong' using errcode = '22023'; end if;
  if r.authority_notified_at > r.detected_at + interval '72 hours'
     and char_length(btrim(r.authority_delay_reason)) = 0 then
    raise exception 'VALIDATION_FAILED: authorityDelayReason:required' using errcode = '22023'; end if;

  if r.subjects_decision not in ('pending', 'notify', 'not_required', 'exception') then
    raise exception 'VALIDATION_FAILED: subjectsDecision:invalid' using errcode = '22023'; end if;
  if r.risk_level = 'high_risk' and r.subjects_decision = 'not_required' then
    raise exception 'VALIDATION_FAILED: subjectsDecision:conflictsWithRisk' using errcode = '22023'; end if;
  if char_length(r.subjects_decision_reason) > 2000 then
    raise exception 'VALIDATION_FAILED: subjectsDecisionReason:tooLong' using errcode = '22023'; end if;
  if r.subjects_decision <> 'pending' and char_length(btrim(r.subjects_decision_reason)) = 0 then
    raise exception 'VALIDATION_FAILED: subjectsDecisionReason:required' using errcode = '22023'; end if;
  if r.subjects_notified_at is not null then
    if r.subjects_decision <> 'notify' then
      raise exception 'VALIDATION_FAILED: subjectsNotifiedAt:decisionMismatch' using errcode = '22023'; end if;
    if r.subjects_notified_at < r.detected_at then
      raise exception 'VALIDATION_FAILED: subjectsNotifiedAt:beforeDetected' using errcode = '22023'; end if;
    if r.subjects_notified_at > v_future then
      raise exception 'VALIDATION_FAILED: subjectsNotifiedAt:future' using errcode = '22023'; end if;
  end if;
  if char_length(r.actions_taken) > 5000 then
    raise exception 'VALIDATION_FAILED: actionsTaken:tooLong' using errcode = '22023'; end if;
end $$;
revoke all on function public.breach_incident_validate(public.breach_incidents) from public;

-- Nakłada pola formularza (p_data, klucze camelCase) na wiersz. Brak klucza = wartość domyślna
-- formularza — formularz zawsze wysyła komplet pól.
create or replace function public.breach_apply_form(r public.breach_incidents, p_data jsonb)
returns public.breach_incidents language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_count text := nullif(btrim(coalesce(p_data->>'affectedCount', '')), '');
  v_categories text[];
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'VALIDATION_FAILED: form:invalid' using errcode = '22023';
  end if;
  if p_data ? 'dataCategories' and jsonb_typeof(p_data->'dataCategories') <> 'array' then
    raise exception 'VALIDATION_FAILED: dataCategories:invalid' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct c order by c), '{}') into v_categories
    from jsonb_array_elements_text(coalesce(p_data->'dataCategories', '[]'::jsonb)) as c;

  r.kind := coalesce(p_data->>'kind', 'personal_data_breach');
  r.title := btrim(coalesce(p_data->>'title', ''));
  r.description := btrim(coalesce(p_data->>'description', ''));
  r.detected_at := public.breach_parse_ts(p_data->>'detectedAt', 'detectedAt');
  r.occurred_at := public.breach_parse_ts(p_data->>'occurredAt', 'occurredAt');
  r.data_categories := v_categories;
  if v_count is null then
    r.affected_count := null;
  elsif v_count ~ '^[0-9]{1,9}$' then
    r.affected_count := v_count::integer;
  else
    raise exception 'VALIDATION_FAILED: affectedCount:invalid' using errcode = '22023';
  end if;
  r.affected_count_estimated := coalesce((p_data->>'affectedCountEstimated')::boolean, true);
  r.risk_level := coalesce(p_data->>'riskLevel', 'not_assessed');
  r.risk_assessment := btrim(coalesce(p_data->>'riskAssessment', ''));
  r.authority_decision := coalesce(p_data->>'authorityDecision', 'pending');
  r.authority_decision_reason := btrim(coalesce(p_data->>'authorityDecisionReason', ''));
  r.authority_notified_at := public.breach_parse_ts(p_data->>'authorityNotifiedAt', 'authorityNotifiedAt');
  r.authority_reference := btrim(coalesce(p_data->>'authorityReference', ''));
  r.authority_delay_reason := btrim(coalesce(p_data->>'authorityDelayReason', ''));
  r.subjects_decision := coalesce(p_data->>'subjectsDecision', 'pending');
  r.subjects_decision_reason := btrim(coalesce(p_data->>'subjectsDecisionReason', ''));
  r.subjects_notified_at := public.breach_parse_ts(p_data->>'subjectsNotifiedAt', 'subjectsNotifiedAt');
  r.actions_taken := btrim(coalesce(p_data->>'actionsTaken', ''));
  return r;
exception
  when invalid_text_representation then
    raise exception 'VALIDATION_FAILED: form:invalid' using errcode = '22023';
end $$;
revoke all on function public.breach_apply_form(public.breach_incidents, jsonb) from public;

-- Pola edytowalne (kolumny) — historia zapisuje różnice tylko dla nich.
create or replace function public.breach_editable_fields()
returns text[] language sql immutable set search_path = public, pg_temp as $$
  select array['kind', 'title', 'description', 'detected_at', 'occurred_at', 'data_categories',
    'affected_count', 'affected_count_estimated', 'risk_level', 'risk_assessment',
    'authority_decision', 'authority_decision_reason', 'authority_notified_at',
    'authority_reference', 'authority_delay_reason', 'subjects_decision',
    'subjects_decision_reason', 'subjects_notified_at', 'actions_taken']::text[];
$$;
revoke all on function public.breach_editable_fields() from public;

create or replace function public.breach_diff(p_old public.breach_incidents, p_new public.breach_incidents)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(f, jsonb_build_object('from', o -> f, 'to', n -> f)), '{}'::jsonb)
    from unnest(public.breach_editable_fields()) as f,
         lateral (select to_jsonb(p_old) as o, to_jsonb(p_new) as n) j
   where (o -> f) is distinct from (n -> f);
$$;
revoke all on function public.breach_diff(public.breach_incidents, public.breach_incidents) from public;

create or replace function public.breach_require_admin()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
end $$;
revoke all on function public.breach_require_admin() from public;

-- --- 5. RPC administratora -------------------------------------------------------------------
create or replace function public.admin_create_breach_incident(p_client_key uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.breach_incidents;
  v_existing uuid;
begin
  perform public.breach_require_admin();
  if p_client_key is null then
    raise exception 'VALIDATION_FAILED: form:invalid' using errcode = '22023';
  end if;
  -- Podwójne kliknięcie / ponowienie: ten sam klucz = ten sam wpis.
  select id into v_existing from public.breach_incidents where client_key = p_client_key;
  if found then return v_existing; end if;

  v_row.id := gen_random_uuid();
  v_row := public.breach_apply_form(v_row, p_data);
  perform public.breach_incident_validate(v_row);

  insert into public.breach_incidents (
    id, reference, client_key, kind, title, description, detected_at, occurred_at,
    data_categories, affected_count, affected_count_estimated, risk_level, risk_assessment,
    authority_decision, authority_decision_reason, authority_notified_at, authority_reference,
    authority_delay_reason, subjects_decision, subjects_decision_reason, subjects_notified_at,
    actions_taken, created_by)
  values (
    v_row.id,
    'NAR-' || to_char(now() at time zone 'Europe/Brussels', 'YYYY') || '-'
      || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    p_client_key, v_row.kind, v_row.title, v_row.description, v_row.detected_at, v_row.occurred_at,
    v_row.data_categories, v_row.affected_count, v_row.affected_count_estimated, v_row.risk_level,
    v_row.risk_assessment, v_row.authority_decision, v_row.authority_decision_reason,
    v_row.authority_notified_at, v_row.authority_reference, v_row.authority_delay_reason,
    v_row.subjects_decision, v_row.subjects_decision_reason, v_row.subjects_notified_at,
    v_row.actions_taken, auth.uid())
  on conflict (client_key) do nothing;
  if not found then
    -- Równoległe ponowienie z tym samym kluczem wygrało wyścig.
    select id into v_existing from public.breach_incidents where client_key = p_client_key;
    return v_existing;
  end if;

  insert into public.breach_incident_events (incident_id, version, event_type, actor_id, changes)
  values (v_row.id, 1, 'created', auth.uid(),
          public.breach_diff((null::public.breach_incidents), v_row));
  perform public.write_audit('breach.created', 'breach_incident', v_row.id, null,
    jsonb_build_object('status', 'open', 'kind', v_row.kind, 'version', 1));
  return v_row.id;
end $$;
revoke all on function public.admin_create_breach_incident(uuid, jsonb) from public;
grant execute on function public.admin_create_breach_incident(uuid, jsonb) to authenticated;

create or replace function public.admin_update_breach_incident(
  p_id uuid, p_expected_version integer, p_data jsonb
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old public.breach_incidents;
  v_new public.breach_incidents;
  v_changes jsonb;
begin
  perform public.breach_require_admin();
  select * into v_old from public.breach_incidents where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_old.version <> coalesce(p_expected_version, -1) then
    raise exception 'STALE_STATE: wpis zmieniono w międzyczasie';
  end if;
  if v_old.status = 'closed' then raise exception 'BREACH_CLOSED' using errcode = '22023'; end if;

  v_new := public.breach_apply_form(v_old, p_data);
  perform public.breach_incident_validate(v_new);
  v_changes := public.breach_diff(v_old, v_new);
  if v_changes = '{}'::jsonb then return v_old.version; end if;

  update public.breach_incidents
     set kind = v_new.kind, title = v_new.title, description = v_new.description,
         detected_at = v_new.detected_at, occurred_at = v_new.occurred_at,
         data_categories = v_new.data_categories, affected_count = v_new.affected_count,
         affected_count_estimated = v_new.affected_count_estimated, risk_level = v_new.risk_level,
         risk_assessment = v_new.risk_assessment, authority_decision = v_new.authority_decision,
         authority_decision_reason = v_new.authority_decision_reason,
         authority_notified_at = v_new.authority_notified_at,
         authority_reference = v_new.authority_reference,
         authority_delay_reason = v_new.authority_delay_reason,
         subjects_decision = v_new.subjects_decision,
         subjects_decision_reason = v_new.subjects_decision_reason,
         subjects_notified_at = v_new.subjects_notified_at, actions_taken = v_new.actions_taken,
         version = v_old.version + 1, updated_at = now()
   where id = p_id;

  insert into public.breach_incident_events (incident_id, version, event_type, actor_id, changes)
  values (p_id, v_old.version + 1, 'updated', auth.uid(), v_changes);
  -- Dziennik: tylko nazwy zmienionych pól (bez treści opisów).
  perform public.write_audit('breach.updated', 'breach_incident', p_id,
    jsonb_build_object('status', v_old.status, 'version', v_old.version),
    jsonb_build_object('status', v_old.status, 'version', v_old.version + 1,
      'fields', (select jsonb_agg(k order by k) from jsonb_object_keys(v_changes) k)));
  return v_old.version + 1;
end $$;
revoke all on function public.admin_update_breach_incident(uuid, integer, jsonb) from public;
grant execute on function public.admin_update_breach_incident(uuid, integer, jsonb) to authenticated;

create or replace function public.admin_close_breach_incident(
  p_id uuid, p_expected_version integer, p_summary text
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.breach_incidents;
  v_summary text := btrim(coalesce(p_summary, ''));
begin
  perform public.breach_require_admin();
  if char_length(v_summary) = 0 then
    raise exception 'VALIDATION_FAILED: closureSummary:required' using errcode = '22023'; end if;
  if char_length(v_summary) > 2000 then
    raise exception 'VALIDATION_FAILED: closureSummary:tooLong' using errcode = '22023'; end if;

  select * into v_row from public.breach_incidents where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.version <> coalesce(p_expected_version, -1) then
    raise exception 'STALE_STATE: wpis zmieniono w międzyczasie';
  end if;
  if v_row.status = 'closed' then raise exception 'BREACH_CLOSED' using errcode = '22023'; end if;

  -- Naruszenie danych osobowych zamyka się dopiero po udokumentowaniu oceny i decyzji.
  if v_row.kind = 'personal_data_breach' then
    if v_row.risk_level = 'not_assessed' then
      raise exception 'BREACH_NOT_READY: riskLevel' using errcode = '22023'; end if;
    if v_row.authority_decision = 'pending' then
      raise exception 'BREACH_NOT_READY: authorityDecision' using errcode = '22023'; end if;
    if v_row.authority_decision = 'notify' and v_row.authority_notified_at is null then
      raise exception 'BREACH_NOT_READY: authorityNotifiedAt' using errcode = '22023'; end if;
    if v_row.risk_level = 'high_risk' and v_row.subjects_decision = 'pending' then
      raise exception 'BREACH_NOT_READY: subjectsDecision' using errcode = '22023'; end if;
    if v_row.subjects_decision = 'notify' and v_row.subjects_notified_at is null then
      raise exception 'BREACH_NOT_READY: subjectsNotifiedAt' using errcode = '22023'; end if;
  end if;

  update public.breach_incidents
     set status = 'closed', closed_at = now(), closure_summary = v_summary,
         version = v_row.version + 1, updated_at = now()
   where id = p_id;
  insert into public.breach_incident_events (incident_id, version, event_type, actor_id, note)
  values (p_id, v_row.version + 1, 'closed', auth.uid(), v_summary);
  perform public.write_audit('breach.closed', 'breach_incident', p_id,
    jsonb_build_object('status', 'open', 'version', v_row.version),
    jsonb_build_object('status', 'closed', 'version', v_row.version + 1));
  return v_row.version + 1;
end $$;
revoke all on function public.admin_close_breach_incident(uuid, integer, text) from public;
grant execute on function public.admin_close_breach_incident(uuid, integer, text) to authenticated;

create or replace function public.admin_reopen_breach_incident(
  p_id uuid, p_expected_version integer, p_reason text
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.breach_incidents;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.breach_require_admin();
  if char_length(v_reason) = 0 then
    raise exception 'VALIDATION_FAILED: reason:required' using errcode = '22023'; end if;
  if char_length(v_reason) > 2000 then
    raise exception 'VALIDATION_FAILED: reason:tooLong' using errcode = '22023'; end if;

  select * into v_row from public.breach_incidents where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.version <> coalesce(p_expected_version, -1) then
    raise exception 'STALE_STATE: wpis zmieniono w międzyczasie';
  end if;
  if v_row.status <> 'closed' then raise exception 'STALE_STATE: wpis jest otwarty'; end if;

  -- Podsumowanie zamknięcia zostaje w historii (zdarzenie 'closed').
  update public.breach_incidents
     set status = 'open', closed_at = null, closure_summary = '',
         version = v_row.version + 1, updated_at = now()
   where id = p_id;
  insert into public.breach_incident_events (incident_id, version, event_type, actor_id, note)
  values (p_id, v_row.version + 1, 'reopened', auth.uid(), v_reason);
  perform public.write_audit('breach.reopened', 'breach_incident', p_id,
    jsonb_build_object('status', 'closed', 'version', v_row.version),
    jsonb_build_object('status', 'open', 'version', v_row.version + 1, 'reason', v_reason));
  return v_row.version + 1;
end $$;
revoke all on function public.admin_reopen_breach_incident(uuid, integer, text) from public;
grant execute on function public.admin_reopen_breach_incident(uuid, integer, text) to authenticated;

-- Eksport do zgłoszenia: wpis + historia + zawiadomienia (bez adresów odbiorców). Każdy
-- eksport zostaje w historii i w dzienniku zdarzeń.
create or replace function public.admin_export_breach_incident(p_id uuid, p_format text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.breach_incidents;
  v_out jsonb;
begin
  perform public.breach_require_admin();
  if p_format is null or p_format not in ('json', 'csv') then
    raise exception 'VALIDATION_FAILED: format:invalid' using errcode = '22023'; end if;
  select * into v_row from public.breach_incidents where id = p_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  select jsonb_build_object(
    'incident', to_jsonb(v_row) - 'client_key' - 'created_by',
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'version', e.version, 'eventType', e.event_type, 'changes', e.changes,
               'note', e.note, 'createdAt', e.created_at,
               'actor', nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''))
             order by e.created_at, e.id)
        from public.breach_incident_events e
        left join public.profiles p on p.id = e.actor_id
       where e.incident_id = p_id), '[]'::jsonb),
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'createdAt', n.created_at, 'recipientCount', n.recipient_count,
               'queuedCount', n.queued_count,
               'locales', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(n.content) k))
             order by n.created_at)
        from public.breach_notices n where n.incident_id = p_id), '[]'::jsonb),
    'exportedAt', now())
  into v_out;

  insert into public.breach_incident_events (incident_id, version, event_type, actor_id, changes)
  values (p_id, v_row.version, 'exported', auth.uid(), jsonb_build_object('format', p_format));
  perform public.write_audit('breach.exported', 'breach_incident', p_id, null,
    jsonb_build_object('status', v_row.status, 'format', p_format));

  return v_out;
end $$;
revoke all on function public.admin_export_breach_incident(uuid, text) from public;
grant execute on function public.admin_export_breach_incident(uuid, text) to authenticated;

-- Zawiadomienie dotkniętych osób. p_recipients: UUID konta albo adres e-mail (jeden na
-- pozycję, najwyżej 5000). p_content: {"<locale>": {"subject": ..., "body": ...}}.
-- Zwraca {status:'invalid', unknown:[...], missingLocales:[...]} bez zapisu albo
-- {status:'queued', noticeId, recipients, queued} (ponowienie z tym samym kluczem zwraca
-- ten sam wynik bez ponownego kolejkowania).
create or replace function public.admin_notify_breach_subjects(
  p_id uuid, p_client_key uuid, p_recipients text[], p_content jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.breach_incidents;
  v_notice public.breach_notices;
  v_unknown text[];
  v_missing text[];
  v_locale text;
  v_subject text;
  v_body text;
  v_notice_id uuid := gen_random_uuid();
  v_rec record;
  v_total integer;
  v_queued integer := 0;
  v_key text;
begin
  perform public.breach_require_admin();
  if p_client_key is null then
    raise exception 'VALIDATION_FAILED: form:invalid' using errcode = '22023'; end if;

  -- Blokada wpisu najpierw: równoległe ponowienie z tym samym kluczem czeka i widzi wynik.
  select * into v_row from public.breach_incidents where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_notice from public.breach_notices where client_key = p_client_key;
  if found then
    if v_notice.incident_id <> p_id then
      raise exception 'VALIDATION_FAILED: form:invalid' using errcode = '22023'; end if;
    return jsonb_build_object('status', 'queued', 'noticeId', v_notice.id,
      'recipients', v_notice.recipient_count, 'queued', v_notice.queued_count);
  end if;
  if v_row.status <> 'open' then raise exception 'BREACH_CLOSED' using errcode = '22023'; end if;
  if v_row.kind <> 'personal_data_breach' or v_row.subjects_decision <> 'notify' then
    raise exception 'BREACH_NOTIFY_NOT_DECIDED' using errcode = '22023'; end if;

  if p_recipients is null or cardinality(p_recipients) = 0 then
    raise exception 'VALIDATION_FAILED: recipients:required' using errcode = '22023'; end if;
  if cardinality(p_recipients) > 5000 then
    raise exception 'VALIDATION_FAILED: recipients:tooMany' using errcode = '22023'; end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'VALIDATION_FAILED: content:invalid' using errcode = '22023'; end if;

  -- Treść: tylko obsługiwane języki, temat 1..200, treść 1..5000.
  for v_locale in select jsonb_object_keys(p_content) loop
    if public.is_supported_locale(v_locale) is not true then
      raise exception 'VALIDATION_FAILED: content:invalid' using errcode = '22023'; end if;
    v_subject := btrim(coalesce(p_content -> v_locale ->> 'subject', ''));
    v_body := btrim(coalesce(p_content -> v_locale ->> 'body', ''));
    if char_length(v_subject) not between 1 and 200 then
      raise exception 'VALIDATION_FAILED: subject_%:invalid', v_locale using errcode = '22023'; end if;
    if char_length(v_body) not between 1 and 5000 then
      raise exception 'VALIDATION_FAILED: body_%:invalid', v_locale using errcode = '22023'; end if;
  end loop;

  create temporary table if not exists pg_temp.breach_recipients (
    entry text, profile_id uuid, locale text, role text, queued boolean) on commit drop;
  truncate pg_temp.breach_recipients;
  insert into pg_temp.breach_recipients (entry, profile_id)
  select e.entry,
         case when e.entry ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (select p.id from public.profiles p
                     where p.id = e.entry::uuid and p.deleted_at is null)
              else (select p.id from auth.users u join public.profiles p on p.id = u.id
                     where lower(u.email) = lower(e.entry) and p.deleted_at is null
                     limit 1)
         end
    from (select distinct btrim(x) as entry from unnest(p_recipients) x
           where btrim(coalesce(x, '')) <> '') e;

  select coalesce(array_agg(entry order by entry), '{}') into v_unknown
    from pg_temp.breach_recipients where profile_id is null;

  update pg_temp.breach_recipients r
     set locale = public.resolve_recipient_locale(r.profile_id),
         role = (select p.role::text from public.profiles p where p.id = r.profile_id)
   where r.profile_id is not null;

  select coalesce(array_agg(distinct locale order by locale), '{}') into v_missing
    from pg_temp.breach_recipients
   where profile_id is not null and not (p_content ? locale);

  if cardinality(v_unknown) > 0 or cardinality(v_missing) > 0 then
    return jsonb_build_object('status', 'invalid',
      'unknown', to_jsonb(v_unknown[1:50]), 'unknownCount', cardinality(v_unknown),
      'missingLocales', to_jsonb(v_missing));
  end if;

  select count(distinct profile_id) into v_total from pg_temp.breach_recipients;
  if v_total = 0 then
    raise exception 'VALIDATION_FAILED: recipients:required' using errcode = '22023'; end if;

  for v_rec in select distinct on (profile_id) profile_id, locale, role
                 from pg_temp.breach_recipients where profile_id is not null
                order by profile_id loop
    v_key := 'breach:' || v_notice_id::text || ':' || v_rec.profile_id::text;
    -- Język wiadomości = język ODBIORCY (Invariant #1); enqueue_email wyznacza go tą samą
    -- funkcją, więc treść w payloadzie i kolumna locale są zgodne.
    perform public.enqueue_email(v_rec.profile_id, 'breachNotice', 'breach_incident', p_id, v_key,
      jsonb_build_object(
        'noticeSubject', btrim(p_content -> v_rec.locale ->> 'subject'),
        'noticeText', btrim(p_content -> v_rec.locale ->> 'body'),
        'incidentReference', v_row.reference,
        'panel', case when v_rec.role = 'employer' then 'employer' else 'candidate' end));
    -- Adres zablokowany (#44), brak adresu → brak wiersza; budżet odbiorcy (#45, 0101) →
    -- wiersz wygaszony ('failed'). Liczymy tylko wiersze faktycznie czekające w kolejce.
    update pg_temp.breach_recipients
       set queued = exists (select 1 from public.email_deliveries d
                             where d.idempotency_key = v_key and d.status = 'queued')
     where profile_id = v_rec.profile_id;
  end loop;

  select count(distinct profile_id) filter (where queued) into v_queued from pg_temp.breach_recipients;

  insert into public.breach_notices (id, incident_id, client_key, content, recipient_count,
                                     queued_count, created_by)
  values (v_notice_id, p_id, p_client_key, p_content, v_total, v_queued, auth.uid());
  insert into public.breach_notice_recipients (notice_id, profile_id, locale, queued)
  select distinct on (profile_id) v_notice_id, profile_id, locale, coalesce(queued, false)
    from pg_temp.breach_recipients where profile_id is not null order by profile_id;

  insert into public.breach_incident_events (incident_id, version, event_type, actor_id, changes)
  values (p_id, v_row.version, 'subjects_notified', auth.uid(),
          jsonb_build_object('noticeId', v_notice_id, 'recipients', v_total, 'queued', v_queued,
            'locales', (select jsonb_agg(k order by k) from jsonb_object_keys(p_content) k)));
  perform public.write_audit('breach.subjects_notified', 'breach_incident', p_id, null,
    jsonb_build_object('status', v_row.status, 'recipients', v_total, 'queued', v_queued));

  return jsonb_build_object('status', 'queued', 'noticeId', v_notice_id,
    'recipients', v_total, 'queued', v_queued);
end $$;
revoke all on function public.admin_notify_breach_subjects(uuid, uuid, text[], jsonb) from public;
grant execute on function public.admin_notify_breach_subjects(uuid, uuid, text[], jsonb) to authenticated;
