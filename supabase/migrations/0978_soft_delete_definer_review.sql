-- =============================================================================
-- 0978 — numer tymczasowy (nadaje integrator). Audyt 2026-09-28: DC-06 (#1111), część 2.
-- Zależy od 0966 (#1202: polityki odczytu i strażnik `trg_soft_delete_contract`).
--
-- Przegląd wszystkich funkcji SECURITY DEFINER czytających albo zmieniających tabele z kolumną
-- `deleted_at` (profiles, candidate_profiles, companies, employer_profiles, jobs, applications,
-- offers, conversations, messages, files). Funkcje SECURITY DEFINER omijają RLS, więc warunek
-- `deleted_at IS NULL` z polityk 0966 ich nie obejmuje. Poprawione tu (pomijają albo odrzucają
-- usunięty wiersz):
--   * is_admin, current_profile_role — usunięty profil nie ma roli (current_profile_role zwraca
--     '' zamiast NULL, więc wzorzec `current_profile_role() <> 'candidate'` odrzuca także brak
--     profilu — dotąd NULL przepuszczał warunek);
--   * can_access_application, can_access_offer, is_job_company_member, is_job_manager,
--     is_conversation_member, conversation_created_by_me, owns_candidate_profile — pomocnicze
--     funkcje RLS i RPC: usunięty wiersz nie daje dostępu (get_or_create_conversation, załączniki,
--     wysyłka wiadomości i relacje profilu dziedziczą kontrolę);
--   * email_recipient_authorized — list o usuniętej aplikacji/propozycji/wiadomości (albo ofercie
--     lub rozmowie) jest wygaszany przy claimie i tuż przed wysyłką (fail-closed);
--   * ensure_candidate_profile — usunięty profil kandydata → NOT_FOUND (każde RPC profilu);
--   * apply_to_job — ponowienie trafiające na usuniętą aplikację → NOT_FOUND zamiast sukcesu;
--   * send_offer — usunięta oferta/firma → NOT_FOUND; usunięta aplikacja albo usunięty profil
--     nie tworzą relacji firma–kandydat.
-- Pozostałe funkcje: lista wyjątków z uzasadnieniem w tests/unit/soft-delete-contract.test.ts
-- (strażnik czyta najnowsze definicje z migracji). Ciała skopiowane z najnowszych definicji
-- (0019, 0040, 0039, 0009, 0033, 0171, 0123, 0175, 0093, 0150) — zmienione tylko warunki.
--
-- Rollback: supabase/rollback/0978_soft_delete_definer_review.down.sql.
-- =============================================================================

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and role = 'admin' and deleted_at is null);
$$;

create or replace function public.current_profile_role()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select role::text from public.profiles
                    where id = auth.uid() and deleted_at is null), '');
$$;

create or replace function public.can_access_application(p_application_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.applications a
    where a.id = p_application_id and a.deleted_at is null
      and (a.candidate_id = auth.uid() or public.is_job_manager(a.job_id))
  );
$$;

create or replace function public.can_access_offer(p_offer_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.offers o
    where o.id = p_offer_id and o.deleted_at is null
      and (o.candidate_id = auth.uid() or public.is_job_manager(o.job_id))
  );
$$;

create or replace function public.is_job_company_member(p_job_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.jobs j
    join public.company_members cm on cm.company_id = j.company_id
    where j.id = p_job_id
      and j.deleted_at is null
      and cm.profile_id = auth.uid()
      and cm.is_active = true
  );
$$;

create or replace function public.is_job_manager(p_job_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.jobs j
    join public.company_members cm on cm.company_id = j.company_id
    where j.id = p_job_id and j.deleted_at is null and cm.profile_id = auth.uid()
      and cm.is_active = true and cm.role in ('owner', 'admin', 'recruiter')
  );
$$;

create or replace function public.conversation_created_by_me(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and c.deleted_at is null
      and c.created_by = auth.uid()
  );
$$;

create or replace function public.owns_candidate_profile(p_candidate_profile_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.candidate_profiles cp
    where cp.id = p_candidate_profile_id
      and cp.deleted_at is null
      and cp.profile_id = auth.uid()
  );
$$;

