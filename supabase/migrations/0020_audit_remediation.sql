-- =============================================================================
-- 0020_audit_remediation.sql
-- Remediacja audytu multidyscyplinarnego (2026-07-24). Zamyka P1 (bezpieczeństwo/
-- poprawność w DB) oraz wybrane P2/P3:
--   P1  — maszyna stanów offers/applications egzekwowana w BAZIE (nie tylko w RPC):
--         pracodawca nie sfałszuje akceptacji/odrzucenia oferty ani nie przeskoczy
--         aplikacji poza allow-listę bezpośrednim UPDATE (PostgREST PATCH).
--   P1  — enqueue_email honoruje notification_preferences (opt-out e-mail działa).
--   P1  — get_public_jobs_count liczy po tym samym (przetłumaczonym) tytule co
--         get_public_jobs (spójne liczniki/paginacja w nl/fr/en).
--   P2  — revoke profile_full_name/resolve_recipient_locale (wyciek PII/locale).
--   P2  — send_offer wymaga relacji firma–kandydat (brak spamu ofert po UUID).
--   P3  — respond_to_offer tylko dla oferty w stanie 'sent'/'viewed'.
--   P3  — transition_application pomija no-op (brak duplikatu powiadomień).
--   P3  — profiles_insert_own nie pozwala nadać sobie roli innej niż candidate/employer.
--   P3  — send_offer wstawia niepustą treść (offers.message NOT NULL).
-- =============================================================================

-- --- P1: maszyna stanów aplikacji egzekwowana także po stronie FIRMY -----------
create or replace function public.enforce_application_integrity()
returns trigger language plpgsql security definer set search_path = public as $function$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.candidate_id := auth.uid();
      new.company_id := (select company_id from public.jobs where id = new.job_id);
      new.match_score := null;
      if new.status is null or new.status not in ('draft', 'submitted') then
        new.status := 'submitted';
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if auth.uid() is not null then
      if new.candidate_id is distinct from old.candidate_id
         or new.job_id is distinct from old.job_id
         or new.company_id is distinct from old.company_id then
        raise exception 'PERMISSION_DENIED: nie można zmienić powiązań aplikacji' using errcode = '42501';
      end if;
      if new.message is distinct from old.message
         or new.phone is distinct from old.phone
         or new.availability is distinct from old.availability
         or new.locale is distinct from old.locale
         or new.idempotency_key is distinct from old.idempotency_key
         or new.match_score is distinct from old.match_score
         or new.submitted_at is distinct from old.submitted_at then
        raise exception 'PERMISSION_DENIED: pola aplikacji są niezmienne po wysłaniu' using errcode = '42501';
      end if;
      -- Kandydat (właściciel): może jedynie wycofać aplikację.
      if new.candidate_id = auth.uid()
         and new.status is distinct from old.status
         and new.status <> 'withdrawn' then
        raise exception 'PERMISSION_DENIED: kandydat może jedynie wycofać aplikację' using errcode = '42501';
      end if;
      -- Firma (członek, nie kandydat): status tylko z allow-listy transition_application.
      -- Blokuje bezpośredni PATCH do offer_accepted/offer_declined/withdrawn/submitted/draft.
      if new.candidate_id <> auth.uid()
         and new.status is distinct from old.status
         and new.status not in ('viewed','shortlisted','interview','offer_sent','rejected','hired') then
        raise exception 'PERMISSION_DENIED: niedozwolone przejście statusu aplikacji przez firmę'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $function$;

