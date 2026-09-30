-- =============================================================================
-- Rollback 0992 — eksport danych pracodawcy bez odwołań i zgłoszeń (#1232).
-- Uruchamiać ręcznie jako migrator, w jednej transakcji (psql -1 -f …), i dopiero wtedy
-- usunąć wpis z app_migrations.history. Plik celowo BEZ BEGIN/COMMIT
-- (supabase/tests/employer-export-0992-rollback.sql wykonuje go w transakcji i cofa).
--
-- Przywraca `export_my_employer_data` z 0161 (treść 1:1). Danych nie zmienia.
-- =============================================================================

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
