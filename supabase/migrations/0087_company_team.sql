-- =============================================================================
-- 0087 — zespół firmy i kolejna firma (#403).
--
-- 1. `company_invitations` — zaproszenia do zespołu firmy po adresie e-mail (rola
--    admin/recruiter/member; owner nigdy przez zaproszenie). Tabela bez grantów dla
--    klienta i z RLS bez polityk — odczyt i zapis wyłącznie przez RPC poniżej.
-- 2. Hierarchia zarządzania zespołem (jedno źródło: `can_manage_company_role`):
--    owner zarządza każdym członkiem; admin tylko rolami recruiter/member (nie nadaje
--    admin/owner i nie zmienia admina/ownera). Nikt nie zmienia własnego członkostwa przez
--    RPC zespołu. Firma zawsze ma co najmniej jednego aktywnego ownera — sprawdzane jawnie
--    w RPC (SECURITY DEFINER działa jako właściciel funkcji, więc trigger 0032 go pomija).
-- 3. RPC: get_company_team, get_company_invitations, invite_company_member,
--    revoke_company_invitation, get_my_company_invitations, respond_to_company_invitation,
--    set_company_member_role, set_company_member_active, create_additional_company.
--    Każda zmiana → audit_logs. Zaproszenie istniejącego konta pracodawcy → powiadomienie
--    in-app + e-mail `teamInvitation` w języku ODBIORCY (enqueue_email, Invariant #1).
--    Odpowiedź RPC nie zależy od tego, czy konto istnieje. Zaproszenie przyjmuje wyłącznie
--    właściciel adresu (zweryfikowany e-mail sesji), z kontem pracodawcy.
-- 4. `enforce_owner_invariants` (0032) — ta sama hierarchia dla bezpośredniego DML
--    klienta; bezpośredni INSERT członkostwa odebrany (dołączenie tylko przez zaproszenie).
-- 5. `create_additional_company` — kolejna firma zalogowanego pracodawcy (owner), limit
--    5 firm z rolą owner, idempotentnie dla podwójnego kliknięcia (ta sama nazwa ≤ 10 min).
--
-- Rollback: `drop table public.company_invitations cascade`, drop nowych funkcji,
-- odtworzyć `enforce_owner_invariants` z 0032 oraz
-- `grant insert on public.company_members to authenticated`. Migracja nie zmienia danych.
-- =============================================================================

-- --- 1. Zaproszenia ----------------------------------------------------------------------
create table public.company_invitations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  email        public.citext not null
               check (char_length(email::text) between 3 and 254),
  role         public.company_member_role not null
               check (role in ('admin', 'recruiter', 'member')),
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'declined', 'revoked')),
  invited_by   uuid references public.profiles(id) on delete set null,
  responded_by uuid references public.profiles(id) on delete set null,
  expires_at   timestamptz not null default now() + interval '14 days',
  responded_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index company_invitations_pending_uq
  on public.company_invitations(company_id, email) where status = 'pending';
create index company_invitations_email_idx
  on public.company_invitations(email) where status = 'pending';

alter table public.company_invitations enable row level security;
revoke all on public.company_invitations from public, anon, authenticated;

drop trigger if exists trg_company_invitations_updated_at on public.company_invitations;
create trigger trg_company_invitations_updated_at
  before update on public.company_invitations
  for each row execute function public.set_updated_at();

-- --- 2. Hierarchia -----------------------------------------------------------------------
-- Czy bieżący użytkownik może zarządzać członkiem o roli p_role (lub nadać ją) w firmie.
create or replace function public.can_manage_company_role(
  p_company_id uuid, p_role public.company_member_role
) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.company_members cm
    where cm.company_id = p_company_id
      and cm.profile_id = auth.uid()
      and cm.is_active = true
      and (cm.role = 'owner' or (cm.role = 'admin' and p_role in ('recruiter', 'member')))
  );
$$;
revoke all on function public.can_manage_company_role(uuid, public.company_member_role)
  from public, anon;
grant execute on function public.can_manage_company_role(uuid, public.company_member_role)
  to authenticated;

-- Zweryfikowany adres e-mail bieżącej sesji (Better Auth: email_verified; Supabase:
-- email_confirmed_at). Brak weryfikacji → null (zaproszeń nie widać i nie da się przyjąć).
create or replace function public.current_verified_email()
returns public.citext language sql stable security definer set search_path = public, pg_temp as $$
  select u.email::public.citext
  from auth.users u
  where u.id = auth.uid()
    and coalesce((to_jsonb(u) ->> 'email_verified')::boolean,
                 (to_jsonb(u) ->> 'email_confirmed_at') is not null,
                 false);
