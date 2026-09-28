-- =============================================================================
-- 0940 — Narzędzia rekrutera (numer TYMCZASOWY; ostateczny nada integrator)
-- =============================================================================
-- 1. Limit e-maili o zmianie statusu (ustalenie audytu LIM17-01).
--    `application_status_email_gate(application, target)` wołane przez
--    transition_application PRZED kolejkowaniem e-maila o statusie:
--      a) scalanie — niewysłany (queued, bez dzierżawy workera) e-mail o statusie TEGO
--         zgłoszenia jest wygaszany ('failed' + suppressed_at, 'suppressed_superseded'):
--         kandydat dostaje tylko najnowszy status, a nie serię przejść;
--      b) sufit — przejścia pośrednie (viewed/shortlisted/interview, jedyne, które da się
--         powtarzać w cyklu shortlisted ↔ interview) wysyłają najwyżej 3 e-maile na
--         zgłoszenie w 24 h; przejścia końcowe (offer_sent/rejected/hired) zawsze wysyłają
--         (są skończone — z rejected/hired nie ma wyjścia).
--    Dotyczy konta (statusChanged/applicationViewed) i gościa (guestStatusChanged).
--    Powiadomienie in-app, historia i audyt bez zmian. Limiter per konto dokłada akcja.
-- 2. bulk_transition_applications(company, ids[], target) — akcja zbiorcza: najwyżej 50
--    zgłoszeń AKTYWNEJ firmy rekrutera, każde przez istniejące transition_application
--    (ta sama macierz przejść, CAS, historia, e-mail z bramką z pkt 1) w osobnym
--    podbloku (savepoint): błąd jednego wiersza nie cofa pozostałych. Wynik per wiersz:
--    changed / unchanged / invalid_transition / not_found / permission_denied / error.
--    SECURITY INVOKER — odczyt stanu pod RLS rekrutera; ponowienie = 'unchanged'.
-- 3. Szablony odpowiedzi firmy: company_message_templates (+ warianty językowe
--    company_message_template_variants, pl/nl/fr/en). Odczyt pod RLS tylko recruiter+
--    firmy; zapis wyłącznie RPC save_/delete_company_message_template (limit 50 na firmę,
--    CAS po updated_at → STALE_STATE). get_conversation_template_context(conversation)
--    zwraca rekruterowi JĘZYK kandydata (resolve_recipient_locale, Invariant #1), firmę
--    i tytuł oferty rozmowy — bez innych danych kandydata.
--
-- Rollback: odtworzyć transition_application z 0122; DROP FUNCTION
-- bulk_transition_applications, application_status_email_gate,
-- save_company_message_template, delete_company_message_template,
-- get_conversation_template_context; DROP TABLE company_message_template_variants,
-- company_message_templates. Migracja nie zmienia istniejących danych.
-- =============================================================================

-- --- 1. Bramka e-maili o statusie ------------------------------------------------------------
create or replace function public.application_status_email_gate(
  p_application_id uuid,
  p_target public.application_status
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_recent integer;
begin
  -- a) Scalanie: najnowszy status zastępuje jeszcze niewysłany e-mail o poprzednim.
  update public.email_deliveries
     set status = 'failed', suppressed_at = now(), error_message = 'suppressed_superseded',
         updated_at = now()
   where entity_type = 'application'
     and entity_id = p_application_id
     and template in ('statusChanged', 'applicationViewed', 'guestStatusChanged')
     and status = 'queued'
     and locked_at is null
     and sent_at is null;

  -- b) Przejścia końcowe są skończone — zawsze informujemy kandydata.
  if p_target in ('offer_sent', 'rejected', 'hired') then return true; end if;

  select count(*) into v_recent
    from public.email_deliveries
   where entity_type = 'application'
     and entity_id = p_application_id
     and template in ('statusChanged', 'applicationViewed', 'guestStatusChanged')
     and created_at > now() - interval '24 hours'
     and error_message is distinct from 'suppressed_superseded';
  return v_recent < 3;
end $$;
comment on function public.application_status_email_gate(uuid, public.application_status) is
  'LIM17-01: scala niewysłane e-maile o statusie zgłoszenia i ogranicza przejścia pośrednie do 3 e-maili/24 h.';
revoke all on function public.application_status_email_gate(uuid, public.application_status)
  from public, anon, authenticated;

