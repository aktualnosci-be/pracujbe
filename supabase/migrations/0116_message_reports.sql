-- =============================================================================
-- 0116 — zgłoszenia wiadomości i rozmów (Etap 5, „Wiadomości: zgłoszenia”).
--
-- NUMER TYMCZASOWY — ostateczny nada integrator (kolejka migracji).
--
-- Strona rozmowy (uczestnik z dostępem wg `is_conversation_member`) zgłasza jedną
-- wiadomość drugiej strony albo całą rozmowę. Zgłoszenie to wiersz `reports` istniejącego
-- modelu (#41/#42) z nowym rodzajem `kind = 'message_report'`; rozstrzyga je administrator
-- przez `admin_resolve_report` (0081), historia trafia do `report_events` (0094).
--
-- 1. `report_target_type` dostaje wartość `conversation`. Nowej wartości nie używamy jako
--    literału w DDL tej migracji (migrator produkcyjny nakłada oczekujące pliki w jednej
--    transakcji) — tylko w ciałach funkcji plpgsql, wykonywanych po zatwierdzeniu.
-- 2. `reports.conversation_id` — rozmowa zgłoszenia (bez FK: dowód nie znika i nie zmienia
--    się przy usunięciu rozmowy/konta; `reports_guard` odrzuciłby zmianę pod sesją).
-- 3. Dowód (`target_snapshot`) buduje baza: treść WYŁĄCZNIE zgłoszonej wiadomości (dla
--    rozmowy — tylko metadane: firma, oferta, liczba wiadomości, bez treści). Dowód widzi
--    tylko administrator: polityka `reports_select_own` pomija `message_report`, a stan
--    własnych zgłoszeń zwraca `get_my_message_reports` (bez dowodu i opisu).
-- 4. Niezmienność: `reports_message_report_immutable` (każda rola, także service_role) —
--    zmienia się tylko stan sprawy (status, resolved_*, updated_at), `reporter_id` może
--    jedynie przejść na null; usunięcia brak.
-- 5. Idempotencja: ten sam `idempotency_key` = to samo zgłoszenie (także przy wyścigu).
--    Jedna otwarta sprawa na wiadomość (dowolny zgłaszający) oraz na rozmowę i zgłaszającego
--    (druga strona rozmowy nie dowiaduje się o zgłoszeniu) — indeksy częściowe + blokada.
-- 6. Limit w bazie (niezależny od limitera aplikacji): 20 zgłoszeń na konto w 24 h.
--
-- Rollback (zgłoszenia są dowodem — przed rollbackiem wyeksportować wiersze
-- `kind = 'message_report'` z `report_events`): drop function report_conversation_content,
-- get_my_message_reports, reports_message_report_immutable; drop index
-- reports_message_open_uq, reports_conversation_open_uq; usunąć wiersze `message_report`;
-- odtworzyć `reports_kind_chk`/`reports_category_chk` z 0094, politykę `reports_select_own`
-- z 0009; drop constraint reports_message_report_complete, reports_conversation_target_chk;
-- drop column conversation_id. Wartość enumu `conversation` zostaje (PostgreSQL nie usuwa
-- wartości enumu) — bez wierszy jest nieużywana.
-- =============================================================================

alter type public.report_target_type add value if not exists 'conversation';

-- --- 1. Kolumny i ograniczenia -------------------------------------------------------------
alter table public.reports add column if not exists conversation_id uuid;

alter table public.reports drop constraint if exists reports_kind_chk;
alter table public.reports add constraint reports_kind_chk
  check (kind in ('quality', 'dsa_notice', 'message_report'));

alter table public.reports drop constraint if exists reports_category_chk;
alter table public.reports add constraint reports_category_chk check (
  category is null
  or category in ('fraud', 'impersonation', 'discrimination', 'illegal_conditions', 'data_misuse',
                  'other', 'spam', 'harassment', 'inappropriate')
);

-- Zgłoszenie wiadomości jest kompletne albo nie istnieje (także przy zapisie service_role).
-- `target_type::text` — bez literału nowej wartości enumu w tej transakcji.
alter table public.reports add constraint reports_message_report_complete check (
  kind <> 'message_report' or (
    idempotency_key is not null and category is not null and target_snapshot is not null
    and conversation_id is not null and target_type::text in ('message', 'conversation')
    and (details is null or char_length(details) <= 1000)
  )
);
alter table public.reports add constraint reports_conversation_target_chk check (
  target_type::text <> 'conversation' or kind = 'message_report'
);

-- Jedna otwarta sprawa na wiadomość; na rozmowę — jedna na zgłaszającego.
create unique index if not exists reports_message_open_uq
  on public.reports(target_id)
  where kind = 'message_report' and target_type = 'message' and status in ('open', 'reviewing');
create unique index if not exists reports_conversation_open_uq
  on public.reports(target_id, reporter_id)
  where kind = 'message_report' and target_type <> 'message' and status in ('open', 'reviewing');
create index if not exists reports_message_report_reporter_idx
  on public.reports(reporter_id, created_at desc) where kind = 'message_report';

-- --- 2. Dowód tylko dla administratora ----------------------------------------------------
drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter_id = auth.uid() and kind <> 'message_report');

