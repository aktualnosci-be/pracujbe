-- =============================================================================
-- 0209_employer_account_rights.sql — #486 (część pracodawcy): eksport danych konta
-- pracodawcy (prawo dostępu) i samoobsługowe usunięcie konta pracodawcy.
--
-- Numer TYMCZASOWY (0209) — ostateczny nada integrator.
--
-- Wzór: export_my_data / request_account_erasure / erase_candidate_subject kandydata (0105).
-- Dane FIRMY (companies, oferty, zgłoszenia, rozmowy, propozycje) należą do firmy i zostają;
-- odpięte są tylko powiązania z osobą (FK → null przez ON DELETE SET NULL).
--
-- 1. export_my_employer_data() — JSON: konto, profil, profil pracodawcy, członkostwa (firma,
--    rola, aktywność), zaproszenia WYSŁANE przez tę osobę, zaproszenia otrzymane na jej adres,
--    oferty utworzone przez nią (metadane), akcje audytowe, w których jest aktorem, zgody,
--    preferencje, powiadomienia (bez treści i danych — mogą dotyczyć kandydatów), e-maile
--    (bez treści), wnioski. BEZ danych kandydatów: z dziennika audytu tylko akcja, typ
--    obiektu i czas; identyfikator obiektu wyłącznie dla obiektów firmowych
--    (company/job/company_member/company_invitation), nigdy before/after_data.
--    Limit 10 eksportów na dobę (wspólny ślad data_rights_requests), audyt data.exported.
-- 2. erase_employer_subject(subject, channel, request) — funkcja wewnętrzna (bez EXECUTE dla
--    klientów). Odmowa COMPANY_LAST_OWNER, gdy osoba jest OSTATNIM aktywnym właścicielem
--    którejkolwiek firmy (najpierw przekazanie roli albo zamknięcie firmy). Członkostwa
--    usuwane jawnie (trigger enforce_owner_invariants pilnuje tej samej reguły), e-maile do
--    osoby i jej pliki (poza załącznikami rozmów firmy) usunięte, IP/UA w audycie wyzerowane,
--    konto auth → kaskada (profil, profil pracodawcy, sesje, członkostwa w rozmowach,
--    powiadomienia, zgody); dziennik audytu zostaje z actor_id = null; tombstone i audyt
--    account.erased (jak u kandydata).
-- 3. request_employer_account_erasure(email) — samoobsługowe usunięcie konta pracodawcy;
--    potwierdzenie = adres e-mail konta wpisany ponownie (jak u kandydata).
-- 4. apply_erasure_tombstones — ponowne usunięcie po restore wybiera funkcję wg roli profilu
--    (pracodawca → erase_employer_subject). Ostatni właściciel po odtworzeniu kopii = błąd
--    COMPANY_LAST_OWNER (decyzja operatora, docs/DATA_RETENTION.md).
-- 5. enforce_offer_integrity — jak w 0037, ale dopuszcza offers.sender_id → null (ON DELETE
--    SET NULL przy usunięciu konta rekrutera pod jego sesją; wzór: reports_guard w 0105).
--    Zmiana nadawcy na inną osobę nadal PERMISSION_DENIED.
--
-- Rollback: drop funkcji z pkt 1–3; apply_erasure_tombstones z 0105; enforce_offer_integrity z 0037.
-- Migracja nie zmienia istniejących danych.
-- =============================================================================

-- --- 5. Propozycje: odwołanie nadawcy przez ON DELETE SET NULL ---------------------------------
-- 0037 bez zmian poza warunkiem sender_id: jedyną dozwoloną zmianą nadawcy jest null
-- (usunięcie konta rekrutera pod jego własną sesją). Każda inna zmiana powiązań nadal
-- PERMISSION_DENIED.
create or replace function public.enforce_offer_integrity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_company uuid; v_company_status text; v_job_status text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      select j.company_id, c.status::text, j.status::text
        into v_company, v_company_status, v_job_status
        from public.jobs j join public.companies c on c.id = j.company_id
        where j.id = new.job_id;
      if v_company is null then raise exception 'JOB_NOT_ACTIVE: oferta nie istnieje' using errcode = '42501'; end if;
      if not public.can_manage_jobs(v_company) then
        raise exception 'PERMISSION_DENIED: wysłanie propozycji wymaga roli recruiter+' using errcode = '42501';
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
         or (new.sender_id is distinct from old.sender_id and new.sender_id is not null) then
        raise exception 'PERMISSION_DENIED: nie można zmienić powiązań propozycji' using errcode = '42501';
      end if;
      if new.idempotency_key is distinct from old.idempotency_key
         or new.message is distinct from old.message
         or new.locale is distinct from old.locale
         or new.sent_at is distinct from old.sent_at then
        raise exception 'PERMISSION_DENIED: payload propozycji jest niezmienny' using errcode = '42501';
      end if;
      if new.candidate_id = auth.uid()
         and new.status is distinct from old.status
         and new.status not in ('accepted', 'declined') then
        raise exception 'PERMISSION_DENIED: kandydat może jedynie zaakceptować/odrzucić propozycję' using errcode = '42501';
      end if;
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