create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
    where m.conversation_id = p_conversation_id
      and c.deleted_at is null
      and m.profile_id = auth.uid()
      and (
        c.company_id is null
        or public.can_manage_jobs(c.company_id)
        or m.profile_id = public.conversation_candidate(c.application_id, c.offer_id)
      )
      and (
        public.recruitment_enabled()
        or m.profile_id = public.conversation_candidate(c.application_id, c.offer_id)
      )
  );
$$;

create or replace function public.email_recipient_authorized(
  p_template text,
  p_entity_type text,
  p_entity_id uuid,
  p_profile_id uuid
) returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid;
begin
  if p_template in ('newApplication') then
    if p_entity_type is distinct from 'application' then return false; end if;
    select j.company_id into v_company
      from public.applications a join public.jobs j on j.id = a.job_id
     where a.id = p_entity_id and a.deleted_at is null and j.deleted_at is null;
    return v_company is not null and public.company_recipient_ok(v_company, p_profile_id);
  elsif p_template in ('offerAccepted', 'offerDeclined') then
    if p_entity_type is distinct from 'offer' then return false; end if;
    select j.company_id into v_company
      from public.offers o join public.jobs j on j.id = o.job_id
     where o.id = p_entity_id and o.deleted_at is null and j.deleted_at is null;
    return v_company is not null and public.company_recipient_ok(v_company, p_profile_id);
  elsif p_template = 'newMessage' then
    if p_entity_type is distinct from 'message' then return false; end if;
    select c.company_id into v_company
      from public.messages m join public.conversations c on c.id = m.conversation_id
     where m.id = p_entity_id and m.deleted_at is null and c.deleted_at is null;
    if not found then return false; end if;
    -- Strona firmowa rozmowy (jak w send_message: każdy członek firmy, także nieaktywny).
    if v_company is not null and exists (
         select 1 from public.company_members cm
          where cm.company_id = v_company and cm.profile_id = p_profile_id) then
      return public.company_recipient_ok(v_company, p_profile_id);
    end if;
    return true;
  end if;
  return true;
end $$;

create or replace function public.ensure_candidate_profile()
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cp uuid; v_deleted timestamptz;
begin
  -- #1142: tryb ogłoszeniowy — konto nie buduje profilu zawodowego.
  if not public.recruitment_write_allowed() then
    raise exception 'RECRUITMENT_DISABLED' using errcode = '42501';
  end if;
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  -- P1-04: tylko konto kandydata może mieć/tworzyć profil kandydata (model ról).
  if public.current_profile_role() <> 'candidate' then
    raise exception 'PERMISSION_DENIED: profil kandydata tylko dla konta kandydata' using errcode = '42501';
  end if;
  insert into public.candidate_profiles(profile_id) values (auth.uid())
    on conflict (profile_id) do nothing;
  select id, deleted_at into v_cp, v_deleted from public.candidate_profiles where profile_id = auth.uid();
  -- #1111: usunięty profil kandydata nie jest zwracany (każde RPC profilu przez tę funkcję).
  if v_deleted is not null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return v_cp;
end $$;

