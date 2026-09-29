-- =============================================================================
-- 0960 — DSA: trwały dowód poinformowania, limity zgłoszeń pod blokadą, kod dostępu poza
-- kolejką e-mail, zawieszenie firmy niezweryfikowanej (paczka M-1 audytu 2026-09-28).
-- Numer TYMCZASOWY — ostateczny nada integrator. Buduje na 0084, 0094, 0104, 0109.
--
-- 1. #1037 (PRIV-03) Kod dostępu do sprawy zgłaszającego: baza trzyma skrót, ale zlecenie
--    `reportReceived` w `email_deliveries.payload` niosło go jawnym tekstem bez końca.
--    Strażnik BEFORE INSERT/UPDATE usuwa klucz `accessCode` z payloadu, gdy tylko zlecenie
--    przestaje być oczekujące (wysłane, odbite, zakończone błędem, wygaszone) — niezależnie od
--    ścieżki zapisu; oczekujące zlecenie zachowuje kod do chwili wysyłki. Jednorazowe
--    wyczyszczenie istniejących wpisów.
-- 2. #1045 (NOTIF-01) i #1063 (ADM-02) Termin odwołania nie zależy już od mutowalnej tabeli
--    powiadomień ani od bieżącego stanu wierszy poczty. Nowa, niezmienna tabela
--    `moderation_informed` (bez grantów; zapis wyłącznie triggerami i RPC odczytu decyzji)
--    zapisuje fakt poinformowania strony decyzji/cofnięcia:
--      * `email_sent`   — pierwszy faktycznie wysłany e-mail o decyzji (trigger na
--                         `email_deliveries`); trwałe odbicie / błąd wysyłki UNIEWAŻNIA ten
--                         wpis (`voided_at`), więc odbity list nie jest poinformowaniem;
--      * `panel_view`   — pierwszy odczyt decyzji przez aktywnego właściciela/administratora
--                         firmy w panelu (`get_company_moderation_decisions`); „oznacz wszystkie
--                         jako przeczytane” w powiadomieniach NIE jest poinformowaniem;
--      * `delivery_failed` — reguła zastępcza: ostatnie zlecenie e-mail o decyzji zakończyło się
--                         bez doręczenia, a nikt nie został poinformowany inaczej — termin
--                         biegnie od chwili tego ostatecznego niepowodzenia;
--      * `no_recipient` — reguła zastępcza: w chwili decyzji (cofnięcia) nie było żadnego
--                         adresata (brak aktywnego właściciela, adres pominięty przy kolejkowaniu)
--                         — termin biegnie od chwili decyzji (cofnięcia).
--    `moderation_informed_at` = najwcześniejszy nieunieważniony wpis; retencja
--    (`dsa_retention_cases`), stan drogi odwołania i raport korzystają z niego bez zmian, a
--    `dsa_retention_report` zlicza sprawy z biegiem terminu z reguły zastępczej
--    (`informedByFallback`). Terminy zatwierdzone przez właściciela (`dsa_appeal_window`,
--    `dsa_appeal_review_period`, `dsa_case_retention`) bez zmian.
-- 3. #1098 (część DSA, DB09-04) `submit_content_report`: limit 5 spraw / adres / 24 h i „jedna
--    otwarta sprawa na adres i treść” sprawdzane pod blokadą doradczą kluczowaną adresem
--    zgłaszającego (jak `submit_contact_message`, 0125) + częściowy indeks unikalny otwartych
--    spraw (reporter_email, cel). Równoległe zgłoszenia z różnymi kluczami idempotencji nie
--    omijają limitu.
-- 4. #1107 (SM16-04) `admin_set_company_status`: zawieszenie także z `unverified`/`pending`
--    (pilna blokada firmy jeszcze niezweryfikowanej); z `suspended` dodatkowo `rejected`, by
--    firmy nigdy niezweryfikowanej nie trzeba było „reaktywować” do `verified`.
--
-- Rollback: supabase/rollback/0960_dsa_informed_limits.down.sql (test:
-- supabase/tests/dsa-informed-rollback.sql). Tabela `moderation_informed` jest pochodna
-- (odtwarzalna z poczty) — po rollbacku terminy wracają do wyprowadzania z `email_deliveries`
-- i powiadomień (0104/0109).
-- =============================================================================

