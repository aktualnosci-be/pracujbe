-- =============================================================================
-- 0973_retention_dsa_informed_restore.sql — numer TYMCZASOWY (ostateczny nada integrator).
--
-- #784: retencja usuwała CV i konto nieaktywnego kandydata do 72 h PRZED datą podaną
--   w ostrzeżeniu (`w.due_at - v_lead <= now()`, v_lead = okres `storage_physical_deletion`).
--   Termin fizycznego usunięcia obiektu dotyczy kolejki storage, nie daty utraty dostępu:
--   CV i konto usuwamy dopiero od `retention_warnings.due_at`. Pozostałe kategorie
--   (`deleted_file`, `deleted_profile` — dane już oznaczone do usunięcia) bez zmian.
--   `retention_purge_batch` = definicja z 0127 z tą jedną zmianą (niezależna od #973/0182,
--   która zmienia tylko `admin_set_retention_policy`).
--
-- #860: chwila poinformowania o decyzji moderacyjnej (i o cofnięciu ograniczenia) była
--   liczona wyłącznie z `email_deliveries`/`notifications`. Usunięcie konta strony kasuje te
--   wiersze → termin odwołania wracał do NULL (odwołanie znów „OK”), a sprawa nie dostawała
--   daty kwalifikacji do retencji. Teraz pierwsza chwila poinformowania jest utrwalana jako
--   niezmienny fakt: `moderation_decisions.informed_at`, `moderation_restorations.informed_at`
--   (ustawiane raz, null → wartość, triggerami na e-mailu i odczycie powiadomienia; strażnik
--   niezmienności przepuszcza tylko to przejście). `moderation_informed_at` i
--   `moderation_restoration_informed_at` biorą najwcześniejszą z wartości utrwalonej
--   i wyliczonej. Backfill z istniejących wierszy.
--
-- #887: `moderation_restore_core` sprawdza anonimizację sprawy PO blokadzie wiersza sprawy
--   i odrzuca cofnięcie (`INVALID_TRANSITION: CASE_REDACTED`) bez zapisu i skutków — nowe
--   uzasadnienie po anonimizacji wypadłoby z cyklu retencji. UI ukrywa akcję dla takiej sprawy.
--
-- Rollback: supabase/rollback/0973_retention_dsa_informed_restore.down.sql.
-- =============================================================================

