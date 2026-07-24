-- =============================================================================
-- 0049_offer_expiry_default.sql
-- Remediacja audytu 2026-07-24 (AUDIT_REPORT) — P2-03: propozycje pracodawcy nigdy nie wygasają.
--
-- Problem: warstwa aplikacji zawsze przekazywała p_expires_at = null, więc propozycja pozostawała
-- bezterminowo „aktywna" (respond_to_offer i tak odrzuca po wygaśnięciu — 0041 — ale bez daty
-- nigdy nie następowało). Kandydat mógł zaakceptować propozycję długo po zakończeniu rekrutacji.
--
-- Naprawa: send_offer nadaje DOMYŚLNY termin, gdy p_expires_at jest null:
--   least(job.expires_at, now() + 30 dni)  (least ignoruje NULL, więc bez expires_at oferty = +30d).
-- Jawnie podany p_expires_at jest honorowany. Reszta ciała funkcji bez zmian (wierna kopia z 0041).
-- =============================================================================

create or replace function public.send_offer(
  p_job_id uuid,
  p_candidate_id uuid,
  p_idempotency_key text,
  p_message text default null,
  p_expires_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_offer_id uuid; v_locale text; v_job_title text; v_company_name text;
        v_company uuid; v_related boolean; v_existing uuid; v_job_expires timestamptz; v_expires timestamptz;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  select j.company_id, j.title, c.name, j.expires_at
    into v_company, v_job_title, v_company_name, v_job_expires
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
  perform public.enqueue_email(p_candidate_id, 'jobOffer', 'offer', v_offer_id, 'offer-' || v_offer_id::text,
                               jsonb_build_object('companyName', coalesce(v_company_name, ''),
                                                  'jobTitle', coalesce(v_job_title, '')));
  return v_offer_id;
end $$;
