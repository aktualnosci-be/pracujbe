-- =============================================================================
-- 0150 — send_offer: klucz idempotencji związany z celem propozycji (#853)
-- NUMER TYMCZASOWY — ostateczny nada integrator.
--
-- Problem: send_offer szukał `p_idempotency_key` globalnie w `offers` i od razu zwracał
-- znalezione ID — także gdy klucz należał do propozycji dla INNEJ oferty albo innego
-- kandydata. Przycisk w panelu pracodawcy trzymał jeden klucz na instancję komponentu,
-- więc po przełączeniu aktywnej firmy (router.refresh bez remountu) wysyłka dla oferty B
-- dostawała ID propozycji dla oferty A i UI pokazywało fałszywy sukces; propozycja B,
-- powiadomienie i e-mail nie powstawały.
--
-- Zmiana: klucz znaleziony przy innej parze (job_id, candidate_id) → VALIDATION_FAILED
-- (errcode 22023), zarówno przy odczycie przed wstawieniem, jak i w gałęzi unique_violation
-- (wyścig). Retry tej samej pary z tym samym kluczem — bez zmian (to samo ID, bez duplikatu
-- powiadomień). Idempotencja aktywnej pary (inny klucz) — bez zmian. Klient (#853) generuje
-- nowy klucz przy zmianie celu, więc błąd jest tylko zabezpieczeniem.
-- Reszta ciała skopiowana 1:1 z 0113 (podpis, SECURITY DEFINER, search_path, granty
-- zachowuje CREATE OR REPLACE).
--
-- Rollback: odtworzyć send_offer z 0113. Migracja nie zmienia danych.
-- =============================================================================

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
