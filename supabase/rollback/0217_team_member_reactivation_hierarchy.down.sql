-- =============================================================================
-- Rollback 0217_team_member_reactivation_hierarchy.sql (#867) — ręczny, NIE jest migracją.
-- Usuwa strażnika zaproszeń i funkcje pomocnicze; `respond_to_company_invitation` wraca do
-- definicji z 0086 (reaktywacja bez kontroli hierarchii). Test:
-- supabase/tests/team-reactivation-rollback.sql.
-- =============================================================================

drop trigger if exists trg_company_invitations_reactivation_guard on public.company_invitations;
drop function if exists public.guard_invitation_reactivation();
drop function if exists public.invitation_reactivation_denied(uuid, public.citext, public.company_member_role, uuid);

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

drop function if exists public.company_role_manageable_by(uuid, uuid, public.company_member_role);