$$;
revoke all on function public.current_verified_email() from public, anon, authenticated;

-- --- 4. Trigger 0032 z hierarchią dla bezpośredniego DML klienta --------------------------
create or replace function public.enforce_owner_invariants()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Zaufane role (bootstrap/RPC definer=postgres, admin=service_role, seed) — pomijamy.
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'owner' and not public.is_company_owner(new.company_id) then
      raise exception 'PERMISSION_DENIED: rolę owner nadaje wyłącznie właściciel firmy'
        using errcode = '42501';
    end if;
    if not public.can_manage_company_role(new.company_id, new.role) then
      raise exception 'PERMISSION_DENIED: brak uprawnień do tej roli' using errcode = '42501';
    end if;
    return new;

  elsif tg_op = 'UPDATE' then
    -- Nadanie lub odebranie roli owner tylko przez aktywnego ownera.
    if (new.role = 'owner') is distinct from (old.role = 'owner') then
      if not public.is_company_owner(new.company_id) then
        raise exception 'PERMISSION_DENIED: zmianę roli owner wykonuje wyłącznie właściciel firmy'
          using errcode = '42501';
      end if;
    end if;
    -- #403: zmiana roli/aktywności wymaga uprawnień do starej i nowej roli.
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      if not public.can_manage_company_role(old.company_id, old.role)
         or not public.can_manage_company_role(old.company_id, new.role) then
        raise exception 'PERMISSION_DENIED: brak uprawnień do tej roli' using errcode = '42501';
      end if;
    end if;
    -- Nie pozostaw firmy bez aktywnego ownera (demote lub dezaktywacja ostatniego).
    if (old.role = 'owner' and old.is_active)
       and (new.role <> 'owner' or new.is_active = false) then
      if public.count_other_active_owners(old.company_id, old.id) = 0 then
        raise exception 'VALIDATION_FAILED: firma musi mieć co najmniej jednego aktywnego właściciela'
          using errcode = '42501';
      end if;
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    -- Usunięcie cudzego członkostwa tylko w granicach hierarchii (własne = opuszczenie firmy).
    if old.profile_id is distinct from auth.uid()
       and not public.can_manage_company_role(old.company_id, old.role) then
      raise exception 'PERMISSION_DENIED: brak uprawnień do tej roli' using errcode = '42501';
    end if;
    if old.role = 'owner' and old.is_active then
      if public.count_other_active_owners(old.company_id, old.id) = 0 then
        raise exception 'VALIDATION_FAILED: nie można usunąć ostatniego aktywnego właściciela firmy'
          using errcode = '42501';
      end if;
    end if;
    return old;
  end if;
  return new;
end $$;

-- Dołączenie do firmy tylko przez przyjęcie zaproszenia (zgoda zapraszanego).
revoke insert on public.company_members from anon, authenticated;

-- --- 3. RPC zespołu ----------------------------------------------------------------------