-- --- P1: maszyna stanów propozycji egzekwowana także po stronie FIRMY ----------
create or replace function public.enforce_offer_integrity()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_company uuid; v_company_status text; v_job_status text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      select j.company_id, c.status::text, j.status::text
        into v_company, v_company_status, v_job_status
        from public.jobs j join public.companies c on c.id = j.company_id
        where j.id = new.job_id;
      if v_company is null then raise exception 'JOB_NOT_ACTIVE: oferta nie istnieje' using errcode = '42501'; end if;
      if not public.is_company_member(v_company) then
        raise exception 'PERMISSION_DENIED: brak członkostwa w firmie oferty' using errcode = '42501';
      end if;
      if v_company_status <> 'verified' then raise exception 'COMPANY_NOT_VERIFIED' using errcode = '42501'; end if;
      if v_job_status <> 'active' then raise exception 'JOB_NOT_ACTIVE' using errcode = '42501'; end if;
      new.company_id := v_company;
      new.sender_id := auth.uid();
      if new.status is null or new.status not in ('draft', 'sent') then new.status := 'sent'; end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if auth.uid() is not null then
      if new.job_id is distinct from old.job_id
         or new.candidate_id is distinct from old.candidate_id
         or new.company_id is distinct from old.company_id
         or new.sender_id is distinct from old.sender_id then
        raise exception 'PERMISSION_DENIED: nie można zmienić powiązań propozycji' using errcode = '42501';
      end if;
      if new.idempotency_key is distinct from old.idempotency_key
         or new.message is distinct from old.message
         or new.locale is distinct from old.locale
         or new.sent_at is distinct from old.sent_at then
        raise exception 'PERMISSION_DENIED: payload propozycji jest niezmienny' using errcode = '42501';
      end if;
      -- Kandydat (odbiorca): może jedynie zaakceptować/odrzucić.
      if new.candidate_id = auth.uid()
         and new.status is distinct from old.status
         and new.status not in ('accepted', 'declined') then
        raise exception 'PERMISSION_DENIED: kandydat może jedynie zaakceptować/odrzucić propozycję' using errcode = '42501';
      end if;
      -- Firma (nadawca, nie kandydat): NIE może ustawić accepted/declined (to wyłącznie
      -- ścieżka respond_to_offer po stronie kandydata). Zapobiega fałszowaniu zgody.
      if new.candidate_id <> auth.uid()
         and new.status is distinct from old.status
         and new.status in ('accepted', 'declined') then
        raise exception 'PERMISSION_DENIED: akceptacja/odrzucenie propozycji tylko przez kandydata'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $function$;

