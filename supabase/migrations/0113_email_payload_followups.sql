-- =============================================================================
-- 0113 — uzupełnienia payloadów e-maili i odczytu historii zgłoszeń
--        (#293, #22, #290, #184).
--
-- 1. send_offer (#293, #22): payload `jobOffer` niesie termin odpowiedzi `expiresAt`
--    (ISO 8601, ten sam `offers.expires_at`, który sprawdza respond_to_offer) oraz KWOTY
--    oferty (`salaryMin`/`salaryMax`/`salaryPeriod`/`currency` z `jobs`). Tekst terminu
--    i wynagrodzenia składa worker w locale ODBIORCY (Invariant #1:
--    `src/lib/email/delivery-data.ts` → `deliverySalary`, szablon `formatEmailDate`),
--    nie nadawca. Oferta bez kwot = null → pole wynagrodzenia pominięte.
--    Świadomie BEZ `message`: wiadomość rekrutera to tekst wolny (może zawierać dane
--    osobowe i jest korespondencją), a #503 wymaga osobnej oceny przed wysłaniem takiej
--    treści przez dostawcę poczty. Kandydat czyta ją w panelu (`/candidate/propozycje`).
--    Reszta ciała skopiowana 1:1 z 0049 (search_path uzupełniony o pg_temp).
--
-- 2. send_message (#290): payload `newMessage` niesie `conversationId`, więc przycisk
--    prowadzi do właściwego wątku (`?c=<id>`, worker przyjmuje tylko UUID). Reszta ciała
--    skopiowana 1:1 z 0075.
--
-- 3. get_applied_jobs_display (#184): opcjonalny `p_job_ids uuid[]` zawęża wynik WEWNĄTRZ
--    funkcji (SECURITY DEFINER nie jest inline'owana, więc filtr `WHERE` wywołującego nie
--    ograniczał pracy bazy — liczyła całą historię). Null = dotychczasowe zachowanie.
--    Więcej niż 100 identyfikatorów → VALIDATION_FAILED (strona historii ma 10).
--    Autoryzacja bez zmian: wyłącznie aplikacje auth.uid(). Stary podpis (text) usuwany,
--    żeby wywołanie nazwane `p_locale => …` nie było niejednoznaczne.
--
-- Rollback: odtworzyć send_offer z 0049, send_message z 0075 (z grantami z 0075)
-- i get_applied_jobs_display(text) z 0023; usunąć get_applied_jobs_display(text, uuid[]).
-- Migracja nie zmienia danych.
-- =============================================================================

-- --- 1. send_offer --------------------------------------------------------------
create or replace function public.send_offer(
  p_job_id uuid,
  p_candidate_id uuid,
  p_idempotency_key text,
  p_message text default null,
  p_expires_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_offer_id uuid; v_locale text; v_job_title text; v_company_name text;
        v_company uuid; v_related boolean; v_existing uuid; v_job_expires timestamptz; v_expires timestamptz;
        v_salary_min integer; v_salary_max integer; v_currency text; v_salary_period public.salary_period;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  select j.company_id, j.title, c.name, j.expires_at, j.salary_min, j.salary_max, j.currency, j.salary_period
    into v_company, v_job_title, v_company_name, v_job_expires, v_salary_min, v_salary_max, v_currency, v_salary_period
    from public.jobs j join public.companies c on c.id = j.company_id where j.id = p_job_id;
  if v_company is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  -- P2-03: domyślny termin ważności propozycji, gdy nie podano jawnie. least() ignoruje NULL,
  -- więc dla oferty bez expires_at wychodzi now()+30 dni; z expires_at — wcześniejsza z dat.
  v_expires := coalesce(p_expires_at, least(v_job_expires, now() + interval '30 days'));

  -- Relacja: kandydat aplikował do oferty tej firmy LUB profil jest wyszukiwalny i kompletny.
  select exists (
    select 1 from public.applications a where a.candidate_id = p_candidate_id and a.company_id = v_company
    union all
    select 1 from public.candidate_profiles cp
      where cp.profile_id = p_candidate_id and cp.is_searchable = true and cp.profile_completed = true
  ) into v_related;
  if not v_related then
    raise exception 'PERMISSION_DENIED: brak relacji firma–kandydat dla propozycji' using errcode = '42501';
  end if;

  -- Idempotencja po kluczu (retry z tym samym kluczem).
  select id into v_offer_id from public.offers where idempotency_key = p_idempotency_key;
  if v_offer_id is not null then return v_offer_id; end if;

  -- Idempotencja po AKTYWNEJ parze (retry z innym kluczem nie tworzy dubletu).
  select id into v_existing from public.offers
    where job_id = p_job_id and candidate_id = p_candidate_id
      and status in ('sent', 'viewed') and deleted_at is null
    order by created_at desc limit 1;
  if v_existing is not null then return v_existing; end if;

  v_locale := public.resolve_recipient_locale(p_candidate_id);

  -- Wstawienie z obsługą wyścigu (klucz LUB partial-unique aktywnej pary).
  begin
    insert into public.offers
      (job_id, candidate_id, status, message, locale, idempotency_key, sent_at, expires_at)
    values
      (p_job_id, p_candidate_id, 'sent', coalesce(p_message, ''), v_locale, p_idempotency_key, now(), v_expires)
    returning id into v_offer_id;
  exception when unique_violation then
    select id into v_offer_id from public.offers where idempotency_key = p_idempotency_key;
    if v_offer_id is null then
      select id into v_offer_id from public.offers
        where job_id = p_job_id and candidate_id = p_candidate_id
          and status in ('sent', 'viewed') and deleted_at is null
        order by created_at desc limit 1;
    end if;
    return v_offer_id; -- duplikat/współbieżny → bez powtórnych powiadomień
  end;

  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    values (p_candidate_id, 'offer_received', 'offer_received', 'offer', v_offer_id);
  -- #293/#22: termin i kwoty jako dane (bez gotowego tekstu) — worker formatuje w locale
  -- odbiorcy. Bez treści wiadomości rekrutera (#503).
  perform public.enqueue_email(p_candidate_id, 'jobOffer', 'offer', v_offer_id, 'offer-' || v_offer_id::text,
                               jsonb_build_object('companyName', coalesce(v_company_name, ''),
                                                  'jobTitle', coalesce(v_job_title, ''),
                                                  'expiresAt', v_expires,
                                                  'salaryMin', v_salary_min,
                                                  'salaryMax', v_salary_max,
                                                  'salaryPeriod', v_salary_period::text,
                                                  'currency', v_currency));
  return v_offer_id;
end $$;

-- --- 2. send_message ------------------------------------------------------------
create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text,
  p_client_message_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_msg_id uuid;
  v_sender_name text;
  v_company uuid;
  v_company_name text;
  v_sender_is_company boolean := false;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_client_message_id is null then
    raise exception 'VALIDATION_FAILED: brak identyfikatora operacji' using errcode = '42501';
  end if;
  if length(v_body) = 0 or length(v_body) > 5000 then
    raise exception 'VALIDATION_FAILED: treść wiadomości poza dozwolonym zakresem'
      using errcode = '42501';
  end if;

  -- Unikalny indeks rozstrzyga ponowienia i równoległe próby tej samej operacji.
  insert into public.messages (conversation_id, sender_id, body, client_message_id)
    values (p_conversation_id, v_uid, v_body, p_client_message_id)
    on conflict (conversation_id, sender_id, client_message_id)
      where client_message_id is not null
      do nothing
    returning id into v_msg_id;

  if v_msg_id is null then
    -- Ta operacja została już zapisana (np. odpowiedź zginęła po commicie): zwracamy
    -- istniejącą wiadomość bez drugiego powiadomienia i e-maila.
    select m.id into v_msg_id
      from public.messages m
      where m.conversation_id = p_conversation_id
        and m.sender_id = v_uid
        and m.client_message_id = p_client_message_id;
    return v_msg_id;
  end if;

  update public.conversations
    set last_message_at = now(), updated_at = now()
    where id = p_conversation_id
    returning company_id into v_company;

  if v_company is not null then
    select c.name into v_company_name from public.companies c where c.id = v_company;
    v_sender_is_company := exists (
      select 1 from public.company_members m where m.company_id = v_company and m.profile_id = v_uid);
  end if;
  v_sender_name := coalesce(public.profile_full_name(v_uid), '—');

  -- Odbiorcy: pozostali uczestnicy; członek firmy rozmowy tylko jako aktywny recruiter+.
  -- Powiadomienie in-app dla uprawnionych odbiorców.
  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    select r.profile_id, 'message_received', 'message_received', 'conversation', p_conversation_id
    from (
      select cm.profile_id,
             exists (select 1 from public.company_members m
                     where m.company_id = v_company and m.profile_id = cm.profile_id) as is_company
      from public.conversation_members cm
      where cm.conversation_id = p_conversation_id and cm.profile_id <> v_uid
    ) r
    where not r.is_company or public.company_recipient_ok(v_company, r.profile_id);

  -- E-mail dla niewyciszonych (idempotentnie: klucz per wiadomość+odbiorca).
  -- Odbiorca spoza firmy nie dostaje danych osobowych piszącego członka firmy.
  -- #290: conversationId → przycisk prowadzi do właściwego wątku.
  perform public.enqueue_email(
            r.profile_id, 'newMessage', 'message', v_msg_id,
            'msg-' || v_msg_id::text || '-' || r.profile_id::text,
            jsonb_build_object(
              'senderName', case
                when v_sender_is_company and not r.is_company then coalesce(v_company_name, '—')
                else v_sender_name
              end,
              'panel', case when p.role = 'employer' then 'employer' else 'candidate' end,
              'conversationId', p_conversation_id))
    from (
      select cm.profile_id,
             exists (select 1 from public.company_members m
                     where m.company_id = v_company and m.profile_id = cm.profile_id) as is_company
      from public.conversation_members cm
      where cm.conversation_id = p_conversation_id and cm.profile_id <> v_uid and cm.is_muted = false
    ) r
    join public.profiles p on p.id = r.profile_id
    where not r.is_company or public.company_recipient_ok(v_company, r.profile_id);

  return v_msg_id;
end $$;

revoke all on function public.send_message(uuid, text, uuid) from public;
grant execute on function public.send_message(uuid, text, uuid) to authenticated;

-- --- 3. get_applied_jobs_display(p_locale, p_job_ids) -------------------------------
drop function if exists public.get_applied_jobs_display(text);

create or replace function public.get_applied_jobs_display(
  p_locale text default 'pl',
  p_job_ids uuid[] default null
)
returns table (
  job_id uuid,
  slug text,
  title text,
  company_name text,
  city text
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_job_ids is not null and coalesce(cardinality(p_job_ids), 0) > 100 then
    raise exception 'VALIDATION_FAILED: za dużo identyfikatorów ofert' using errcode = '22023';
  end if;

  return query
  select distinct on (j.id)
    j.id,
    j.slug,
    coalesce(t.title, j.title) as title,
    coalesce(c.name, '') as company_name,
    j.city
  from public.applications a
  join public.jobs j on j.id = a.job_id
  left join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = p_locale) desc, (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where a.candidate_id = auth.uid()
    and a.deleted_at is null
    and (p_job_ids is null or a.job_id = any(p_job_ids));
end $$;

revoke all on function public.get_applied_jobs_display(text, uuid[]) from public;
grant execute on function public.get_applied_jobs_display(text, uuid[]) to authenticated;