create or replace function public.apply_to_job(
  p_job_id uuid,
  p_idempotency_key text,
  p_phone text default null,
  p_availability text default null,
  p_message text default null,
  p_answers jsonb default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_company uuid; v_app_id uuid; v_locale text; v_job_title text;
        v_existing_key text; v_existing_deleted timestamptz;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  -- P1-04: aplikować może wyłącznie konto kandydata (nie pracodawca/admin).
  if public.current_profile_role() <> 'candidate' then
    raise exception 'PERMISSION_DENIED: aplikować może tylko konto kandydata' using errcode = '42501';
  end if;
  if not public.job_is_public(p_job_id) then raise exception 'JOB_NOT_ACTIVE' using errcode = '42501'; end if;

  select company_id, title into v_company, v_job_title from public.jobs where id = p_job_id;
  v_locale := public.resolve_recipient_locale(v_uid);

  insert into public.applications
    (job_id, candidate_id, company_id, status, phone, availability, message, locale, idempotency_key, submitted_at)
  values
    (p_job_id, v_uid, v_company, 'submitted', p_phone,
     nullif(p_availability,'')::public.availability_status, p_message, v_locale, p_idempotency_key, now())
  on conflict (candidate_id, job_id) do nothing
  returning id into v_app_id;

  if v_app_id is null then
    select id, idempotency_key, deleted_at into v_app_id, v_existing_key, v_existing_deleted
      from public.applications where candidate_id = v_uid and job_id = p_job_id;
    -- #1111: usunięta (deleted_at) aplikacja nie jest zwracana jako sukces ponowienia — para
    -- (kandydat, oferta) pozostaje zajęta (Invariant #4), więc jawny błąd.
    if v_existing_deleted is not null then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    -- Ten sam klucz = ponowienie tej samej próby (retry/podwójne kliknięcie) → sukces, bez
    -- duplikatu. Inny klucz = nowa, świadoma próba na ofertę, na którą kandydat już
    -- aplikował (także wycofaną/odrzuconą) → jawny błąd zamiast fałszywego sukcesu (#361).
    if v_existing_key is distinct from p_idempotency_key then
      raise exception 'APPLICATION_ALREADY_EXISTS' using errcode = '23505';
    end if;
    return v_app_id;
  end if;

  -- #101: odpowiedzi na pytania oferty w tej samej transakcji — błąd cofa też aplikację.
  perform public.record_screening_answers(v_app_id, p_job_id, p_answers);

  -- Powiadom/e-mail tylko aktywnych recruiter+ z aktywnym profilem (0070).
  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    select cm.profile_id, 'application_received', 'application_received', 'application', v_app_id
    from public.company_members cm
    where cm.company_id = v_company and public.company_recipient_ok(v_company, cm.profile_id);

  perform public.enqueue_email(cm.profile_id, 'newApplication', 'application', v_app_id,
                               'app-' || v_app_id::text || '-' || cm.profile_id::text,
                               jsonb_build_object('candidateName', coalesce(public.profile_full_name(v_uid), '—'),
                                                  'jobTitle', coalesce(v_job_title, '')))
    from public.company_members cm
    where cm.company_id = v_company and public.company_recipient_ok(v_company, cm.profile_id);

  return v_app_id;
end $$;

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
        v_key_job uuid; v_key_candidate uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  select j.company_id, j.title, c.name, j.expires_at, j.salary_min, j.salary_max, j.currency, j.salary_period
    into v_company, v_job_title, v_company_name, v_job_expires, v_salary_min, v_salary_max, v_currency, v_salary_period
    from public.jobs j join public.companies c on c.id = j.company_id
   where j.id = p_job_id and j.deleted_at is null and c.deleted_at is null;
  if v_company is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  -- P2-03: domyślny termin ważności propozycji, gdy nie podano jawnie. least() ignoruje NULL,
  -- więc dla oferty bez expires_at wychodzi now()+30 dni; z expires_at — wcześniejsza z dat.
  v_expires := coalesce(p_expires_at, least(v_job_expires, now() + interval '30 days'));

  -- Relacja: kandydat aplikował do oferty tej firmy LUB profil jest wyszukiwalny i kompletny.
  select exists (
    select 1 from public.applications a where a.candidate_id = p_candidate_id and a.company_id = v_company
      and a.deleted_at is null
    union all
    select 1 from public.candidate_profiles cp
      where cp.profile_id = p_candidate_id and cp.is_searchable = true and cp.profile_completed = true
        and cp.deleted_at is null
  ) into v_related;
  if not v_related then
    raise exception 'PERMISSION_DENIED: brak relacji firma–kandydat dla propozycji' using errcode = '42501';
  end if;

  -- Idempotencja po kluczu (retry z tym samym kluczem) — WYŁĄCZNIE dla tego samego celu.
  -- Klucz znaleziony przy innej parze oferta/kandydat to inna operacja (#853): błąd zamiast
  -- zwrócenia cudzej propozycji jako sukcesu.
  select id, job_id, candidate_id into v_offer_id, v_key_job, v_key_candidate
    from public.offers where idempotency_key = p_idempotency_key;
  if v_offer_id is not null then
    if v_key_job is distinct from p_job_id or v_key_candidate is distinct from p_candidate_id then
      raise exception 'VALIDATION_FAILED: klucz idempotencji należy do innej propozycji'
        using errcode = '22023';
    end if;
    return v_offer_id;
  end if;

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
    select id, job_id, candidate_id into v_offer_id, v_key_job, v_key_candidate
      from public.offers where idempotency_key = p_idempotency_key;
    if v_offer_id is not null
       and (v_key_job is distinct from p_job_id or v_key_candidate is distinct from p_candidate_id) then
      raise exception 'VALIDATION_FAILED: klucz idempotencji należy do innej propozycji'
        using errcode = '22023';
    end if;
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
