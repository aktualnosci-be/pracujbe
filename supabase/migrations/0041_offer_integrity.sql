-- =============================================================================
-- 0041_offer_integrity.sql
-- Remediacja audytu produkcyjnego 2026-07-24 — P1-23: propozycje pracy — stabilna
-- idempotencja (aktywna para oferta–kandydat), kontrola wygaśnięcia i ochrona przed wyścigiem.
--
-- Problemy:
--  - unikat tylko po idempotency_key → retry z INNYM kluczem tworzył drugą aktywną propozycję;
--  - respond_to_offer bez FOR UPDATE (wyścig accept/decline) i bez sprawdzenia expires_at
--    (wygasłą propozycję można było zaakceptować).
--
-- Naprawa:
--  - PARTIAL UNIQUE (job_id, candidate_id) dla stanów aktywnych ('sent','viewed') → najwyżej
--    jedna aktywna propozycja na parę; send_offer zwraca istniejącą (idempotencja po relacji);
--  - respond_to_offer: FOR UPDATE + kontrola expires_at + compare-and-swap na stanie aktywnym.
-- =============================================================================

-- Najwyżej jedna AKTYWNA propozycja na parę (oferta, kandydat).
create unique index if not exists uq_offers_active_pair
  on public.offers (job_id, candidate_id)
  where status in ('sent', 'viewed') and deleted_at is null;

-- --- send_offer: idempotencja po kluczu ORAZ po aktywnej parze (+ obsługa wyścigu) ---
create or replace function public.send_offer(
  p_job_id uuid,
  p_candidate_id uuid,
  p_idempotency_key text,
  p_message text default null,
  p_expires_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_offer_id uuid; v_locale text; v_job_title text; v_company_name text;
        v_company uuid; v_related boolean; v_existing uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  select j.company_id, j.title, c.name into v_company, v_job_title, v_company_name
    from public.jobs j join public.companies c on c.id = j.company_id where j.id = p_job_id;
  if v_company is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

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
      (p_job_id, p_candidate_id, 'sent', coalesce(p_message, ''), v_locale, p_idempotency_key, now(), p_expires_at)
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

-- --- respond_to_offer: FOR UPDATE + kontrola wygaśnięcia + CAS ------------------
create or replace function public.respond_to_offer(
  p_offer_id uuid,
  p_accept boolean
) returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_candidate uuid; v_sender uuid; v_job_title text;
        v_status public.offer_status; v_expires timestamptz;
        v_to public.offer_status := case when p_accept then 'accepted' else 'declined' end;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  -- Blokada wiersza propozycji (koniec wyścigu równoległych accept/decline).
  select o.candidate_id, o.sender_id, o.status, o.expires_at, j.title
    into v_candidate, v_sender, v_status, v_expires, v_job_title
    from public.offers o join public.jobs j on j.id = o.job_id
    where o.id = p_offer_id
    for update of o;
  if v_candidate is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_candidate <> v_uid then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if v_status not in ('sent', 'viewed') then
    raise exception 'VALIDATION_FAILED: propozycja nie jest już aktywna' using errcode = '42501';
  end if;
  -- Kontrola wygaśnięcia: wygasłej propozycji nie można przyjąć/odrzucić (oznaczenie 'expired'
  -- zostawiamy zadaniu utrzymaniowemu — tu tylko blokujemy, by nie kolidować z guard-triggerem).
  if v_expires is not null and v_expires < now() then
    raise exception 'VALIDATION_FAILED: propozycja wygasła' using errcode = '42501';
  end if;

  -- Compare-and-swap na stanie aktywnym.
  update public.offers set status = v_to, responded_at = now(), updated_at = now()
    where id = p_offer_id and status in ('sent', 'viewed');
  if not found then
    raise exception 'VALIDATION_FAILED: propozycja zmieniła stan równolegle' using errcode = '42501';
  end if;

  if v_sender is not null then
    insert into public.notifications (profile_id, type, title, entity_type, entity_id)
      values (v_sender, 'offer_status_changed', 'offer_status_changed', 'offer', p_offer_id);
    perform public.enqueue_email(v_sender,
      case when p_accept then 'offerAccepted' else 'offerDeclined' end,
      'offer', p_offer_id, 'offerresp-' || p_offer_id::text,
      jsonb_build_object('candidateName', coalesce(public.profile_full_name(v_candidate), '—'),
                         'jobTitle', coalesce(v_job_title, '')));
  end if;
end $$;
