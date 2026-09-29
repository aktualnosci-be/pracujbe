-- 0178_team_invitation_limit_excludes_expired.sql
--
-- Naprawa #893: limit 50 oczekujących zaproszeń w `invite_company_member` (0121) liczył
-- WSZYSTKIE wiersze `status = 'pending'`, także te z minionym `expires_at`. Panel
-- (`get_company_invitations`, 0086) pokazuje wyłącznie `pending` z `expires_at > now()`,
-- więc firma z 50 dawno wygasłymi zaproszeniami dostawała `INVITATION_LIMIT_REACHED`
-- i nie miała w UI żadnej pozycji do cofnięcia (wygasłe rekordy niewidoczne). Ujednolicenie
-- definicji „aktywnego zaproszenia”: limit liczy tylko `pending` z `expires_at > now()` —
-- dokładnie to, co widzi panel. Reszta funkcji (0121) bez zmian; sygnatura bez zmian.
create or replace function public.invite_company_member(
  p_company_id uuid, p_email text, p_role text,
  p_locale text, p_signup_token_hash text, p_signup_nonce text
) returns table (invitation_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role public.company_member_role;
  v_company_name text;
  v_existing uuid;
  v_id uuid;
  v_created boolean;
  v_invitee uuid;
  v_has_account boolean;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('admin', 'recruiter', 'member') then
    raise exception 'VALIDATION_FAILED: rola' using errcode = '22023';
  end if;
  v_role := p_role::public.company_member_role;
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'VALIDATION_FAILED: e-mail' using errcode = '22023';
  end if;
  if not public.is_supported_locale(p_locale) then
    raise exception 'VALIDATION_FAILED: język zaproszenia' using errcode = '22023';
  end if;
  if p_signup_token_hash is null or p_signup_token_hash !~ '^[0-9a-f]{64}$'
     or p_signup_nonce is null or p_signup_nonce !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'VALIDATION_FAILED: token' using errcode = '22023';
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
    -- Odświeżenie: rola, ważność, język; nowy token (poprzedni link przestaje działać).
    update public.company_invitations
      set role = v_role, expires_at = now() + interval '14 days', invited_by = v_uid,
          locale = p_locale, signup_token_hash = p_signup_token_hash,
          signup_token_used_at = null
      where id = v_existing;
    perform public.write_audit('company.member_invitation_updated', 'company', p_company_id,
      null, jsonb_build_object('invitation_id', v_existing, 'role', v_role, 'locale', p_locale));
    v_id := v_existing;
    v_created := false;
  else
    -- #893: liczymy tylko zaproszenia jeszcze WAŻNE (jak panel, get_company_invitations) —
    -- dawno wygasłe, nieodwiedzone rekordy nie zajmują limitu na zawsze.
    if (select count(*) from public.company_invitations i
          where i.company_id = p_company_id and i.status = 'pending'
            and i.expires_at > now()) >= 50 then
      raise exception 'INVITATION_LIMIT_REACHED' using errcode = '54000';
    end if;

    insert into public.company_invitations
      (company_id, email, role, invited_by, locale, signup_token_hash)
      values (p_company_id, v_email::public.citext, v_role, v_uid, p_locale, p_signup_token_hash)
      returning id into v_id;
    perform public.write_audit('company.member_invited', 'company', p_company_id,
      null, jsonb_build_object('invitation_id', v_id, 'role', v_role, 'locale', p_locale));
    v_created := true;
  end if;

  v_has_account := exists (select 1 from auth.users u where lower(u.email::text) = v_email);

  if v_created then
    -- Istniejące aktywne konto pracodawcy: powiadomienie + e-mail w języku ODBIORCY (0086).
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
  end if;

  -- Adres bez konta: link rejestracji pracodawcy w jawnie wybranym języku zaproszenia
  -- (nowe zaproszenie i odświeżenie — nowy token). Konto kandydata/nieaktywne: bez e-maila
  -- (jak w 0086). Wynik funkcji jest taki sam w każdym przypadku.
  if not v_has_account then
    perform public.enqueue_team_invitation_signup_email(v_id, v_email::public.citext, p_locale,
      'teamInvitationSignup', p_signup_token_hash,
      jsonb_build_object('nonce', p_signup_nonce,
                         'companyName', v_company_name,
                         'inviterName', coalesce(public.profile_full_name(v_uid), '')));
  end if;

  return query select v_id, v_created;
end $$;
revoke all on function public.invite_company_member(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.invite_company_member(uuid, text, text, text, text, text) to authenticated;