-- --- 1. Utrwalona chwila poinformowania (#860) ---------------------------------------------
alter table public.moderation_decisions add column if not exists informed_at timestamptz;
alter table public.moderation_restorations add column if not exists informed_at timestamptz;

-- Niezmienność decyzji i przywróceń (0104) + wyjątki: retencja (fakty/powód → null),
-- odwołanie FK na null oraz JEDNORAZOWE utrwalenie `informed_at` (null → wartość, #860).
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
  if tg_op = 'UPDATE'
     and coalesce(current_setting('pracujbe.moderation_informed', true), '') = 'on'
     and to_jsonb(old)->>'informed_at' is null and to_jsonb(new)->>'informed_at' is not null
     and (to_jsonb(new) - 'informed_at') = (to_jsonb(old) - 'informed_at') then
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

-- E-mail o decyzji / cofnięciu faktycznie wysłany → utrwal chwilę (tylko pierwszą).
create or replace function public.moderation_record_informed_email()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.sent_at is null or new.status::text not in ('sent', 'delivered', 'opened', 'clicked') then
    return null;
  end if;
  perform set_config('pracujbe.moderation_informed', 'on', true);
  if new.template = 'reportDecisionNoAction' and new.entity_type = 'report' then
    update public.moderation_decisions set informed_at = new.sent_at
     where report_id = new.entity_id and decision = 'no_action' and informed_at is null;
  elsif new.template in ('moderationJobRemoved', 'moderationCompanySuspended')
        and new.entity_type = 'moderation_decision' then
    update public.moderation_decisions set informed_at = new.sent_at
     where id = new.entity_id and decision <> 'no_action' and informed_at is null;
  elsif new.template = 'reportRestored' and new.entity_type = 'moderation_restoration' then
    update public.moderation_restorations set informed_at = new.sent_at
     where id = new.entity_id and informed_at is null;
  end if;
  perform set_config('pracujbe.moderation_informed', '', true);
  return null;
end $$;
revoke all on function public.moderation_record_informed_email() from public, anon, authenticated;
drop trigger if exists trg_moderation_record_informed_email on public.email_deliveries;
create trigger trg_moderation_record_informed_email
  after insert or update of status, sent_at on public.email_deliveries
  for each row
  when (new.sent_at is not null and new.template in (
    'reportDecisionNoAction', 'moderationJobRemoved', 'moderationCompanySuspended', 'reportRestored'))
  execute function public.moderation_record_informed_email();

-- Odczyt powiadomienia o ograniczeniu w panelu firmy → utrwal chwilę (tylko pierwszą).
create or replace function public.moderation_record_informed_notification()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_decision uuid;
begin
  if coalesce(new.data->>'decisionId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  v_decision := (new.data->>'decisionId')::uuid;
  perform set_config('pracujbe.moderation_informed', 'on', true);
  update public.moderation_decisions set informed_at = new.read_at
   where id = v_decision and company_id = new.entity_id and decision <> 'no_action' and informed_at is null;
  perform set_config('pracujbe.moderation_informed', '', true);
  return null;
end $$;
revoke all on function public.moderation_record_informed_notification() from public, anon, authenticated;
drop trigger if exists trg_moderation_record_informed_notification on public.notifications;
create trigger trg_moderation_record_informed_notification
  after update of read_at on public.notifications
  for each row
  when (old.read_at is null and new.read_at is not null
        and new.entity_type = 'company' and new.data->>'kind' = 'moderation')
  execute function public.moderation_record_informed_notification();

-- Chwila poinformowania: najwcześniejsza z utrwalonej (#860) i wyliczonej z kolejki/panelu.
create or replace function public.moderation_informed_at(p_decision_id uuid)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $$
  select least(d.informed_at, case when d.decision = 'no_action' then
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
    end)
  from public.moderation_decisions d where d.id = p_decision_id;
$$;
revoke all on function public.moderation_informed_at(uuid) from public, anon, authenticated;
grant execute on function public.moderation_informed_at(uuid) to service_role;

create or replace function public.moderation_restoration_informed_at(p_restoration_id uuid)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $$
  select least(mr.informed_at,
    (select min(e.sent_at) from public.email_deliveries e
      where e.entity_type = 'moderation_restoration' and e.entity_id = mr.id
        and e.template = 'reportRestored'
        and e.status in ('sent', 'delivered', 'opened', 'clicked') and e.sent_at is not null))
  from public.moderation_restorations mr where mr.id = p_restoration_id;
$$;
revoke all on function public.moderation_restoration_informed_at(uuid) from public, anon, authenticated;
grant execute on function public.moderation_restoration_informed_at(uuid) to service_role;

-- Backfill: utrwal chwilę dla decyzji/cofnięć już poinformowanych.
select set_config('pracujbe.moderation_informed', 'on', true);
update public.moderation_decisions d set informed_at = public.moderation_informed_at(d.id)
 where d.informed_at is null and public.moderation_informed_at(d.id) is not null;
update public.moderation_restorations mr set informed_at = public.moderation_restoration_informed_at(mr.id)
 where mr.informed_at is null and public.moderation_restoration_informed_at(mr.id) is not null;
select set_config('pracujbe.moderation_informed', '', true);

-- --- 2. Cofnięcie ograniczenia po anonimizacji sprawy (#887) -------------------------------
-- Definicja z 0104 + kontrola `redacted_at` po blokadzie sprawy.
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
  v_report_redacted timestamptz;
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
  select r.redacted_at into v_report_redacted from public.reports r where r.id = v_dec.report_id for update;
  -- #887: stan anonimizacji sprawdzany PO blokadzie sprawy (równoległy dsa_retention_run czeka
  -- albo już zakończył). Po anonimizacji cykl retencji sprawy jest zamknięty — nowy zapis
  -- (uzasadnienie, e-mail) wypadłby z niego, więc cofnięcie jest odrzucane bez skutków.
  select d.* into v_dec from public.moderation_decisions d where d.id = p_decision_id;
  if v_report_redacted is not null or v_dec.redacted_at is not null then
    raise exception 'INVALID_TRANSITION: CASE_REDACTED' using errcode = '22023';
  end if;
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

-- --- 3. Retencja CV i konta od terminu z ostrzeżenia (#784) --------------------------------
-- Definicja z 0127; zmienione wyłącznie warunki usuwania CV i konta (`w.due_at <= now()`).
-- Jedna partia wszystkich kategorii (funkcja wewnętrzna; wywołuje ją run_retention_purge).
create or replace function public.retention_purge_batch(p_limit integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_limit   integer := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_erase_limit integer := least(v_limit, 50);
  v_period  interval;
  v_warn    interval;
  -- Fizyczne usunięcie obiektu mieści się w okresie kategorii: wiersz usuwamy o tyle wcześniej.
  -- #784: dotyczy WYŁĄCZNIE danych już oznaczonych do usunięcia (deleted_file/deleted_profile).
  -- CV i konto nieaktywnego kandydata — dopiero od terminu z ostrzeżenia (`w.due_at <= now()`).
  v_lead    interval := coalesce(public.retention_period('storage_physical_deletion'), interval '0');
  v_ids     uuid[];
  v_convs   uuid[];
  v_subject uuid;
  v_request uuid;
  v_row     record;
  v_due     timestamptz;
  v_out     jsonb := '{}'::jsonb;
  v_full    integer := 0;
  v_n       integer;
begin
  -- Pliki oznaczone jako usunięte → wiersz (trigger kolejkuje obiekt storage).
  v_period := public.retention_period('deleted_file');
  v_n := 0;
  if v_period is not null then
    delete from public.files f
     where f.id in (select x.id from public.files x
                     where x.deleted_at is not null
                       and x.deleted_at < now() - greatest(v_period - v_lead, interval '0')
                     order by x.deleted_at limit v_limit for update skip locked);
    get diagnostics v_n = row_count;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  end if;
  v_out := v_out || jsonb_build_object('deletedFiles', v_n);

  -- Profile kandydatów oznaczone jako usunięte → pełne usunięcie.
  v_period := public.retention_period('deleted_profile');
  v_n := 0;
  if v_period is not null then
    for v_subject in
      select p.id from public.profiles p
       where p.role = 'candidate' and p.deleted_at is not null
         and p.deleted_at < now() - greatest(v_period - v_lead, interval '0')
       order by p.deleted_at limit v_erase_limit for update skip locked
    loop
      insert into public.data_rights_requests (subject_id, kind, channel, due_at)
      values (v_subject, 'erasure', 'retention', now()) returning id into v_request;
      update public.data_rights_requests
         set details = public.erase_candidate_subject(v_subject, 'retention', v_request), completed_at = now()
       where id = v_request;
      v_n := v_n + 1;
    end loop;
    if v_n >= v_erase_limit then v_full := v_full + 1; end if;
  end if;
  v_out := v_out || jsonb_build_object('erasedProfiles', v_n);

  -- Aplikacje zamknięte (każdy stan końcowy) od closed_at — z rozmowami, powiadomieniami, e-mailami.
  v_period := public.retention_period('closed_application');
  v_n := 0;
  if v_period is not null then
    select coalesce(array_agg(x.id), '{}') into v_ids
      from (select a.id from public.applications a
             where a.closed_at is not null
               and public.application_status_is_terminal(a.status)
               and a.closed_at < now() - v_period
             order by a.closed_at limit v_limit for update skip locked) x;
    select coalesce(array_agg(c.id), '{}') into v_convs
      from public.conversations c where c.application_id = any(v_ids);
    delete from public.notifications n
     where n.entity_id = any(v_ids) or n.entity_id = any(v_convs)
        or n.entity_id in (select m.id from public.messages m where m.conversation_id = any(v_convs));
    delete from public.email_deliveries e
     where e.entity_id = any(v_ids) or e.entity_id = any(v_convs)
        or e.entity_id in (select m.id from public.messages m where m.conversation_id = any(v_convs));
    delete from public.conversations c where c.id = any(v_convs);
    -- Ślad zgłoszenia bez konta traci powiązanie (FK → null); jego okres: confirmed_guest_request.
    delete from public.applications a where a.id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  end if;
  v_out := v_out || jsonb_build_object('closedApplications', v_n,
                                       'closedApplicationConversations', coalesce(array_length(v_convs, 1), 0));
  v_convs := '{}';

  -- Ostrzeżenia przestają obowiązywać, gdy kandydat był aktywny (inna aktywność niż ostrzeżona).
  delete from public.retention_warnings w
   using public.profiles p
   where p.id = w.profile_id and w.activity_at <> coalesce(p.last_seen_at, p.created_at);

  -- CV nieaktywnych kandydatów: ostrzeżenie, potem usunięcie pliku (obiekt → kolejka).
  v_period := public.retention_period('inactive_candidate_cv');
  v_warn := coalesce(public.retention_warning_period('inactive_candidate_cv'), interval '0');
  v_n := 0;
  if v_period is not null then
    for v_row in
      select p.id, coalesce(p.last_seen_at, p.created_at) as activity
        from public.profiles p
       where p.role = 'candidate' and p.deleted_at is null
         and coalesce(p.last_seen_at, p.created_at) < now() - greatest(v_period - v_warn, interval '0')
         and exists (select 1 from public.files x where x.owner_id = p.id
                       and x.entity_type = 'candidate_cv' and x.deleted_at is null)
         and not exists (select 1 from public.retention_warnings w
                          where w.profile_id = p.id and w.policy_key = 'inactive_candidate_cv'
                            and w.activity_at = coalesce(p.last_seen_at, p.created_at))
       order by 2 limit v_limit
       for update of p skip locked
    loop
      insert into public.retention_warnings (profile_id, policy_key, activity_at, due_at)
      values (v_row.id, 'inactive_candidate_cv', v_row.activity,
              greatest(v_row.activity + v_period, now() + v_warn))
      returning due_at into v_due;
      perform public.enqueue_email(v_row.id, 'inactiveCvWarning', 'profile', v_row.id,
        'retention:inactive_candidate_cv:' || v_row.id || ':' || extract(epoch from v_row.activity)::bigint,
        jsonb_build_object('deletionDate', v_due));
      v_n := v_n + 1;
    end loop;
    if v_n >= v_limit then v_full := v_full + 1; end if;
    v_out := v_out || jsonb_build_object('inactiveCvWarned', v_n);

    delete from public.files f
     where f.id in (select x.id from public.files x
                      join public.profiles p on p.id = x.owner_id
                      join public.retention_warnings w
                        on w.profile_id = p.id and w.policy_key = 'inactive_candidate_cv'
                       and w.activity_at = coalesce(p.last_seen_at, p.created_at)
                     where x.entity_type = 'candidate_cv' and x.deleted_at is null
                       and w.due_at <= now()
                     order by w.due_at limit v_limit for update of x skip locked);
    get diagnostics v_n = row_count;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  else
    v_out := v_out || jsonb_build_object('inactiveCvWarned', 0);
    v_n := 0;
  end if;
  v_out := v_out || jsonb_build_object('inactiveCvDeleted', v_n);

  -- Konta nieaktywnych kandydatów: ostrzeżenie, potem pełne usunięcie.
  v_period := public.retention_period('inactive_candidate_account');
  v_warn := coalesce(public.retention_warning_period('inactive_candidate_account'), interval '0');
  v_n := 0;
  if v_period is not null then
    for v_row in
      select p.id, coalesce(p.last_seen_at, p.created_at) as activity
        from public.profiles p
       where p.role = 'candidate' and p.deleted_at is null
         and coalesce(p.last_seen_at, p.created_at) < now() - greatest(v_period - v_warn, interval '0')
         and not exists (select 1 from public.retention_warnings w
                          where w.profile_id = p.id and w.policy_key = 'inactive_candidate_account'
                            and w.activity_at = coalesce(p.last_seen_at, p.created_at))
       order by 2 limit v_limit
       for update of p skip locked
    loop
      insert into public.retention_warnings (profile_id, policy_key, activity_at, due_at)
      values (v_row.id, 'inactive_candidate_account', v_row.activity,
              greatest(v_row.activity + v_period, now() + v_warn))
      returning due_at into v_due;
      perform public.enqueue_email(v_row.id, 'inactiveAccountWarning', 'profile', v_row.id,
        'retention:inactive_candidate_account:' || v_row.id || ':' || extract(epoch from v_row.activity)::bigint,
        jsonb_build_object('deletionDate', v_due));
      v_n := v_n + 1;
    end loop;
    if v_n >= v_limit then v_full := v_full + 1; end if;
    v_out := v_out || jsonb_build_object('inactiveAccountsWarned', v_n);

    v_n := 0;
    for v_subject in
      select p.id from public.profiles p
        join public.retention_warnings w
          on w.profile_id = p.id and w.policy_key = 'inactive_candidate_account'
         and w.activity_at = coalesce(p.last_seen_at, p.created_at)
       where p.role = 'candidate' and w.due_at <= now()
       order by w.due_at limit v_erase_limit
       for update of p skip locked
    loop
      insert into public.data_rights_requests (subject_id, kind, channel, due_at)
      values (v_subject, 'erasure', 'retention', now()) returning id into v_request;
      update public.data_rights_requests
         set details = public.erase_candidate_subject(v_subject, 'retention', v_request), completed_at = now()
       where id = v_request;
      v_n := v_n + 1;
    end loop;
    if v_n >= v_erase_limit then v_full := v_full + 1; end if;
  else
    v_out := v_out || jsonb_build_object('inactiveAccountsWarned', 0);
  end if;
  v_out := v_out || jsonb_build_object('inactiveAccountsErased', v_n);

  -- Profil wyszukiwalny bez aktywności → ukryty (jak wyłączenie przez kandydata, z historią).
  v_period := public.retention_period('inactive_searchable_profile');
  v_n := 0;
  if v_period is not null then
    select coalesce(array_agg(x.profile_id), '{}') into v_ids
      from (select cp.profile_id from public.candidate_profiles cp
              join public.profiles p on p.id = cp.profile_id
             where cp.is_searchable and p.deleted_at is null
               and coalesce(p.last_seen_at, p.created_at) < now() - v_period
             order by coalesce(p.last_seen_at, p.created_at) limit v_limit
             for update of cp skip locked) x;
    update public.candidate_profiles
       set is_searchable = false, searchable_changed_at = now()
     where profile_id = any(v_ids);
    get diagnostics v_n = row_count;
    insert into public.candidate_visibility_events (candidate_id, searchable)
    select unnest(v_ids), false;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  end if;
  v_out := v_out || jsonb_build_object('hiddenProfiles', v_n);

  -- Zgłoszenia bez konta: niepotwierdzone (od pierwszego wysłania) i bufor potwierdzonych.
  v_period := public.retention_period('unconfirmed_guest_request');
  v_n := 0;
  if v_period is not null then
    select coalesce(array_agg(x.id), '{}') into v_ids
      from (select g.id from public.guest_application_requests g
             where g.status = 'pending' and g.created_at < now() - v_period
             order by g.created_at limit v_limit for update skip locked) x;
    delete from public.email_deliveries
     where entity_type = 'guest_application_request' and entity_id = any(v_ids);
    delete from public.guest_application_requests where id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  end if;
  v_out := v_out || jsonb_build_object('unconfirmedGuestRequests', v_n);

  v_period := public.retention_period('confirmed_guest_request');
  v_n := 0;
  if v_period is not null then
    select coalesce(array_agg(x.id), '{}') into v_ids
      from (select g.id from public.guest_application_requests g
             where g.status in ('confirmed', 'duplicate') and g.confirmed_at is not null
               and g.confirmed_at < now() - v_period
             order by g.confirmed_at limit v_limit for update skip locked) x;
    delete from public.email_deliveries
     where entity_type = 'guest_application_request' and entity_id = any(v_ids);
    delete from public.guest_application_requests where id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  end if;
  v_out := v_out || jsonb_build_object('confirmedGuestRequests', v_n);

  v_period := public.retention_period('guest_ip_user_agent');
  v_n := 0;
  if v_period is not null then
    update public.guest_application_requests g
       set consent_ip = null, consent_user_agent = null
     where g.id in (select x.id from public.guest_application_requests x
                     where (x.consent_ip is not null or x.consent_user_agent is not null)
                       and x.created_at < now() - v_period
                     order by x.created_at limit v_limit for update skip locked);
    get diagnostics v_n = row_count;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  end if;
  v_out := v_out || jsonb_build_object('guestIpCleared', v_n);

  v_period := public.retention_period('data_rights_request_log');
  v_n := 0;
  if v_period is not null then
    delete from public.data_rights_requests r
     where r.id in (select x.id from public.data_rights_requests x
                     where x.completed_at is not null and x.completed_at < now() - v_period
                     order by x.completed_at limit v_limit for update skip locked);
    get diagnostics v_n = row_count;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  end if;
  v_out := v_out || jsonb_build_object('dataRightsRequests', v_n);

  v_period := public.retention_period('erasure_tombstone');
  v_n := 0;
  if v_period is not null then
    delete from public.erasure_tombstones t
     where t.subject_id in (select x.subject_id from public.erasure_tombstones x
                             where greatest(x.erased_at, coalesce(x.reapplied_at, x.erased_at)) < now() - v_period
                             order by x.erased_at limit v_limit for update skip locked);
    get diagnostics v_n = row_count;
    if v_n >= v_limit then v_full := v_full + 1; end if;
  end if;
  return v_out || jsonb_build_object('erasureTombstones', v_n, 'fullBatches', v_full);
end $$;
revoke all on function public.retention_purge_batch(integer) from public, anon, authenticated;