-- Lista członków firmy (owner/admin). E-mail członka widzi wyłącznie zarządzający zespołem.
create or replace function public.get_company_team(p_company_id uuid)
returns table (
  member_id uuid, profile_id uuid, first_name text, last_name text, email text,
  role text, is_active boolean, joined_at timestamptz, created_at timestamptz,
  is_self boolean
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_company_admin(p_company_id) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  return query
    select cm.id, cm.profile_id, p.first_name::text, p.last_name::text,
           coalesce(p.email::text, u.email::text), cm.role::text, cm.is_active,
           coalesce(cm.joined_at, cm.created_at), cm.created_at, cm.profile_id = auth.uid()
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    left join auth.users u on u.id = cm.profile_id
    where cm.company_id = p_company_id
    order by cm.is_active desc,
             case cm.role when 'owner' then 1 when 'admin' then 2 when 'recruiter' then 3 else 4 end,
             cm.created_at, cm.id;
end $$;
revoke all on function public.get_company_team(uuid) from public, anon;
grant execute on function public.get_company_team(uuid) to authenticated;

-- Oczekujące (niewygasłe) zaproszenia firmy (owner/admin).
create or replace function public.get_company_invitations(p_company_id uuid)
returns table (
  invitation_id uuid, email text, role text, expires_at timestamptz, created_at timestamptz
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_company_admin(p_company_id) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  return query
    select i.id, i.email::text, i.role::text, i.expires_at, i.created_at
    from public.company_invitations i
    where i.company_id = p_company_id and i.status = 'pending' and i.expires_at > now()
    order by i.created_at desc, i.id
    limit 100;
end $$;
revoke all on function public.get_company_invitations(uuid) from public, anon;
grant execute on function public.get_company_invitations(uuid) to authenticated;

-- Zaproszenie do zespołu. Idempotentne: oczekujące zaproszenie tego adresu jest
-- odświeżane (rola, ważność) zamiast dublowane; e-mail wysyłany raz na zaproszenie.
create or replace function public.invite_company_member(
  p_company_id uuid, p_email text, p_role text
) returns table (invitation_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role public.company_member_role;
  v_company_name text;
  v_existing uuid;
  v_id uuid;
  v_invitee uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('admin', 'recruiter', 'member') then
    raise exception 'VALIDATION_FAILED: rola' using errcode = '22023';
  end if;
  v_role := p_role::public.company_member_role;
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'VALIDATION_FAILED: e-mail' using errcode = '22023';
  end if;
  if not public.can_manage_company_role(p_company_id, v_role) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;

  select c.name into v_company_name from public.companies c
    where c.id = p_company_id and c.deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  if exists (
    select 1 from public.company_members cm
    join auth.users u on u.id = cm.profile_id
    where cm.company_id = p_company_id and cm.is_active and lower(u.email::text) = v_email
  ) then
    raise exception 'MEMBER_ALREADY_EXISTS' using errcode = '23505';
  end if;

  -- Wygasłe oczekujące zaproszenie nie blokuje nowego.
  update public.company_invitations
    set status = 'revoked', responded_at = now()
    where company_id = p_company_id and email = v_email::public.citext
      and status = 'pending' and expires_at <= now();

  select i.id into v_existing from public.company_invitations i
    where i.company_id = p_company_id and i.email = v_email::public.citext
      and i.status = 'pending'
    for update;
  if v_existing is not null then
    update public.company_invitations
      set role = v_role, expires_at = now() + interval '14 days', invited_by = v_uid
      where id = v_existing;
    perform public.write_audit('company.member_invitation_updated', 'company', p_company_id,
      null, jsonb_build_object('invitation_id', v_existing, 'role', v_role));
    return query select v_existing, false;
    return;
  end if;

  if (select count(*) from public.company_invitations i
        where i.company_id = p_company_id and i.status = 'pending') >= 50 then
    raise exception 'INVITATION_LIMIT_REACHED' using errcode = '54000';
  end if;

  insert into public.company_invitations (company_id, email, role, invited_by)
    values (p_company_id, v_email::public.citext, v_role, v_uid)
    returning id into v_id;

  perform public.write_audit('company.member_invited', 'company', p_company_id,
    null, jsonb_build_object('invitation_id', v_id, 'role', v_role));

  -- Istniejące aktywne konto pracodawcy: powiadomienie + e-mail w języku ODBIORCY.
  select p.id into v_invitee
    from auth.users u join public.profiles p on p.id = u.id
    where lower(u.email::text) = v_email
      and p.role = 'employer' and p.is_active and p.deleted_at is null
    limit 1;
  if v_invitee is not null then
    insert into public.notifications (profile_id, type, title, entity_type, entity_id)
      values (v_invitee, 'system', 'company_invitation', 'company_invitation', v_id);
    perform public.enqueue_email(v_invitee, 'teamInvitation', 'company_invitation', v_id,
      'team-invitation:' || v_id::text,
      jsonb_build_object('panel', 'employer',
                         'companyName', v_company_name,
                         'inviterName', coalesce(public.profile_full_name(v_uid), '')));
  end if;

  return query select v_id, true;
end $$;
revoke all on function public.invite_company_member(uuid, text, text) from public, anon;
grant execute on function public.invite_company_member(uuid, text, text) to authenticated;

-- Cofnięcie oczekującego zaproszenia (w granicach hierarchii ról).
create or replace function public.revoke_company_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_company uuid; v_role public.company_member_role; v_status text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select i.company_id, i.role, i.status into v_company, v_role, v_status
    from public.company_invitations i where i.id = p_invitation_id for update;
  if not found or not public.is_company_admin(v_company) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.can_manage_company_role(v_company, v_role) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if v_status <> 'pending' then return; end if; -- już rozstrzygnięte: idempotentnie
  update public.company_invitations
    set status = 'revoked', responded_by = auth.uid(), responded_at = now()
    where id = p_invitation_id;
  perform public.write_audit('company.member_invitation_revoked', 'company', v_company,
    null, jsonb_build_object('invitation_id', p_invitation_id));
end $$;
revoke all on function public.revoke_company_invitation(uuid) from public, anon;
grant execute on function public.revoke_company_invitation(uuid) to authenticated;

-- Zaproszenia skierowane do zalogowanego (po zweryfikowanym adresie e-mail sesji).
create or replace function public.get_my_company_invitations()
returns table (
  invitation_id uuid, company_id uuid, company_name text, role text,
  inviter_name text, expires_at timestamptz
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_email public.citext := public.current_verified_email();
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if v_email is null then return; end if;
  return query
    select i.id, c.id, c.name::text, i.role::text,
           coalesce(public.profile_full_name(i.invited_by), ''), i.expires_at
    from public.company_invitations i
    join public.companies c on c.id = i.company_id and c.deleted_at is null
    where i.email = v_email and i.status = 'pending' and i.expires_at > now()
      and not exists (
        select 1 from public.company_members cm
        where cm.company_id = i.company_id and cm.profile_id = auth.uid() and cm.is_active)
    order by i.created_at desc, i.id
    limit 20;
end $$;
revoke all on function public.get_my_company_invitations() from public, anon;
grant execute on function public.get_my_company_invitations() to authenticated;

-- Przyjęcie / odrzucenie zaproszenia przez adresata. Obce, wygasłe lub nieistniejące
-- zaproszenie → NOT_FOUND (bez ujawniania, czy istnieje). Zwraca id firmy.
create or replace function public.respond_to_company_invitation(
  p_invitation_id uuid, p_accept boolean
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_email public.citext := public.current_verified_email();
  v_inv public.company_invitations%rowtype;
  v_member public.company_members%rowtype;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into v_inv from public.company_invitations i where i.id = p_invitation_id for update;
  if not found or v_email is null or v_inv.email <> v_email then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_inv.status = 'accepted' and v_inv.responded_by = v_uid and p_accept then
    return v_inv.company_id; -- ponowienie tego samego przyjęcia
  end if;
  if v_inv.status <> 'pending' or v_inv.expires_at <= now() then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if not p_accept then
    update public.company_invitations
      set status = 'declined', responded_by = v_uid, responded_at = now()
      where id = v_inv.id;
    perform public.write_audit('company.member_invitation_declined', 'company', v_inv.company_id,
      null, jsonb_build_object('invitation_id', v_inv.id));
    return v_inv.company_id;
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.role = 'employer' and p.is_active and p.deleted_at is null
  ) then
    raise exception 'PERMISSION_DENIED: zaproszenie przyjmuje konto pracodawcy' using errcode = '42501';
  end if;
  if not exists (select 1 from public.companies c
                 where c.id = v_inv.company_id and c.deleted_at is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_member from public.company_members cm
    where cm.company_id = v_inv.company_id and cm.profile_id = v_uid for update;
  if not found then
    insert into public.company_members
      (company_id, profile_id, role, is_active, invited_by, invited_at, joined_at)
      values (v_inv.company_id, v_uid, v_inv.role, true, v_inv.invited_by, v_inv.created_at, now());
  elsif not v_member.is_active then
    update public.company_members
      set role = v_inv.role, is_active = true, invited_by = v_inv.invited_by,
          invited_at = v_inv.created_at, joined_at = now()
      where id = v_member.id;
  end if; -- aktywny członek: rola bez zmian (zaproszenie nie degraduje)

  update public.company_invitations
    set status = 'accepted', responded_by = v_uid, responded_at = now()
    where id = v_inv.id;
  perform public.write_audit('company.member_joined', 'company', v_inv.company_id,
    null, jsonb_build_object('invitation_id', v_inv.id, 'role', v_inv.role));
  return v_inv.company_id;
end $$;
revoke all on function public.respond_to_company_invitation(uuid, boolean) from public, anon;
grant execute on function public.respond_to_company_invitation(uuid, boolean) to authenticated;

-- Zmiana roli członka.
create or replace function public.set_company_member_role(p_member_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_m public.company_members%rowtype; v_role public.company_member_role;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('owner', 'admin', 'recruiter', 'member') then
    raise exception 'VALIDATION_FAILED: rola' using errcode = '22023';
  end if;
  v_role := p_role::public.company_member_role;
  select * into v_m from public.company_members cm where cm.id = p_member_id for update;
  if not found or not public.is_company_admin(v_m.company_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_m.profile_id = auth.uid() then
    raise exception 'VALIDATION_FAILED: własne członkostwo' using errcode = '22023';
  end if;
  if not public.can_manage_company_role(v_m.company_id, v_m.role)
     or not public.can_manage_company_role(v_m.company_id, v_role) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if not v_m.is_active then
    raise exception 'VALIDATION_FAILED: członkostwo nieaktywne' using errcode = '22023';
  end if;
  if v_m.role = v_role then return; end if;
  if v_m.role = 'owner' and public.count_other_active_owners(v_m.company_id, v_m.id) = 0 then
    raise exception 'VALIDATION_FAILED: firma musi mieć co najmniej jednego aktywnego właściciela'
      using errcode = '42501';
  end if;
  update public.company_members set role = v_role where id = v_m.id;
  perform public.write_audit('company.member_role_changed', 'company', v_m.company_id,
    jsonb_build_object('member_id', v_m.id, 'role', v_m.role),
    jsonb_build_object('member_id', v_m.id, 'role', v_role));
end $$;
revoke all on function public.set_company_member_role(uuid, text) from public, anon;
grant execute on function public.set_company_member_role(uuid, text) to authenticated;

-- Dezaktywacja / przywrócenie członka (bez usuwania historii).
create or replace function public.set_company_member_active(p_member_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_m public.company_members%rowtype;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_active is null then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  select * into v_m from public.company_members cm where cm.id = p_member_id for update;
  if not found or not public.is_company_admin(v_m.company_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_m.profile_id = auth.uid() then
    raise exception 'VALIDATION_FAILED: własne członkostwo' using errcode = '22023';
  end if;
  if not public.can_manage_company_role(v_m.company_id, v_m.role) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if v_m.is_active = p_active then return; end if;
  if not p_active and v_m.role = 'owner'
     and public.count_other_active_owners(v_m.company_id, v_m.id) = 0 then
    raise exception 'VALIDATION_FAILED: firma musi mieć co najmniej jednego aktywnego właściciela'
      using errcode = '42501';
  end if;
  update public.company_members set is_active = p_active where id = v_m.id;
  perform public.write_audit(
    case when p_active then 'company.member_reactivated' else 'company.member_deactivated' end,
    'company', v_m.company_id,
    jsonb_build_object('member_id', v_m.id, 'is_active', v_m.is_active),
    jsonb_build_object('member_id', v_m.id, 'is_active', p_active));
end $$;
revoke all on function public.set_company_member_active(uuid, boolean) from public, anon;
grant execute on function public.set_company_member_active(uuid, boolean) to authenticated;

-- --- 5. Kolejna firma --------------------------------------------------------------------
create or replace function public.create_additional_company(
  p_name text, p_slug text, p_vat_number text default null
) returns table (company_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_vat text := nullif(btrim(coalesce(p_vat_number, '')), '');
  v_role text; v_active boolean; v_deleted timestamptz;
  v_existing uuid; v_id uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 200 then
    raise exception 'VALIDATION_FAILED: nazwa' using errcode = '22023';
  end if;

  -- Blokada profilu serializuje równoległe kliknięcia.
  select p.role::text, p.is_active, p.deleted_at into v_role, v_active, v_deleted
    from public.profiles p where p.id = v_uid for update;
  if v_role is distinct from 'employer' or v_active is not true or v_deleted is not null then
    raise exception 'PERMISSION_DENIED: firmę zakłada konto pracodawcy' using errcode = '42501';
  end if;

  -- Podwójne kliknięcie / retry: ta sama nazwa założona przed chwilą → ta sama firma.
  select c.id into v_existing
    from public.companies c
    join public.company_members cm on cm.company_id = c.id
    where cm.profile_id = v_uid and cm.role = 'owner' and cm.is_active
      and c.deleted_at is null and lower(c.name) = lower(v_name)
      and c.created_at > now() - interval '10 minutes'
    order by c.created_at desc limit 1;
  if v_existing is not null then
    return query select v_existing, false;
    return;
  end if;

  if (select count(*) from public.company_members cm
        join public.companies c on c.id = cm.company_id and c.deleted_at is null
        where cm.profile_id = v_uid and cm.role = 'owner' and cm.is_active) >= 5 then
    raise exception 'COMPANY_LIMIT_REACHED' using errcode = '54000';
  end if;

  insert into public.companies (name, slug, status, vat_number)
    values (v_name, p_slug, 'unverified', v_vat)
    returning id into v_id;
  insert into public.company_members (company_id, profile_id, role, is_active, joined_at)
    values (v_id, v_uid, 'owner', true, now());
  perform public.write_audit('company.created', 'company', v_id, null,
    jsonb_build_object('source', 'additional_company'));
  return query select v_id, true;
end $$;
revoke all on function public.create_additional_company(text, text, text) from public, anon;
grant execute on function public.create_additional_company(text, text, text) to authenticated;
