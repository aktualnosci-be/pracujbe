-- 0953_team_member_reactivation_hierarchy.sql (numer tymczasowy — ostateczny nada integrator)
--
-- #867: zaproszenie nie może obejść hierarchii ról przy przywracaniu wyłączonego członka.
-- Dotąd `invite_company_member` (0121/0178) sprawdzał tylko rolę DOCELOWĄ zaproszenia, a
-- `respond_to_company_invitation` (0086) przy przyjęciu reaktywował istniejący nieaktywny
-- wiersz `company_members` i nadpisywał jego rolę. Administrator, który nie może przywrócić
-- wyłączonego przez właściciela administratora (`set_company_member_active` sprawdza starą
-- rolę), mógł więc zaprosić go ponownie jako rekrutera i przywrócić mu dostęp.
--
-- Teraz przywrócenie przez zaproszenie wymaga, by zapraszający (aktywny członek firmy z
-- aktywnym, nieusuniętym profilem) mógł zarządzać zarówno DOTYCHCZASOWĄ rolą wyłączonego
-- członka, jak i rolą z zaproszenia — ta sama reguła co `set_company_member_active` /
-- `enforce_owner_invariants` (owner zarządza każdym, admin tylko recruiter/member):
--   1. strażnik BEFORE INSERT/UPDATE na `company_invitations` odrzuca utworzenie i odświeżenie
--      takiego zaproszenia (`MEMBER_REACTIVATION_DENIED`) — bez redefinicji
--      `invite_company_member`, więc każda wersja tej funkcji (i każda inna ścieżka zapisu)
--      jest objęta;
--   2. `respond_to_company_invitation` sprawdza to ponownie przy przyjęciu
--      (`REACTIVATION_NOT_ALLOWED`, członkostwo i zaproszenie bez zmian) — obejmuje zaproszenia
--      wysłane przed tą migracją oraz zapraszającego, który w międzyczasie stracił uprawnienia.
-- Nowy członek (bez wiersza `company_members`) i aktywny członek — bez zmian.

-- Czy profil p_actor (nie sesja) może zarządzać rolą p_role w firmie. Lustro
-- `can_manage_company_role` (0086) dla zapraszającego zapisanego w `invited_by`.
-- SECURITY INVOKER: wołana wyłącznie z funkcji definera i strażnika; bez EXECUTE dla klientów.
create or replace function public.company_role_manageable_by(
  p_company_id uuid, p_actor uuid, p_role public.company_member_role
) returns boolean language sql stable set search_path = public, pg_temp as $$
  select p_actor is not null and exists (
    select 1 from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = p_company_id
      and cm.profile_id = p_actor
      and cm.is_active = true
      and p.is_active and p.deleted_at is null
      and (cm.role = 'owner' or (cm.role = 'admin' and p_role in ('recruiter', 'member')))
  );
$$;
revoke all on function public.company_role_manageable_by(uuid, uuid, public.company_member_role)
  from public, anon, authenticated;

-- Czy zaproszenie (firma, adres, rola, zapraszający) przywróciłoby wyłączonego członka wbrew
-- hierarchii. Brak nieaktywnego członkostwa dla adresu = false (zwykłe zaproszenie).
create or replace function public.invitation_reactivation_denied(
  p_company_id uuid, p_email public.citext, p_role public.company_member_role, p_inviter uuid
) returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.company_members cm
    join auth.users u on u.id = cm.profile_id
    where cm.company_id = p_company_id
      and not cm.is_active
      and lower(u.email::text) = lower(p_email::text)
      and not (public.company_role_manageable_by(p_company_id, p_inviter, cm.role)
               and public.company_role_manageable_by(p_company_id, p_inviter, p_role))
  );
$$;
revoke all on function public.invitation_reactivation_denied(uuid, public.citext, public.company_member_role, uuid)
  from public, anon, authenticated;

create or replace function public.guard_invitation_reactivation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status <> 'pending' then return new; end if;
  if tg_op = 'UPDATE'
     and new.role is not distinct from old.role
     and new.invited_by is not distinct from old.invited_by
     and new.email is not distinct from old.email
     and new.expires_at is not distinct from old.expires_at
     and old.status = 'pending' then
    return new; -- np. zużycie tokenu rejestracji: zaproszenie się nie zmienia
  end if;
  if public.invitation_reactivation_denied(new.company_id, new.email, new.role, new.invited_by) then
    raise exception 'MEMBER_REACTIVATION_DENIED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_invitation_reactivation() from public, anon, authenticated;

drop trigger if exists trg_company_invitations_reactivation_guard on public.company_invitations;
create trigger trg_company_invitations_reactivation_guard
  before insert or update on public.company_invitations
  for each row execute function public.guard_invitation_reactivation();

-- Przyjęcie zaproszenia: definicja z 0086 + kontrola hierarchii przy reaktywacji.
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
    -- #867: przywrócić wyłączonego członka może tylko ktoś, kto zarządza jego dotychczasową
    -- rolą i rolą z zaproszenia (jak set_company_member_active) — sprawdzane w chwili przyjęcia.
    if not public.company_role_manageable_by(v_inv.company_id, v_inv.invited_by, v_member.role)
       or not public.company_role_manageable_by(v_inv.company_id, v_inv.invited_by, v_inv.role) then
      raise exception 'REACTIVATION_NOT_ALLOWED' using errcode = '42501';
    end if;
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