-- transition_application (0122) + bramka z pkt 1 (reszta bez zmian).
create or replace function public.transition_application(
  p_application_id uuid,
  p_target text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_job uuid; v_candidate uuid; v_from public.application_status;
        v_to public.application_status; v_job_title text; v_company_name text; v_allowed boolean;
        v_history uuid; v_guest_name text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  if p_target is null or p_target not in ('viewed','shortlisted','interview','offer_sent','rejected','hired') then
    raise exception 'VALIDATION_FAILED: niedozwolony status docelowy' using errcode = '42501';
  end if;
  v_to := p_target::public.application_status;

  select a.job_id, a.candidate_id, a.status, j.title, c.name, a.guest_name
    into v_job, v_candidate, v_from, v_job_title, v_company_name, v_guest_name
    from public.applications a
    join public.jobs j on j.id = a.job_id
    join public.companies c on c.id = j.company_id
    where a.id = p_application_id
    for update of a;

  if v_job is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_job_manager(v_job) then
    raise exception 'PERMISSION_DENIED: zmiana statusu wymaga roli recruiter+' using errcode = '42501';
  end if;
  if v_from = v_to then return; end if; -- idempotencja (retry nie tworzy przejścia ani e-maila)

  v_allowed := case v_from
    when 'draft'       then v_to in ('viewed','shortlisted','interview','offer_sent','rejected')
    when 'submitted'   then v_to in ('viewed','shortlisted','interview','offer_sent','rejected')
    when 'viewed'      then v_to in ('shortlisted','interview','offer_sent','rejected','hired')
    when 'shortlisted' then v_to in ('interview','offer_sent','rejected','hired')
    when 'interview'   then v_to in ('shortlisted','offer_sent','rejected','hired')
    when 'offer_sent'  then v_to in ('hired','rejected')
    else false
  end;
  if not v_allowed then
    raise exception 'VALIDATION_FAILED: niedozwolone przejście statusu % -> %', v_from, v_to
      using errcode = '42501';
  end if;

  update public.applications set status = v_to, updated_at = now()
    where id = p_application_id and status = v_from;
  if not found then
    raise exception 'VALIDATION_FAILED: stan aplikacji zmienił się równolegle' using errcode = '42501';
  end if;

  select h.id into v_history
    from public.application_status_history h
    where h.application_id = p_application_id and h.from_status = v_from and h.to_status = v_to
    order by h.created_at desc, h.id desc
    limit 1;
  if v_history is null then
    raise exception 'INTERNAL: brak wpisu historii statusu' using errcode = 'P0001';
  end if;

  -- #98: aplikacja gościa (bez konta) — bez powiadomienia in-app (brak profilu), e-mail na
  -- adres gościa w języku jego formularza (warunki w enqueue_guest_status_email).
  if v_candidate is null then
    if public.application_status_email_gate(p_application_id, v_to) then
      perform public.enqueue_guest_status_email(p_application_id, 'guestStatusChanged',
                                   'appstatus-' || p_application_id::text || '-' || v_history::text,
                                   jsonb_build_object('recipientName', coalesce(v_guest_name, ''),
                                                      'companyName', coalesce(v_company_name, ''),
                                                      'jobTitle', coalesce(v_job_title, ''),
                                                      'status', v_to::text));
    end if;
    return;
  end if;

  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    values (v_candidate, 'application_status_changed', 'application_status_changed', 'application', p_application_id);

  -- 0940 (LIM17-01): scalanie + sufit e-maili o statusie tego zgłoszenia.
  if not public.application_status_email_gate(p_application_id, v_to) then return; end if;

  if v_to = 'viewed' then
    perform public.enqueue_email(v_candidate, 'applicationViewed', 'application', p_application_id,
                                 'appstatus-' || p_application_id::text || '-' || v_history::text,
                                 jsonb_build_object('companyName', coalesce(v_company_name, ''),
                                                    'jobTitle', coalesce(v_job_title, '')));
  else
    perform public.enqueue_email(v_candidate, 'statusChanged', 'application', p_application_id,
                                 'appstatus-' || p_application_id::text || '-' || v_history::text,
                                 jsonb_build_object('companyName', coalesce(v_company_name, ''),
                                                    'jobTitle', coalesce(v_job_title, ''),
                                                    'status', v_to::text));
  end if;
end $$;

-- --- 2. Akcja zbiorcza -------------------------------------------------------------------------
create or replace function public.bulk_transition_applications(
  p_company_id uuid,
  p_application_ids uuid[],
  p_target text
) returns table (application_id uuid, outcome text)
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_id uuid; v_status public.application_status; v_count integer;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_company_id is null or not public.can_manage_jobs(p_company_id) then
    raise exception 'PERMISSION_DENIED: akcja zbiorcza wymaga roli recruiter+' using errcode = '42501';
  end if;
  if p_target is null or p_target not in ('viewed','shortlisted','interview','offer_sent','rejected','hired') then
    raise exception 'VALIDATION_FAILED: niedozwolony status docelowy' using errcode = '42501';
  end if;
  v_count := coalesce(cardinality(p_application_ids), 0);
  if v_count < 1 or v_count > 50 or array_position(p_application_ids, null) is not null
     or (select count(distinct x) from unnest(p_application_ids) x) <> v_count then
    raise exception 'VALIDATION_FAILED: od 1 do 50 różnych zgłoszeń' using errcode = '42501';
  end if;

  -- Stała kolejność blokad (FOR UPDATE w transition_application) — bez zakleszczeń
  -- między dwiema równoległymi operacjami zbiorczymi.
  for v_id in select x from unnest(p_application_ids) x order by x loop
    application_id := v_id;
    select a.status into v_status
      from public.applications a
     where a.id = v_id and a.company_id = p_company_id and a.deleted_at is null;
    if not found then
      outcome := 'not_found';
    elsif v_status::text = p_target then
      outcome := 'unchanged';
    else
      begin
        perform public.transition_application(v_id, p_target);
        outcome := 'changed';
      exception when others then
        outcome := case
          when sqlerrm like '%niedozwolone przejście%' or sqlerrm like '%zmienił się równolegle%'
            then 'invalid_transition'
          when sqlerrm like 'PERMISSION_DENIED%' then 'permission_denied'
          when sqlerrm like 'NOT_FOUND%' then 'not_found'
          else 'error'
        end;
      end;
    end if;
    return next;
  end loop;
end $$;
comment on function public.bulk_transition_applications(uuid, uuid[], text) is
  'Zmiana statusu do 50 zgłoszeń firmy przez transition_application, wynik per wiersz (0940).';
revoke all on function public.bulk_transition_applications(uuid, uuid[], text) from public, anon;
grant execute on function public.bulk_transition_applications(uuid, uuid[], text) to authenticated;

-- --- 3. Szablony odpowiedzi firmy --------------------------------------------------------------
create table if not exists public.company_message_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint company_message_templates_name_length check (char_length(btrim(name)) between 1 and 80)
);
create index if not exists idx_company_message_templates_company
  on public.company_message_templates(company_id, lower(name));