-- --- 1. Kod dostępu poza kolejką e-mail (#1037) -------------------------------------------
create or replace function public.email_deliveries_scrub_access_code()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.template = 'reportReceived' and new.status <> 'queued'
     and new.payload is not null and new.payload ? 'accessCode' then
    new.payload := new.payload - 'accessCode';
  end if;
  return new;
end $$;
revoke all on function public.email_deliveries_scrub_access_code() from public;

drop trigger if exists trg_email_deliveries_scrub_access_code on public.email_deliveries;
create trigger trg_email_deliveries_scrub_access_code
  before insert or update on public.email_deliveries
  for each row execute function public.email_deliveries_scrub_access_code();

-- Jednorazowo: zlecenia już zakończone nie mogą trzymać kodu.
update public.email_deliveries
   set payload = payload - 'accessCode'
 where template = 'reportReceived' and status <> 'queued' and payload ? 'accessCode';

-- --- 2. Trwały dowód poinformowania (#1045, #1063) ----------------------------------------
create table if not exists public.moderation_informed (
  id             uuid primary key default gen_random_uuid(),
  decision_id    uuid references public.moderation_decisions(id) on delete restrict,
  restoration_id uuid references public.moderation_restorations(id) on delete restrict,
  subject_key    uuid generated always as (coalesce(decision_id, restoration_id)) stored,
  basis          text not null check (basis in ('email_sent', 'panel_view', 'delivery_failed', 'no_recipient')),
  informed_at    timestamptz not null,
  delivery_id    uuid references public.email_deliveries(id) on delete set null,
  voided_at      timestamptz,
  recorded_at    timestamptz not null default now(),
  constraint moderation_informed_subject check ((decision_id is null) <> (restoration_id is null))
);
-- Jeden aktywny wpis na przedmiot i podstawę; unieważniony ustępuje miejsca nowemu.
create unique index if not exists moderation_informed_active_uq
  on public.moderation_informed(subject_key, basis) where voided_at is null;
create index if not exists moderation_informed_delivery_idx
  on public.moderation_informed(delivery_id) where delivery_id is not null;
alter table public.moderation_informed enable row level security;
revoke all on public.moderation_informed from public, anon, authenticated;

-- Niezmienność: jedyne zmiany to unieważnienie (voided_at: null → czas) i FK `delivery_id`
-- → null przy usunięciu starego wiersza poczty (GC). Bez DELETE.
create or replace function public.moderation_informed_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PERMISSION_DENIED: dowód poinformowania jest niezmienny' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.decision_id is distinct from old.decision_id
     or new.restoration_id is distinct from old.restoration_id or new.basis is distinct from old.basis
     or new.informed_at is distinct from old.informed_at or new.recorded_at is distinct from old.recorded_at
     or (new.delivery_id is distinct from old.delivery_id and new.delivery_id is not null)
     or (old.voided_at is not null and new.voided_at is distinct from old.voided_at)
     or (new.voided_at is null and old.voided_at is not null) then
    raise exception 'PERMISSION_DENIED: dowód poinformowania jest niezmienny' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.moderation_informed_guard() from public;

drop trigger if exists trg_moderation_informed_guard on public.moderation_informed;
create trigger trg_moderation_informed_guard
  before update or delete on public.moderation_informed
  for each row execute function public.moderation_informed_guard();

-- Zlecenia e-mail o decyzji/cofnięciu (jedno miejsce mapowania przedmiot ↔ wiersz poczty).
create or replace function public.moderation_subject_deliveries(p_kind text, p_subject uuid)
returns setof public.email_deliveries
language sql stable security definer set search_path = public, pg_temp as $$
  select e.*
    from public.email_deliveries e
   where (p_kind = 'decision' and (
            (e.entity_type = 'moderation_decision' and e.entity_id = p_subject
              and e.template in ('moderationJobRemoved', 'moderationCompanySuspended'))
         or (e.entity_type = 'report' and e.template = 'reportDecisionNoAction'
              and e.entity_id = (select d.report_id from public.moderation_decisions d
                                  where d.id = p_subject and d.decision = 'no_action'))))
      or (p_kind = 'restoration' and e.entity_type = 'moderation_restoration'
          and e.entity_id = p_subject and e.template = 'reportRestored');
$$;
revoke all on function public.moderation_subject_deliveries(text, uuid) from public, anon, authenticated;

-- Stan poczty przedmiotu: `pending` = zlecenia oczekujące, `ok` = wysłane/doręczone.
create or replace function public.moderation_subject_email_state(p_kind text, p_subject uuid)
returns table (pending integer, ok integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select (count(*) filter (where e.status = 'queued'))::integer,
         (count(*) filter (where e.status in ('sent', 'delivered', 'opened', 'clicked', 'complained')))::integer
    from public.moderation_subject_deliveries(p_kind, p_subject) e;
$$;
revoke all on function public.moderation_subject_email_state(text, uuid) from public, anon, authenticated;

create or replace function public.moderation_record_informed(
  p_kind text, p_subject uuid, p_basis text, p_at timestamptz, p_delivery uuid default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_kind = 'decision' then
    if not exists (select 1 from public.moderation_decisions d where d.id = p_subject) then return; end if;
    insert into public.moderation_informed(decision_id, basis, informed_at, delivery_id)
      values (p_subject, p_basis, p_at, p_delivery)
      on conflict (subject_key, basis) where voided_at is null do nothing;
  else
    if not exists (select 1 from public.moderation_restorations r where r.id = p_subject) then return; end if;
    insert into public.moderation_informed(restoration_id, basis, informed_at, delivery_id)
      values (p_subject, p_basis, p_at, p_delivery)
      on conflict (subject_key, basis) where voided_at is null do nothing;
  end if;
end $$;
revoke all on function public.moderation_record_informed(text, uuid, text, timestamptz, uuid)
  from public, anon, authenticated;

-- Wiersz poczty → wpis dowodu: sukces = `email_sent`; trwała porażka unieważnia wpis z tego
-- listu i, gdy nikt inny nie jest poinformowany ani nie czeka na wysyłkę, zapisuje regułę
-- zastępczą `delivery_failed` (termin od chwili ostatecznego niepowodzenia).
create or replace function public.email_deliveries_track_moderation_informed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_kind    text;
  v_subject uuid;
  v_state   record;
begin
  if new.template in ('moderationJobRemoved', 'moderationCompanySuspended')
     and new.entity_type = 'moderation_decision' then
    v_kind := 'decision';
    v_subject := new.entity_id;
  elsif new.template = 'reportDecisionNoAction' and new.entity_type = 'report' then
    v_kind := 'decision';
    select d.id into v_subject from public.moderation_decisions d
     where d.report_id = new.entity_id and d.decision = 'no_action';
  elsif new.template = 'reportRestored' and new.entity_type = 'moderation_restoration' then
    v_kind := 'restoration';
    v_subject := new.entity_id;
  else
    return new;
  end if;
  if v_subject is null then return new; end if;

  if new.status in ('sent', 'delivered', 'opened', 'clicked') and new.sent_at is not null then
    perform public.moderation_record_informed(v_kind, v_subject, 'email_sent', new.sent_at, new.id);
  elsif new.status in ('bounced', 'failed') and old.status is distinct from new.status
        and coalesce(new.error_message, '') <> 'dsa_retention' then
    update public.moderation_informed
       set voided_at = now()
     where delivery_id = new.id and basis = 'email_sent' and voided_at is null;
    select * into v_state from public.moderation_subject_email_state(v_kind, v_subject);
    if v_state.pending = 0 and v_state.ok = 0 and not exists (
         select 1 from public.moderation_informed i
          where i.subject_key = v_subject and i.voided_at is null
            and i.basis in ('email_sent', 'panel_view')) then
      perform public.moderation_record_informed(v_kind, v_subject, 'delivery_failed', now(), new.id);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.email_deliveries_track_moderation_informed() from public;

drop trigger if exists trg_email_deliveries_track_moderation_informed on public.email_deliveries;
create trigger trg_email_deliveries_track_moderation_informed
  after update of status, sent_at on public.email_deliveries
  for each row
  when (new.template in ('moderationJobRemoved', 'moderationCompanySuspended',
                         'reportDecisionNoAction', 'reportRestored'))
  execute function public.email_deliveries_track_moderation_informed();

-- Reguła zastępcza „brak adresata”: sprawdzana przy zatwierdzeniu transakcji, gdy decyzja
-- (cofnięcie) i jej e-maile już istnieją. Bez żadnego zlecenia i bez poinformowania w panelu
-- termin biegnie od chwili decyzji (cofnięcia).
create or replace function public.moderation_informed_no_recipient()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_state record;
begin
  if tg_table_name = 'moderation_decisions' then
    if exists (select 1 from public.moderation_informed i
                where i.subject_key = new.id and i.voided_at is null) then
      return null;
    end if;
    select * into v_state from public.moderation_subject_email_state('decision', new.id);
    if v_state.pending = 0 and v_state.ok = 0 then
      perform public.moderation_record_informed('decision', new.id, 'no_recipient', new.decided_at);
    end if;
  else
    if exists (select 1 from public.moderation_informed i
                where i.subject_key = new.id and i.voided_at is null) then
      return null;
    end if;
    select * into v_state from public.moderation_subject_email_state('restoration', new.id);
    if v_state.pending = 0 and v_state.ok = 0
       and public.moderation_restoration_appealable(new.id) = 'OK' then
      perform public.moderation_record_informed('restoration', new.id, 'no_recipient', new.restored_at);
    end if;
  end if;
  return null;
end $$;
revoke all on function public.moderation_informed_no_recipient() from public;

drop trigger if exists trg_moderation_decisions_informed_no_recipient on public.moderation_decisions;
create constraint trigger trg_moderation_decisions_informed_no_recipient
  after insert on public.moderation_decisions
  deferrable initially deferred
  for each row execute function public.moderation_informed_no_recipient();
drop trigger if exists trg_moderation_restorations_informed_no_recipient on public.moderation_restorations;
create constraint trigger trg_moderation_restorations_informed_no_recipient
  after insert on public.moderation_restorations
  deferrable initially deferred
  for each row execute function public.moderation_informed_no_recipient();

-- Chwila poinformowania = najwcześniejszy nieunieważniony wpis (null = jeszcze nie poinformowana).
create or replace function public.moderation_informed_at(p_decision_id uuid)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $$
  select min(i.informed_at) from public.moderation_informed i
   where i.decision_id = p_decision_id and i.voided_at is null;
$$;
revoke all on function public.moderation_informed_at(uuid) from public, anon, authenticated;
grant execute on function public.moderation_informed_at(uuid) to service_role;

create or replace function public.moderation_restoration_informed_at(p_restoration_id uuid)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $$
  select min(i.informed_at) from public.moderation_informed i
   where i.restoration_id = p_restoration_id and i.voided_at is null;
$$;
revoke all on function public.moderation_restoration_informed_at(uuid) from public, anon, authenticated;
grant execute on function public.moderation_restoration_informed_at(uuid) to service_role;

-- Odczyt decyzji przez autora = poinformowanie w panelu (zamiast odczytu powiadomienia).
drop function if exists public.get_company_moderation_decisions(uuid);
create or replace function public.get_company_moderation_decisions(p_company_id uuid)
returns table (
  id uuid, reference text, decision text, job_id uuid, job_title text, facts text,
  ground_type text, ground_reference text, automated_detection boolean,
  decided_at timestamptz, restored_at timestamptz, restore_reason text,
  appeal_state text, appeal_deadline timestamptz,
  appeal_id uuid, appeal_reference text, appeal_status text, appeal_submitted_at timestamptz,
  appeal_due_at timestamptz, appeal_decided_at timestamptz, appeal_reasoning text
) language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (
       select 1 from public.company_members cm
        where cm.company_id = p_company_id and cm.profile_id = auth.uid()
          and cm.is_active = true and cm.role in ('owner', 'admin')) then
    return;
  end if;

  -- Pierwszy odczyt wyświetlanych decyzji przez uprawnioną osobę firmy (niezmienny zapis).
  insert into public.moderation_informed(decision_id, basis, informed_at)
    select s.sid, 'panel_view', now()
      from (select d.id as sid from public.moderation_decisions d
             where d.company_id = p_company_id and d.decision <> 'no_action' and d.redacted_at is null
             order by d.decided_at desc, d.id
             limit 50) s
    on conflict (subject_key, basis) where voided_at is null do nothing;

  return query
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
      order by d.decided_at desc, d.id
      limit 50;
end $$;
revoke all on function public.get_company_moderation_decisions(uuid) from public, anon;
grant execute on function public.get_company_moderation_decisions(uuid) to authenticated;

-- Raport retencji: sprawy, których termin biegnie z reguły zastępczej (nikt nie został
-- poinformowany faktycznie).
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
    'informedByFallback', (select count(*) from (
        select i.subject_key from public.moderation_informed i
         where i.voided_at is null
         group by i.subject_key
        having bool_and(i.basis in ('delivery_failed', 'no_recipient'))) f),
    'nextEligibleAt', (select min(eligible_at) from c where eligible_at > now()));
$$;
revoke all on function public.dsa_retention_report() from public, anon, authenticated;
grant execute on function public.dsa_retention_report() to service_role;

-- Uzupełnienie istniejących spraw (pochodne poczty i, jednorazowo, odczytów powiadomień).
insert into public.moderation_informed(decision_id, basis, informed_at, delivery_id)
  select distinct on (d.id) d.id, 'email_sent', e.sent_at, e.id
    from public.moderation_decisions d
    cross join lateral public.moderation_subject_deliveries('decision', d.id) e
   where e.status in ('sent', 'delivered', 'opened', 'clicked') and e.sent_at is not null
   order by d.id, e.sent_at
  on conflict do nothing;
insert into public.moderation_informed(restoration_id, basis, informed_at, delivery_id)
  select distinct on (r.id) r.id, 'email_sent', e.sent_at, e.id
    from public.moderation_restorations r
    cross join lateral public.moderation_subject_deliveries('restoration', r.id) e
   where e.status in ('sent', 'delivered', 'opened', 'clicked') and e.sent_at is not null
   order by r.id, e.sent_at
  on conflict do nothing;
insert into public.moderation_informed(decision_id, basis, informed_at)
  select d.id, 'panel_view', min(n.read_at)
    from public.moderation_decisions d
    join public.notifications n
      on n.entity_type = 'company' and n.entity_id = d.company_id
     and n.data->>'kind' = 'moderation' and n.data->>'decisionId' = d.id::text
     and n.read_at is not null
   where d.decision <> 'no_action'
   group by d.id
  on conflict do nothing;
insert into public.moderation_informed(decision_id, basis, informed_at)
  select d.id, case when f.failed > 0 then 'delivery_failed' else 'no_recipient' end,
         coalesce(f.failed_at, d.decided_at)
    from public.moderation_decisions d
    cross join lateral (
      select count(*) filter (where e.status in ('bounced', 'failed')) as failed,
             max(e.updated_at) filter (where e.status in ('bounced', 'failed')) as failed_at,
             count(*) filter (where e.status in ('queued', 'sent', 'delivered', 'opened', 'clicked', 'complained')) as live
        from public.moderation_subject_deliveries('decision', d.id) e) f
   where f.live = 0
     and not exists (select 1 from public.moderation_informed i
                      where i.subject_key = d.id and i.voided_at is null)
  on conflict do nothing;
insert into public.moderation_informed(restoration_id, basis, informed_at)
  select r.id, case when f.failed > 0 then 'delivery_failed' else 'no_recipient' end,
         coalesce(f.failed_at, r.restored_at)
    from public.moderation_restorations r
    cross join lateral (
      select count(*) filter (where e.status in ('bounced', 'failed')) as failed,
             max(e.updated_at) filter (where e.status in ('bounced', 'failed')) as failed_at,
             count(*) filter (where e.status in ('queued', 'sent', 'delivered', 'opened', 'clicked', 'complained')) as live
        from public.moderation_subject_deliveries('restoration', r.id) e) f
   where f.live = 0
     and public.moderation_restoration_appealable(r.id) = 'OK'
     and not exists (select 1 from public.moderation_informed i
                      where i.subject_key = r.id and i.voided_at is null)
  on conflict do nothing;

-- --- 3. Limity zgłoszeń pod blokadą (#1098, część DSA) ------------------------------------
-- Częściowy indeks: najwyżej jedna otwarta sprawa DSA na zgłaszającego (adres) i treść.
-- Istniejące duplikaty (wyścig sprzed migracji) nie blokują wdrożenia — wtedy indeks
-- pomijamy z ostrzeżeniem, a blokada w funkcji i tak domyka wyścig.
do $$
begin
  if exists (select 1 from public.reports r
              where r.kind = 'dsa_notice' and r.status in ('open', 'reviewing')
              group by r.reporter_email, r.target_type, r.target_id having count(*) > 1) then
    raise warning '0960: duplikaty otwartych spraw DSA — indeks reports_dsa_open_uq pominięty';
  else
    create unique index if not exists reports_dsa_open_uq
      on public.reports(reporter_email, target_type, target_id)
      where kind = 'dsa_notice' and status in ('open', 'reviewing');
  end if;
end $$;

-- Definicja z 0094 + blokada per adres zgłaszającego przed sprawdzeniem limitu.
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

  -- Limit w bazie: 5 spraw / adres / 24 h; jedna otwarta sprawa na adres i treść. Licznik i
  -- wstawienie w jednej sekcji krytycznej (blokada doradcza per adres, jak w kontakcie, 0125):
  -- równoległe zgłoszenia z różnymi kluczami idempotencji nie omijają limitu (#1098).
  perform pg_advisory_xact_lock(hashtextextended('report-email:' || v_email::text, 0));
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

-- --- 4. Zawieszenie firmy niezweryfikowanej (#1107) ----------------------------------------
-- Definicja z 0084 + rozszerzona macierz przejść.
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

  -- #1107: pilna blokada także firmy jeszcze niezweryfikowanej (unverified/pending → suspended);
  -- z zawieszenia można ją też odrzucić, zamiast „reaktywować” do verified bez weryfikacji.
  if not (
    (v_from in ('unverified', 'pending') and v_to in ('verified', 'rejected', 'suspended'))
    or (v_from = 'verified' and v_to = 'suspended')
    or (v_from = 'rejected' and v_to = 'verified')
    or (v_from = 'suspended' and v_to in ('verified', 'rejected'))
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