-- --- 2. Pełne usunięcie pracodawcy ----------------------------------------------------------
create or replace function public.erase_employer_subject(p_subject uuid, p_channel text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role     public.user_role;
  v_email    text;
  v_blocking uuid[];
  v_members  integer := 0;
  v_files    integer := 0;
  v_mails    integer := 0;
begin
  if p_subject is null then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;

  select p.role, p.email::text into v_role, v_email from public.profiles p where p.id = p_subject for update;
  if found and v_role <> 'employer' then
    raise exception 'PERMISSION_DENIED: usunięcie dotyczy wyłącznie konta pracodawcy' using errcode = '42501';
  end if;
  if v_email is null then
    select u.email::text into v_email from auth.users u where u.id = p_subject;
  end if;

  -- Blokada członkostw firm osoby (kolejność stała), żeby równoległe odebranie roli innemu
  -- właścicielowi nie ominęło kontroli ostatniego właściciela.
  perform 1 from public.company_members cm
   where cm.company_id in (select m.company_id from public.company_members m where m.profile_id = p_subject)
   order by cm.id
   for update;

  select coalesce(array_agg(m.company_id order by m.company_id), '{}') into v_blocking
    from public.company_members m
   where m.profile_id = p_subject and m.role = 'owner' and m.is_active
     and public.count_other_active_owners(m.company_id, m.id) = 0;
  if coalesce(array_length(v_blocking, 1), 0) > 0 then
    raise exception 'VALIDATION_FAILED: COMPANY_LAST_OWNER' using errcode = '22023';
  end if;

  delete from public.company_members m where m.profile_id = p_subject;
  get diagnostics v_members = row_count;

  -- E-maile do tej osoby (adres, payload). Dane firmy w innych wierszach zostają.
  delete from public.email_deliveries e where e.profile_id = p_subject;
  get diagnostics v_mails = row_count;

  -- Pliki osoby → kolejka storage (trigger). Załączniki rozmów firmy są korespondencją firmy
  -- z kandydatem i zostają (uploader/owner → null przez FK).
  delete from public.files f
   where f.owner_id = p_subject and f.entity_type is distinct from 'message_attachment';
  get diagnostics v_files = row_count;

  update public.audit_logs set ip_address = null, user_agent = null where actor_id = p_subject;
  if v_email is not null and to_regclass('auth.verifications') is not null then
    execute 'delete from auth.verifications where identifier = $1' using v_email;
  end if;
  -- Konto auth → kaskada: profil, profil pracodawcy, sesje, konta logowania, członkostwa
  -- w rozmowach, powiadomienia, preferencje, zgody. FK firmowe (oferty, wiadomości,
  -- propozycje, zaproszenia, audyt) → null.
  delete from auth.users u where u.id = p_subject;
  delete from public.profiles p where p.id = p_subject;

  insert into public.erasure_tombstones (subject_id, request_id, channel)
  values (p_subject, p_request, p_channel)
  on conflict (subject_id) do update
    set reapplied_at = case when p_channel = 'restore_reapply' then now() else erasure_tombstones.reapplied_at end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after_data)
  values (null, 'account.erased', 'profile', p_subject, jsonb_build_object('channel', p_channel, 'role', 'employer'));

  return jsonb_build_object(
    'memberships', v_members,
    'files', v_files,
    'emails', v_mails);
end $$;
revoke all on function public.erase_employer_subject(uuid, text, uuid) from public, anon, authenticated;