comment on table public.company_message_templates is
  'Szablony odpowiedzi firmy (0940). Odczyt recruiter+ firmy, zapis tylko RPC.';

create table if not exists public.company_message_template_variants (
  template_id uuid not null references public.company_message_templates(id) on delete cascade,
  locale      text not null references public.supported_locales(code),
  body        text not null,
  primary key (template_id, locale),
  constraint company_message_template_variants_body_length
    check (char_length(btrim(body)) between 1 and 4000)
);
comment on table public.company_message_template_variants is
  'Wariant językowy szablonu odpowiedzi (pl/nl/fr/en) — wybierany wg języka kandydata (0940).';

alter table public.company_message_templates enable row level security;
alter table public.company_message_templates force row level security;
alter table public.company_message_template_variants enable row level security;
alter table public.company_message_template_variants force row level security;

revoke all on public.company_message_templates from public, anon, authenticated;
revoke all on public.company_message_template_variants from public, anon, authenticated;
grant select on public.company_message_templates to authenticated;
grant select on public.company_message_template_variants to authenticated;
grant select, insert, update, delete on public.company_message_templates to service_role;
grant select, insert, update, delete on public.company_message_template_variants to service_role;

drop policy if exists company_message_templates_select on public.company_message_templates;
create policy company_message_templates_select on public.company_message_templates
  for select to authenticated using (public.can_manage_jobs(company_id));
drop policy if exists company_message_template_variants_select on public.company_message_template_variants;
create policy company_message_template_variants_select on public.company_message_template_variants
  for select to authenticated using (exists (
    select 1 from public.company_message_templates t
     where t.id = template_id and public.can_manage_jobs(t.company_id)));

