-- =============================================================================
-- 0012_rpc_flows.sql
-- Bezpieczne, transakcyjne procesy rekrutacyjne jako RPC (SECURITY DEFINER) —
-- domknięcie P0-04 (idempotentna propozycja + niezależny outbox) oraz P1-13
-- (kolejka e-mail z attempts/next_attempt_at). Klient NIE dostaje ogólnych praw
-- INSERT/UPDATE (patrz 0011); mutacje domenowe idą wyłącznie przez te RPC.
--
-- Język e-maila = język ODBIORCY (INVARIANT #1) — wyznaczany w DB przez
-- resolve_recipient_locale(), nie przez nadawcę/sesję.
-- =============================================================================

-- --- Outbox: pola do ponawiania (P1-13) ------------------------------------
alter table public.email_deliveries
  add column if not exists attempts integer not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists payload jsonb not null default '{}'::jsonb;

create index if not exists email_deliveries_claim_idx
  on public.email_deliveries (next_attempt_at)
  where status = 'queued';

-- --- Język odbiorcy (fallback: preferred -> account -> signup -> 'en') -------
create or replace function public.resolve_recipient_locale(p_profile_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case
       when p.preferred_locale in ('pl','nl','fr','en') then p.preferred_locale
       when p.account_locale   in ('pl','nl','fr','en') then p.account_locale
       when p.signup_locale    in ('pl','nl','fr','en') then p.signup_locale
       else 'en' end
     from public.profiles p where p.id = p_profile_id),
    'en');
$$;

-- --- Enqueue e-mail (wewnętrzne) — locale zawsze z profilu ODBIORCY ----------
-- p_type = nazwa EmailType (np. 'newApplication'); p_payload = dane renderowania (EmailDataMap).
create or replace function public.enqueue_email(
  p_profile_id uuid,
  p_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare v_email public.citext; v_locale text;
begin
  select u.email into v_email from auth.users u where u.id = p_profile_id;
  if v_email is null then return; end if;              -- brak adresu = nie kolejkujemy
  v_locale := public.resolve_recipient_locale(p_profile_id);
  insert into public.email_deliveries
    (profile_id, to_email, template, locale, subject, status, entity_type, entity_id,
     idempotency_key, payload, queued_at, next_attempt_at, attempts)
  values
    (p_profile_id, v_email, p_type, v_locale, p_type, 'queued', p_entity_type, p_entity_id,
     p_idempotency_key, coalesce(p_payload, '{}'::jsonb), now(), now(), 0)
  on conflict (idempotency_key) where idempotency_key is not null
    do nothing;                                          -- idempotencja kolejki (indeks częściowy)
end $$;

-- Imię+nazwisko z profilu (do payloadu maili).
create or replace function public.profile_full_name(p_profile_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), '')
  from public.profiles where id = p_profile_id;
$$;