-- --- 3. Samoobsługowe usunięcie konta pracodawcy ------------------------------------------------
create or replace function public.request_employer_account_erasure(p_confirm_email text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid     uuid := auth.uid();
  v_role    public.user_role;
  v_email   text;
  v_request uuid;
  v_counts  jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select p.role, p.email::text into v_role, v_email
    from public.profiles p
   where p.id = v_uid and p.is_active and p.deleted_at is null
   for update;
  if not found or v_role <> 'employer' then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if v_email is null or p_confirm_email is null
     or lower(btrim(p_confirm_email)) <> lower(btrim(v_email)) then
    raise exception 'VALIDATION_FAILED: CONFIRMATION_MISMATCH' using errcode = '22023';
  end if;

  insert into public.data_rights_requests (subject_id, kind, channel, due_at)
  values (v_uid, 'erasure', 'self_service', now() + interval '1 month')
  returning id into v_request;

  -- COMPANY_LAST_OWNER przerywa całą transakcję (także ślad wniosku).
  v_counts := public.erase_employer_subject(v_uid, 'self_service', v_request);

  update public.data_rights_requests
     set completed_at = now(), details = v_counts
   where id = v_request;
  return jsonb_build_object('requestId', v_request, 'erased', true);
end $$;
revoke all on function public.request_employer_account_erasure(text) from public, anon;
grant execute on function public.request_employer_account_erasure(text) to authenticated;

-- --- 1. Eksport danych pracodawcy -----------------------------------------------------------------
create or replace function public.export_my_employer_data()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid     uuid := auth.uid();
  v_role    public.user_role;
  v_email   text;
  v_request uuid;
  v_out     jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select p.role, p.email::text into v_role, v_email from public.profiles p
   where p.id = v_uid and p.is_active and p.deleted_at is null;
  if not found or v_role <> 'employer' then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if (select count(*) from public.data_rights_requests r
       where r.subject_id = v_uid and r.kind = 'access' and r.requested_at > now() - interval '1 day') >= 10 then
    raise exception 'RATE_LIMITED' using errcode = '42501';
  end if;

  insert into public.data_rights_requests (subject_id, kind, channel, due_at, completed_at)
  values (v_uid, 'access', 'self_service', now() + interval '1 month', now())
  returning id into v_request;

  v_out := jsonb_build_object(
    'format', 'pracujbe-export/1',
    'accountType', 'employer',
    'generatedAt', now(),
    'requestId', v_request,
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'createdAt', u.created_at)
                  from auth.users u where u.id = v_uid),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid),
    'employerProfile', (select to_jsonb(ep) - 'profile_id' from public.employer_profiles ep where ep.profile_id = v_uid),
    'memberships', (select coalesce(jsonb_agg(jsonb_build_object(
                        'companyId', m.company_id,
                        'companyName', (select co.name from public.companies co where co.id = m.company_id),
                        'role', m.role, 'active', m.is_active,
                        'invitedAt', m.invited_at, 'joinedAt', m.joined_at, 'createdAt', m.created_at)
                        order by m.created_at), '[]')
                      from public.company_members m where m.profile_id = v_uid),
    -- Adres zaproszonego wpisała ta osoba; token (hash) i znaczniki techniczne pominięte.
    'invitationsSent', (select coalesce(jsonb_agg(jsonb_build_object(
                            'companyName', (select co.name from public.companies co where co.id = i.company_id),
                            'email', i.email, 'role', i.role, 'status', i.status, 'locale', i.locale,
                            'createdAt', i.created_at, 'expiresAt', i.expires_at, 'respondedAt', i.responded_at)
                            order by i.created_at), '[]')
                          from public.company_invitations i where i.invited_by = v_uid),
    'invitationsReceived', (select coalesce(jsonb_agg(jsonb_build_object(
                                'companyName', (select co.name from public.companies co where co.id = i.company_id),
                                'role', i.role, 'status', i.status,
                                'createdAt', i.created_at, 'expiresAt', i.expires_at, 'respondedAt', i.responded_at)
                                order by i.created_at), '[]')
                              from public.company_invitations i
                             where v_email is not null and lower(i.email::text) = lower(v_email)),
    'jobsCreated', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', j.id, 'title', j.title, 'status', j.status,
                        'companyName', (select co.name from public.companies co where co.id = j.company_id),
                        'createdAt', j.created_at, 'deletedAt', j.deleted_at)
                        order by j.created_at), '[]')
                      from public.jobs j where j.created_by = v_uid),
    -- Akcje, w których osoba jest aktorem. Bez before/after_data (mogą zawierać dane
    -- kandydatów); identyfikator tylko dla obiektów firmowych.
    'auditActions', (select coalesce(jsonb_agg(jsonb_build_object(
                         'action', a.action, 'entityType', a.entity_type,
                         'entityId', case when a.entity_type in ('company', 'job', 'company_member', 'company_invitation')
                                          then a.entity_id end,
                         'at', a.created_at)
                         order by a.created_at), '[]')
                       from public.audit_logs a where a.actor_id = v_uid),
    'notificationPreferences', (select to_jsonb(np) - 'profile_id' from public.notification_preferences np
                                  where np.profile_id = v_uid),
    -- Bez tytułu, treści i danych — powiadomienia pracodawcy dotyczą zgłoszeń kandydatów.
    'notifications', (select coalesce(jsonb_agg(jsonb_build_object(
                          'type', n.type, 'entityType', n.entity_type, 'readAt', n.read_at, 'createdAt', n.created_at)
                          order by n.created_at), '[]')
                        from public.notifications n where n.profile_id = v_uid),
    'consents', (select coalesce(jsonb_agg(to_jsonb(cs) - 'profile_id' order by cs.created_at), '[]')
                   from public.consents cs where cs.profile_id = v_uid),
    'emailConsentEvents', (select coalesce(jsonb_agg(to_jsonb(ec) - 'profile_id' order by ec.created_at), '[]')
                             from public.email_consent_events ec where ec.profile_id = v_uid),
    'documentAcceptances', (select coalesce(jsonb_agg(to_jsonb(d) - 'profile_id' order by d.accepted_at), '[]')
                              from public.document_acceptances d where d.profile_id = v_uid),
    'emails', (select coalesce(jsonb_agg(jsonb_build_object(
                   'template', e.template, 'locale', e.locale, 'status', e.status, 'toEmail', e.to_email,
                   'queuedAt', e.queued_at, 'sentAt', e.sent_at) order by e.created_at), '[]')
                 from public.email_deliveries e where e.profile_id = v_uid),
    'dataRightsRequests', (select coalesce(jsonb_agg(jsonb_build_object(
                               'id', r.id, 'kind', r.kind, 'requestedAt', r.requested_at, 'completedAt', r.completed_at)
                               order by r.requested_at), '[]')
                             from public.data_rights_requests r where r.subject_id = v_uid)
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id)
  values (v_uid, 'data.exported', 'profile', v_uid);
  return v_out;
