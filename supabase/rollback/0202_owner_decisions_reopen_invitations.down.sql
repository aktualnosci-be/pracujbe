-- =============================================================================
-- Rollback 0202 — przywraca `set_job_status` z 0085 i `erase_employer_subject` z 0161.
-- Zaproszenia z wyzerowanym adresem (skutek usunięcia konta) nie mogą wrócić do NOT NULL:
-- dostają adres zastępczy w domenie `.invalid` (ślad zdarzenia zostaje, osoby nie da się
-- odtworzyć). Opublikowane daty ponownie otwartych ofert zostają (dane, nie definicja).
-- =============================================================================

create or replace function public.set_job_status(p_job_id uuid, p_action text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid; v_cstatus text; v_status text; v_target text;
  v_title text; v_city text; v_region text;
  v_has_translation boolean; v_has_mandatory boolean;
  v_expires timestamptz; v_past_due boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_action not in ('pause', 'resume', 'close', 'reopen') then
    raise exception 'VALIDATION_FAILED: nieznana operacja' using errcode = '42501';
  end if;

  select j.company_id, c.status::text, j.status::text, j.title, j.city, j.region, j.expires_at
    into v_company, v_cstatus, v_status, v_title, v_city, v_region, v_expires
    from public.jobs j join public.companies c on c.id = j.company_id
    where j.id = p_job_id and j.deleted_at is null
    for update of j;

  if v_company is null then raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002'; end if;
  if not public.can_manage_jobs(v_company) then
    raise exception 'PERMISSION_DENIED: zarządzanie ofertą wymaga roli recruiter+' using errcode = '42501';
  end if;

  v_past_due := v_expires is not null and v_expires <= now();

  -- #72: wznowienie po terminie wymaga świadomego ponownego otwarcia (które usuwa datę).
  if p_action = 'resume' and v_status = 'paused' and v_past_due then
    raise exception 'JOB_EXPIRED: termin ważności oferty minął — otwórz ją ponownie' using errcode = '42501';
  end if;

  v_target := case
    when p_action = 'pause'  and v_status = 'active' and not v_past_due then 'paused'
    when p_action = 'resume' and v_status = 'paused'               then 'active'
    when p_action = 'close'  and v_status in ('active', 'paused')  then 'closed'
    when p_action = 'reopen' and v_status in ('closed', 'expired') then 'active'
    when p_action = 'reopen' and v_status in ('active', 'paused') and v_past_due then 'active'
    else null
  end;
  if v_target is null then
    raise exception 'VALIDATION_FAILED: niedozwolone przejście % z stanu %', p_action, v_status
      using errcode = '42501';
  end if;

  if v_target = 'active' then
    if v_cstatus <> 'verified' then
      raise exception 'COMPANY_NOT_VERIFIED: firma nie jest zweryfikowana' using errcode = '42501';
    end if;

    if p_action = 'reopen' then
      if v_title is null or btrim(v_title) = '' or v_title ilike 'draft%' or v_title ilike '%placeholder%'
         or v_city is null or btrim(v_city) = '' or v_region is null or btrim(v_region) = '' then
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
        raise exception 'VALIDATION_FAILED: oferta niekompletna (opis i obowiązki)' using errcode = '42501';
      end if;
      select exists (
        select 1 from public.job_requirements r
        where r.job_id = p_job_id and r.kind = 'mandatory' and coalesce(btrim(r.content), '') <> ''
      ) into v_has_mandatory;
      if not v_has_mandatory then
        raise exception 'VALIDATION_FAILED: brak wymagań obowiązkowych' using errcode = '42501';
      end if;
    end if;
  end if;

  update public.jobs
    set status = v_target::public.job_status,
        -- Przeszłą datę usuwa tylko ponowne otwarcie (resume po terminie jest odrzucane wyżej).
        expires_at = case
          when p_action = 'reopen' and v_past_due then null
          else expires_at
        end,
        published_at = case when v_target = 'active' and published_at is null then now() else published_at end,
        updated_at = now()
    where id = p_job_id and status::text = v_status;
  if not found then
    raise exception 'VALIDATION_FAILED: oferta zmieniła stan równolegle' using errcode = '42501';
  end if;

  return v_target;
end $$;
revoke all on function public.set_job_status(uuid, text) from public;
grant execute on function public.set_job_status(uuid, text) to authenticated;

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

alter table public.company_invitations drop constraint if exists company_invitations_email_when_pending;
update public.company_invitations set email = 'erased-' || id::text || '@erased.invalid' where email is null;
alter table public.company_invitations alter column email set not null;