-- --- 3. Niezmienność zgłoszenia wiadomości ------------------------------------------------
create or replace function public.reports_message_report_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_state constant text[] := array['status', 'resolved_by', 'resolved_at', 'updated_at', 'reporter_id'];
begin
  if tg_op = 'DELETE' then
    if old.kind = 'message_report' then
      raise exception 'PERMISSION_DENIED: zgłoszenia wiadomości nie można usunąć' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.kind = 'message_report' or new.kind = 'message_report' then
    if (to_jsonb(new) - v_state) is distinct from (to_jsonb(old) - v_state)
       or (new.reporter_id is distinct from old.reporter_id and new.reporter_id is not null) then
      raise exception 'PERMISSION_DENIED: treść zgłoszenia jest niezmienna' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.reports_message_report_immutable() from public;

drop trigger if exists trg_reports_message_report_immutable on public.reports;
create trigger trg_reports_message_report_immutable
  before update or delete on public.reports
  for each row execute function public.reports_message_report_immutable();

-- --- 4. Zgłoszenie (RPC pod sesją) --------------------------------------------------------
-- `p_message_id` null = cała rozmowa. Wynik `outcome`:
--   created      — nowe zgłoszenie,
--   duplicate    — ten sam klucz idempotencji (ponowienie tego samego wysłania),
--   already_open — sprawa tej treści jest już otwarta (bez identyfikatora cudzej sprawy).
-- Obca/nieistniejąca rozmowa i wiadomość spoza rozmowy dają ten sam NOT_FOUND.
create or replace function public.report_conversation_content(
  p_conversation_id uuid,
  p_message_id      uuid,
  p_category        text,
  p_details         text,
  p_idempotency_key uuid
) returns table (report_id uuid, outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid         uuid := auth.uid();
  v_details     text := nullif(btrim(coalesce(p_details, '')), '');
  v_existing    record;
  v_conv        record;
  v_msg         record;
  v_target_type public.report_target_type;
  v_target      uuid;
  v_sender_side text;
  v_my_side     text;
  v_snapshot    jsonb;
  v_id          uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_idempotency_key is null then
    raise exception 'VALIDATION_FAILED: brak klucza idempotencji' using errcode = '22023';
  end if;
  if p_category is null or p_category not in
     ('spam', 'harassment', 'fraud', 'discrimination', 'inappropriate', 'data_misuse', 'other') then
    raise exception 'VALIDATION_FAILED: kategoria' using errcode = '22023';
  end if;
  if v_details is not null and char_length(v_details) > 1000 then
    raise exception 'VALIDATION_FAILED: opis' using errcode = '22023';
  end if;

  v_target := coalesce(p_message_id, p_conversation_id);

  -- Ten sam klucz = to samo wysłanie (także przy wyścigu dwóch żądań).
  perform pg_advisory_xact_lock(hashtextextended('report:' || p_idempotency_key::text, 0));
  select r.id, r.kind, r.reporter_id, r.target_id, r.conversation_id into v_existing
    from public.reports r where r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.kind = 'message_report' and v_existing.reporter_id = v_uid
       and v_existing.conversation_id = p_conversation_id and v_existing.target_id = v_target then
      return query select v_existing.id, 'duplicate'::text;
      return;
    end if;
    raise exception 'VALIDATION_FAILED: klucz idempotencji użyty dla innego zgłoszenia' using errcode = '22023';
  end if;

  -- Tylko uczestnik z bieżącym dostępem (strona firmowa: aktywny recruiter+).
  if p_conversation_id is null or not public.is_conversation_member(p_conversation_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select c.id, c.company_id, c.job_id, c.application_id, c.offer_id, c.created_at, c.last_message_at,
         co.name as company_name, j.title as job_title
    into v_conv
    from public.conversations c
    left join public.companies co on co.id = c.company_id
    left join public.jobs j on j.id = c.job_id
    where c.id = p_conversation_id and c.deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_my_side := case
    when v_conv.company_id is not null and exists (
      select 1 from public.company_members m where m.company_id = v_conv.company_id and m.profile_id = v_uid)
    then 'company' else 'candidate' end;

  if p_message_id is not null then
    select m.id, m.body, m.sender_id, m.is_system, m.created_at into v_msg
      from public.messages m
      where m.id = p_message_id and m.conversation_id = p_conversation_id and m.deleted_at is null;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    v_sender_side := case
      when v_conv.company_id is not null and v_msg.sender_id is not null and exists (
        select 1 from public.company_members m where m.company_id = v_conv.company_id and m.profile_id = v_msg.sender_id)
      then 'company' else 'candidate' end;
    -- Zgłasza się wiadomość drugiej strony — nie własną ani komunikat systemowy.
    if v_msg.is_system or v_msg.sender_id = v_uid or v_sender_side = v_my_side then
      raise exception 'VALIDATION_FAILED: wiadomości nie można zgłosić' using errcode = '22023';
    end if;
    v_target_type := 'message';
  else
    v_target_type := 'conversation';
  end if;

  -- Limit w bazie: 20 zgłoszeń wiadomości / konto / 24 h.
  if (select count(*) from public.reports r
        where r.kind = 'message_report' and r.reporter_id = v_uid
          and r.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;

  -- Jedna otwarta sprawa na treść (blokada rozstrzyga wyścig różnych kluczy).
  perform pg_advisory_xact_lock(hashtextextended('message-report:' || v_target::text, 0));
  if exists (
    select 1 from public.reports r
     where r.kind = 'message_report' and r.target_type = v_target_type and r.target_id = v_target
       and r.status in ('open', 'reviewing')
       and (v_target_type = 'message' or r.reporter_id = v_uid)) then
    return query select null::uuid, 'already_open'::text;
    return;
  end if;

  v_snapshot := jsonb_build_object(
    'capturedAt', now(),
    'scope', v_target_type::text,
    'conversation', jsonb_build_object(
      'id', v_conv.id, 'companyId', v_conv.company_id, 'companyName', v_conv.company_name,
      'jobId', v_conv.job_id, 'jobTitle', v_conv.job_title,
      'applicationId', v_conv.application_id, 'offerId', v_conv.offer_id,
      'createdAt', v_conv.created_at, 'lastMessageAt', v_conv.last_message_at,
      'reporterSide', v_my_side,
      'messageCount', (select count(*) from public.messages m
                         where m.conversation_id = v_conv.id and m.deleted_at is null)));
  if p_message_id is not null then
    v_snapshot := v_snapshot || jsonb_build_object('message', jsonb_build_object(
      'id', v_msg.id, 'body', v_msg.body, 'createdAt', v_msg.created_at,
      'senderId', v_msg.sender_id, 'senderSide', v_sender_side));
  end if;

  begin
    insert into public.reports(
      reporter_id, target_type, target_id, reason, details, status, kind,
      idempotency_key, category, target_snapshot, conversation_id)
    values (
      v_uid, v_target_type, v_target, p_category, v_details, 'open', 'message_report',
      p_idempotency_key, p_category, v_snapshot, p_conversation_id)
    returning id into v_id;
  exception when unique_violation then
    return query select null::uuid, 'already_open'::text;
    return;
  end;

  return query select v_id, 'created'::text;
end $$;
revoke all on function public.report_conversation_content(uuid, uuid, text, text, uuid)
  from public, anon;
grant execute on function public.report_conversation_content(uuid, uuid, text, text, uuid)
  to authenticated;

-- --- 5. Stan własnych zgłoszeń w rozmowie -------------------------------------------------
-- Bez dowodu, opisu i cudzych zgłoszeń; tylko dla uczestnika z bieżącym dostępem.
create or replace function public.get_my_message_reports(p_conversation_id uuid)
returns table (target_type text, target_id uuid, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_conversation_member(p_conversation_id) then
    return;
  end if;
  return query
    select r.target_type::text, r.target_id, r.status::text, r.created_at
      from public.reports r
     where r.kind = 'message_report' and r.reporter_id = auth.uid()
       and r.conversation_id = p_conversation_id
     order by r.created_at desc;
end $$;
revoke all on function public.get_my_message_reports(uuid) from public, anon;
grant execute on function public.get_my_message_reports(uuid) to authenticated;