end $$;
revoke all on function public.export_my_employer_data() from public, anon;
grant execute on function public.export_my_employer_data() to authenticated;

-- --- 4. Ponowne usunięcie po restore: wybór funkcji wg roli --------------------------------------
create or replace function public.apply_erasure_tombstones(p_subjects uuid[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_subject uuid;
  v_request uuid;
  v_role    public.user_role;
  v_reapplied integer := 0;
  v_absent integer := 0;
begin
  if p_subjects is null or coalesce(array_length(p_subjects, 1), 0) > 100000 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  foreach v_subject in array p_subjects loop
    if exists (select 1 from public.profiles where id = v_subject)
       or exists (select 1 from auth.users where id = v_subject) then
      select p.role into v_role from public.profiles p where p.id = v_subject;
      insert into public.data_rights_requests (subject_id, kind, channel, due_at)
      values (v_subject, 'erasure', 'restore_reapply', now()) returning id into v_request;
      update public.data_rights_requests
         set details = case when v_role = 'employer'
                            then public.erase_employer_subject(v_subject, 'restore_reapply', v_request)
                            else public.erase_candidate_subject(v_subject, 'restore_reapply', v_request) end,
             completed_at = now()
       where id = v_request;
      v_reapplied := v_reapplied + 1;
    else
      insert into public.erasure_tombstones (subject_id, channel)
      values (v_subject, 'restore_reapply')
      on conflict (subject_id) do nothing;
      v_absent := v_absent + 1;
    end if;
  end loop;
  return jsonb_build_object('reapplied', v_reapplied, 'alreadyAbsent', v_absent);
end $$;
revoke all on function public.apply_erasure_tombstones(uuid[]) from public, anon, authenticated;
grant execute on function public.apply_erasure_tombstones(uuid[]) to service_role;