-- =============================================================================
-- apply_to_job — idempotentne aplikowanie (Invariant #4)
-- =============================================================================
create or replace function public.apply_to_job(
  p_job_id uuid,
  p_idempotency_key text,
  p_phone text default null,
  p_availability text default null,
  p_message text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_company uuid; v_app_id uuid; v_locale text; v_job_title text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
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

  -- Duplikat (podwójne kliknięcie / retry) — zwróć istniejącą aplikację, bez efektów ubocznych.
  if v_app_id is null then
    select id into v_app_id from public.applications where candidate_id = v_uid and job_id = p_job_id;
    return v_app_id;
  end if;

  -- Powiadom aktywnych członków firmy + zakolejkuj e-mail (każdy w SWOIM języku).
  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    select cm.profile_id, 'application_received', 'application_received', 'application', v_app_id
    from public.company_members cm where cm.company_id = v_company and cm.is_active = true;

  perform public.enqueue_email(cm.profile_id, 'newApplication', 'application', v_app_id,
                               'app-' || v_app_id::text || '-' || cm.profile_id::text,
                               jsonb_build_object('candidateName', coalesce(public.profile_full_name(v_uid), '—'),
                                                  'jobTitle', coalesce(v_job_title, '')))
    from public.company_members cm where cm.company_id = v_company and cm.is_active = true;

  return v_app_id;
end $$;

-- =============================================================================
-- transition_application — zmiana statusu przez firmę (allow-lista), historia auto (0011)
-- =============================================================================
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
  -- Allow-lista przejść inicjowanych przez firmę.
  if v_to not in ('viewed','shortlisted','interview','offer_sent','rejected','hired') then
    raise exception 'VALIDATION_FAILED: niedozwolone przejście statusu' using errcode = '42501';
  end if;

  update public.applications set status = v_to, updated_at = now() where id = p_application_id;

  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    values (v_candidate, 'application_status_changed', 'application_status_changed', 'application', p_application_id);
  perform public.enqueue_email(v_candidate, 'statusChanged', 'application', p_application_id,
                               'appstatus-' || p_application_id::text || '-' || v_to::text,
                               jsonb_build_object('companyName', coalesce(v_company_name, ''),
                                                  'jobTitle', coalesce(v_job_title, ''),
                                                  'status', v_to::text));
end $$;

-- =============================================================================
-- send_offer — idempotentna propozycja (P0-04). Walidacja verified/active/członkostwo
-- realizuje trigger enforce_offer_integrity (0011); tu: transakcja + historia + outbox.
-- =============================================================================
create or replace function public.send_offer(
  p_job_id uuid,
  p_candidate_id uuid,
  p_idempotency_key text,
  p_message text default null,
  p_expires_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_offer_id uuid; v_locale text; v_job_title text; v_company_name text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  v_locale := public.resolve_recipient_locale(p_candidate_id);
  select j.title, c.name into v_job_title, v_company_name
    from public.jobs j join public.companies c on c.id = j.company_id where j.id = p_job_id;

  insert into public.offers
    (job_id, candidate_id, status, message, locale, idempotency_key, sent_at, expires_at)
  values
    (p_job_id, p_candidate_id, 'sent', p_message, v_locale, p_idempotency_key, now(), p_expires_at)
  on conflict (idempotency_key) do nothing
  returning id into v_offer_id;

  if v_offer_id is null then                             -- duplikat: zwróć istniejącą
    select id into v_offer_id from public.offers where idempotency_key = p_idempotency_key;
    return v_offer_id;
  end if;

  -- Zapis DB niezależny od e-maila: powiadomienie + kolejka (ponawialna).
  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    values (p_candidate_id, 'offer_received', 'offer_received', 'offer', v_offer_id);
  perform public.enqueue_email(p_candidate_id, 'jobOffer', 'offer', v_offer_id, 'offer-' || v_offer_id::text,
                               jsonb_build_object('companyName', coalesce(v_company_name, ''),
                                                  'jobTitle', coalesce(v_job_title, '')));

  return v_offer_id;
end $$;

-- =============================================================================
-- respond_to_offer — kandydat akceptuje/odrzuca; powiadomienie do nadawcy
-- =============================================================================
create or replace function public.respond_to_offer(
  p_offer_id uuid,
  p_accept boolean
) returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_candidate uuid; v_sender uuid; v_job_title text;
        v_to public.offer_status := case when p_accept then 'accepted' else 'declined' end;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select o.candidate_id, o.sender_id, j.title into v_candidate, v_sender, v_job_title
    from public.offers o join public.jobs j on j.id = o.job_id where o.id = p_offer_id;
  if v_candidate is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_candidate <> v_uid then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;

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

-- --- Uprawnienia: procesy tylko dla zalogowanych (RLS/triggery pilnują reszty) ---
revoke all on function public.apply_to_job(uuid, text, text, text, text) from public;
revoke all on function public.transition_application(uuid, text) from public;
revoke all on function public.send_offer(uuid, uuid, text, text, timestamptz) from public;
revoke all on function public.respond_to_offer(uuid, boolean) from public;
grant execute on function public.apply_to_job(uuid, text, text, text, text) to authenticated;
grant execute on function public.transition_application(uuid, text) to authenticated;
grant execute on function public.send_offer(uuid, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.respond_to_offer(uuid, boolean) to authenticated;
-- enqueue_email / resolve_recipient_locale: wewnętrzne (tylko definer/service).
revoke all on function public.enqueue_email(uuid, text, text, uuid, text, jsonb) from public;
