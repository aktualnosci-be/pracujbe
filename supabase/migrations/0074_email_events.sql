-- =============================================================================
-- 0074 — kolejka e-mail: klucz idempotencji per przejście statusu (#292)
--        oraz podpięcie szablonów z realnym zdarzeniem (#295).
--
-- 1. transition_application — klucz e-maila zawiera id wiersza
--    `application_status_history` utworzonego przez to przejście (trigger
--    log_application_status w tej samej transakcji). Dotąd klucz
--    `appstatus-<id>-<status>` sprawiał, że cykl interview → shortlisted → interview
--    dawał e-mail tylko za pierwszym razem (`on conflict do nothing` w enqueue_email).
--    Ponowienie tego samego żądania nie tworzy nowego przejścia (v_from = v_to → return),
--    więc nie tworzy też drugiego e-maila (Invariant #3).
--    Przejście na `viewed` wysyła dedykowany szablon `applicationViewed`
--    (pozostałe statusy — `statusChanged`, jak dotąd).
-- 2. enqueue_email — `applicationViewed` podlega tej samej preferencji co
--    `statusChanged` (`email_applications`). Reszta 1:1 z 0020.
-- 3. publish_job — po udanej publikacji kolejkuje `jobPublished` do osoby
--    publikującej (o ile nadal jest aktywnym recruiter+, `company_recipient_ok`).
--    Klucz `jobpub-<job_id>`: publikacja szkicu zdarza się raz. Reszta 1:1 z 0062.
--
-- Język e-maila wyznacza enqueue_email (resolve_recipient_locale odbiorcy, Invariant #1).
-- Rollback: odtworzyć transition_application z 0040, enqueue_email z 0020,
-- publish_job z 0062. Migracja nie zmienia danych.
-- =============================================================================

-- --- 1. transition_application (0040) — klucz per przejście, applicationViewed -------
create or replace function public.transition_application(
  p_application_id uuid,
  p_target text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_job uuid; v_candidate uuid; v_from public.application_status;
        v_to public.application_status; v_job_title text; v_company_name text; v_allowed boolean;
        v_history uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  -- Walidacja targetu jako TEKST przed rzutowaniem (kontrolowany błąd, nie surowy błąd enuma).
  if p_target is null or p_target not in ('viewed','shortlisted','interview','offer_sent','rejected','hired') then
    raise exception 'VALIDATION_FAILED: niedozwolony status docelowy' using errcode = '42501';
  end if;
  v_to := p_target::public.application_status;

  -- Blokada wiersza aplikacji (koniec wyścigu równoległych żądań).
  select a.job_id, a.candidate_id, a.status, j.title, c.name
    into v_job, v_candidate, v_from, v_job_title, v_company_name
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

  -- Wiersz historii dopisany przez trigger log_application_status w tej transakcji.
  select h.id into v_history
    from public.application_status_history h
    where h.application_id = p_application_id and h.from_status = v_from and h.to_status = v_to
    order by h.created_at desc, h.id desc
    limit 1;
  if v_history is null then
    raise exception 'INTERNAL: brak wpisu historii statusu' using errcode = 'P0001';
  end if;

  insert into public.notifications (profile_id, type, title, entity_type, entity_id)
    values (v_candidate, 'application_status_changed', 'application_status_changed', 'application', p_application_id);

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

-- --- 2. enqueue_email (0020) — applicationViewed pod email_applications ---------------
create or replace function public.enqueue_email(
  p_profile_id uuid,
  p_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email public.citext; v_locale text; v_pref boolean;
begin
  select u.email into v_email from auth.users u where u.id = p_profile_id;
  if v_email is null then return; end if;

  -- Honoruj preferencje e-mail wg typu (brak wiersza => domyślnie wysyłamy).
  select case p_type
           when 'newApplication'    then np.email_applications
           when 'statusChanged'     then np.email_applications
           when 'applicationViewed' then np.email_applications
           when 'jobOffer'          then np.email_offers
           when 'offerAccepted'     then np.email_offers
           when 'offerDeclined'     then np.email_offers
           when 'newMessage'        then np.email_messages
           when 'jobMatch'          then np.email_job_matches
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

-- --- 3. publish_job (0062) — jobPublished do publikującego ----------------------------
create or replace function public.publish_job(p_job_id uuid, p_slug text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid; v_cstatus text; v_status text;
  v_title text; v_city text; v_region text; v_slug text; v_new_slug text;
  v_has_translation boolean; v_has_mandatory boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  select j.company_id, c.status::text, j.status::text, j.title, j.city, j.region, j.slug
    into v_company, v_cstatus, v_status, v_title, v_city, v_region, v_slug
    from public.jobs j join public.companies c on c.id = j.company_id
    where j.id = p_job_id and j.deleted_at is null
    for update of j;

  if v_company is null then raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002'; end if;
  if not public.can_manage_jobs(v_company) then
    raise exception 'PERMISSION_DENIED: publikacja wymaga roli recruiter+' using errcode = '42501';
  end if;
  if v_cstatus <> 'verified' then
    raise exception 'COMPANY_NOT_VERIFIED: firma nie jest zweryfikowana' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'VALIDATION_FAILED: publikować można tylko szkic' using errcode = '42501';
  end if;

  if v_title is null or btrim(v_title) = '' or v_title ilike 'draft%' or v_title ilike '%placeholder%'
     or v_city is null or btrim(v_city) = ''
     or v_region is null or btrim(v_region) = '' then
    raise exception 'VALIDATION_FAILED: oferta niekompletna (tytuł/miasto/region)' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.job_translations t
    where t.job_id = p_job_id
      and coalesce(btrim(t.title), '') <> ''
      and coalesce(btrim(t.description), '') <> ''
      and coalesce(array_length(t.responsibilities, 1), 0) > 0
  ) into v_has_translation;
  if not v_has_translation then
    raise exception 'VALIDATION_FAILED: oferta niekompletna (opis i obowiązki w tłumaczeniu)'
      using errcode = '42501';
  end if;

  select exists (
    select 1 from public.job_requirements r
    where r.job_id = p_job_id and r.kind = 'mandatory' and coalesce(btrim(r.content), '') <> ''
  ) into v_has_mandatory;
  if not v_has_mandatory then
    raise exception 'VALIDATION_FAILED: brak wymagań obowiązkowych' using errcode = '42501';
  end if;

  v_new_slug := case
    when v_slug is null or v_slug like 'draft-%'
      then left(coalesce(nullif(btrim(p_slug), ''), 'oferta'), 120)
    else v_slug
  end;

  update public.jobs
    set status = 'active', published_at = now(), slug = v_new_slug
    where id = p_job_id and status = 'draft';
  if not found then
    raise exception 'VALIDATION_FAILED: oferta zmieniła stan równolegle' using errcode = '42501';
  end if;

  -- #295: potwierdzenie publikacji dla publikującego (w jego języku — enqueue_email).
  if public.company_recipient_ok(v_company, auth.uid()) then
    perform public.enqueue_email(auth.uid(), 'jobPublished', 'job', p_job_id,
                                 'jobpub-' || p_job_id::text,
                                 jsonb_build_object('jobTitle', v_title));
  end if;

  return v_new_slug;
end $$;
revoke all on function public.publish_job(uuid, text) from public;
grant execute on function public.publish_job(uuid, text) to authenticated;