-- Zapis: nowy (p_template_id null) albo edycja; warianty replace-all. p_variants =
-- {"pl": "…", "nl": "…"} — co najmniej jeden język serwisu, puste pomijane.
create or replace function public.save_company_message_template(
  p_company_id uuid,
  p_template_id uuid,
  p_name text,
  p_variants jsonb,
  p_expected_updated_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_updated timestamptz; v_key text; v_body text;
        v_n integer := 0;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_company_id is null or not public.can_manage_jobs(p_company_id) then
    raise exception 'PERMISSION_DENIED: szablony wymagają roli recruiter+' using errcode = '42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception 'VALIDATION_FAILED: nazwa szablonu' using errcode = '42501';
  end if;
  if p_variants is null or jsonb_typeof(p_variants) <> 'object' then
    raise exception 'VALIDATION_FAILED: warianty szablonu' using errcode = '42501';
  end if;
  for v_key, v_body in select key, value #>> '{}' from jsonb_each(p_variants) loop
    if not coalesce(public.is_supported_locale(v_key), false)
       or jsonb_typeof(p_variants -> v_key) <> 'string' then
      raise exception 'VALIDATION_FAILED: język wariantu' using errcode = '42501';
    end if;
    if char_length(btrim(v_body)) > 4000 then
      raise exception 'VALIDATION_FAILED: treść wariantu za długa' using errcode = '42501';
    end if;
    if char_length(btrim(v_body)) > 0 then v_n := v_n + 1; end if;
  end loop;
  if v_n = 0 then
    raise exception 'VALIDATION_FAILED: szablon bez treści' using errcode = '42501';
  end if;

  if p_template_id is null then
    -- Limit na firmę pod blokadą doradczą (dwa równoległe zapisy nie omijają limitu).
    perform pg_advisory_xact_lock(hashtextextended('company_message_templates:' || p_company_id::text, 0));
    if (select count(*) from public.company_message_templates where company_id = p_company_id) >= 50 then
      raise exception 'TEMPLATE_LIMIT: najwyżej 50 szablonów na firmę' using errcode = '42501';
    end if;
    insert into public.company_message_templates(company_id, name, created_by)
      values (p_company_id, btrim(p_name), v_uid) returning id into v_id;
  else
    select id, updated_at into v_id, v_updated
      from public.company_message_templates
     where id = p_template_id and company_id = p_company_id
     for update;
    if v_id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if p_expected_updated_at is not null and v_updated <> p_expected_updated_at then
      raise exception 'STALE_STATE: szablon zmieniono równolegle' using errcode = '42501';
    end if;
    update public.company_message_templates set name = btrim(p_name), updated_at = now()
      where id = v_id;
    delete from public.company_message_template_variants where template_id = v_id;
  end if;

  insert into public.company_message_template_variants(template_id, locale, body)
    select v_id, key, btrim(value #>> '{}') from jsonb_each(p_variants)
     where char_length(btrim(value #>> '{}')) > 0;
  return v_id;
end $$;
revoke all on function public.save_company_message_template(uuid, uuid, text, jsonb, timestamptz) from public, anon;
grant execute on function public.save_company_message_template(uuid, uuid, text, jsonb, timestamptz) to authenticated;

create or replace function public.delete_company_message_template(
  p_company_id uuid,
  p_template_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_company_id is null or not public.can_manage_jobs(p_company_id) then
    raise exception 'PERMISSION_DENIED: szablony wymagają roli recruiter+' using errcode = '42501';
  end if;
  delete from public.company_message_templates where id = p_template_id and company_id = p_company_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.delete_company_message_template(uuid, uuid) from public, anon;
grant execute on function public.delete_company_message_template(uuid, uuid) to authenticated;

-- Kontekst kompozytora rekrutera: język kandydata rozmowy (Invariant #1) + firma i oferta.
-- Brak wiersza = rozmowa niefirmowa, brak dostępu recruiter+ albo nie ma strony kandydata.
create or replace function public.get_conversation_template_context(p_conversation_id uuid)
returns table (company_id uuid, company_name text, job_title text, candidate_locale text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid; v_job uuid; v_candidate uuid;
begin
  if auth.uid() is null then return; end if;
  select c.company_id, c.job_id into v_company, v_job
    from public.conversations c
   where c.id = p_conversation_id and c.deleted_at is null;
  if v_company is null then return; end if;
  if not public.is_conversation_member(p_conversation_id) or not public.can_manage_jobs(v_company) then
    return;
  end if;
  select m.profile_id into v_candidate
    from public.conversation_members m
    join public.profiles p on p.id = m.profile_id
   where m.conversation_id = p_conversation_id and p.role = 'candidate'
   order by m.profile_id
   limit 1;
  if v_candidate is null then return; end if;

  company_id := v_company;
  select co.name into company_name from public.companies co where co.id = v_company;
  select j.title into job_title from public.jobs j where j.id = v_job and j.company_id = v_company;
  candidate_locale := public.resolve_recipient_locale(v_candidate);
  return next;
end $$;
revoke all on function public.get_conversation_template_context(uuid) from public, anon;
grant execute on function public.get_conversation_template_context(uuid) to authenticated;