-- --- P1: enqueue_email honoruje notification_preferences (opt-out e-mail) ------
create or replace function public.enqueue_email(
  p_profile_id uuid,
  p_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare v_email public.citext; v_locale text; v_pref boolean;
begin
  select u.email into v_email from auth.users u where u.id = p_profile_id;
  if v_email is null then return; end if;

  -- Honoruj preferencje e-mail wg typu (brak wiersza => domyślnie wysyłamy).
  select case p_type
           when 'newApplication'  then np.email_applications
           when 'statusChanged'   then np.email_applications
           when 'jobOffer'        then np.email_offers
           when 'offerAccepted'   then np.email_offers
           when 'offerDeclined'   then np.email_offers
           when 'newMessage'      then np.email_messages
           when 'jobMatch'        then np.email_job_matches
           else true
         end
    into v_pref
    from public.notification_preferences np
    where np.profile_id = p_profile_id;
  if v_pref is false then return; end if;   -- opt-out: nie kolejkujemy (null/true => wysyłamy)

  v_locale := public.resolve_recipient_locale(p_profile_id);
  insert into public.email_deliveries
    (profile_id, to_email, template, locale, subject, status, entity_type, entity_id,
     idempotency_key, payload, queued_at, next_attempt_at, attempts)
  values
    (p_profile_id, v_email, p_type, v_locale, p_type, 'queued', p_entity_type, p_entity_id,
     p_idempotency_key, coalesce(p_payload, '{}'::jsonb), now(), now(), 0)
  on conflict (idempotency_key) where idempotency_key is not null
    do nothing;
end $$;

-- --- P2: wewnętrzne helpery bez grantu dla ról klienta (wyciek PII/locale) -----
revoke all on function public.profile_full_name(uuid) from public;
revoke all on function public.resolve_recipient_locale(uuid) from public;

-- --- P2/P3: send_offer — walidacja relacji firma–kandydat + niepusta treść -----
create or replace function public.send_offer(
  p_job_id uuid,
  p_candidate_id uuid,
  p_idempotency_key text,
  p_message text default null,
  p_expires_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_offer_id uuid; v_locale text; v_job_title text; v_company_name text;
        v_company uuid; v_related boolean;
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

  v_locale := public.resolve_recipient_locale(p_candidate_id);

  insert into public.offers
    (job_id, candidate_id, status, message, locale, idempotency_key, sent_at, expires_at)
  values
    (p_job_id, p_candidate_id, 'sent', coalesce(p_message, ''), v_locale, p_idempotency_key, now(), p_expires_at)
  on conflict (idempotency_key) do nothing
  returning id into v_offer_id;

  if v_offer_id is null then
    select id into v_offer_id from public.offers where idempotency_key = p_idempotency_key;
    return v_offer_id;
  end if;

  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    values (p_candidate_id, 'offer_received', 'offer_received', 'offer', v_offer_id);
  perform public.enqueue_email(p_candidate_id, 'jobOffer', 'offer', v_offer_id, 'offer-' || v_offer_id::text,
                               jsonb_build_object('companyName', coalesce(v_company_name, ''),
                                                  'jobTitle', coalesce(v_job_title, '')));
  return v_offer_id;
end $$;

-- --- P3: respond_to_offer tylko dla oferty aktywnej ('sent'/'viewed') ----------
create or replace function public.respond_to_offer(
  p_offer_id uuid,
  p_accept boolean
) returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_candidate uuid; v_sender uuid; v_job_title text; v_status public.offer_status;
        v_to public.offer_status := case when p_accept then 'accepted' else 'declined' end;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select o.candidate_id, o.sender_id, o.status, j.title into v_candidate, v_sender, v_status, v_job_title
    from public.offers o join public.jobs j on j.id = o.job_id where o.id = p_offer_id;
  if v_candidate is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_candidate <> v_uid then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if v_status not in ('sent','viewed') then
    raise exception 'VALIDATION_FAILED: propozycja nie jest już aktywna' using errcode = '42501';
  end if;

  update public.offers set status = v_to, responded_at = now(), updated_at = now() where id = p_offer_id;

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

-- --- P3: transition_application pomija no-op (brak duplikatów powiadomień) ------
create or replace function public.transition_application(
  p_application_id uuid,
  p_target text
) returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_job uuid; v_candidate uuid; v_from public.application_status;
        v_to public.application_status := p_target::public.application_status;
        v_job_title text; v_company_name text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select a.job_id, a.candidate_id, a.status, j.title, c.name
    into v_job, v_candidate, v_from, v_job_title, v_company_name
    from public.applications a
    join public.jobs j on j.id = a.job_id
    join public.companies c on c.id = j.company_id
    where a.id = p_application_id;
  if v_job is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_job_company_member(v_job) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if v_to not in ('viewed','shortlisted','interview','offer_sent','rejected','hired') then
    raise exception 'VALIDATION_FAILED: niedozwolone przejście statusu' using errcode = '42501';
  end if;
  if v_from = v_to then return; end if;   -- no-op: bez duplikatu powiadomień/e-maila

  update public.applications set status = v_to, updated_at = now() where id = p_application_id;

  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    values (v_candidate, 'application_status_changed', 'application_status_changed', 'application', p_application_id);
  perform public.enqueue_email(v_candidate, 'statusChanged', 'application', p_application_id,
                               'appstatus-' || p_application_id::text || '-' || v_to::text,
                               jsonb_build_object('companyName', coalesce(v_company_name, ''),
                                                  'jobTitle', coalesce(v_job_title, ''),
                                                  'status', v_to::text));
end $$;

-- --- P1: get_public_jobs_count spójny z get_public_jobs (filtr po tłumaczeniu) -
drop function if exists public.get_public_jobs_count(text, text, text, text);
create or replace function public.get_public_jobs_count(
  p_locale text default 'pl',
  p_keyword text default null,
  p_city text default null,
  p_category text default null,
  p_contract_type text default null
) returns bigint language sql stable security definer set search_path = public as $$
  select count(*)::bigint
  from public.jobs j
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = p_locale) desc, (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where j.status = 'active' and j.deleted_at is null
    and c.status = 'verified' and c.deleted_at is null
    and (p_category is null or j.category::text = p_category)
    and (p_contract_type is null or j.contract_type::text = p_contract_type)
    and (p_city is null or j.city ilike '%' || p_city || '%')
    and (p_keyword is null or coalesce(t.title, j.title) ilike '%' || p_keyword || '%');
$$;
revoke all on function public.get_public_jobs_count(text, text, text, text, text) from public;
grant execute on function public.get_public_jobs_count(text, text, text, text, text) to anon, authenticated;

-- --- P3: profiles_insert_own nie pozwala nadać sobie roli != candidate/employer -
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid() and role in ('candidate', 'employer'));
