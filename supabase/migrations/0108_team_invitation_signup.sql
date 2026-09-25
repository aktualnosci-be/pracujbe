-- =============================================================================
-- 0108 — zaproszenie do zespołu firmy dla adresu BEZ konta (#403, „Otwarte”).
--
-- 0086 wysyłało e-mail zaproszenia tylko do istniejącego konta pracodawcy (język ODBIORCY
-- z profilu). Adres bez konta nie ma profilu, więc nie ma też `preferred/account/signup_locale`
-- (Invariant #1). Decyzja: zapraszający JAWNIE wybiera język zaproszenia (PL/NL/FR/EN;
-- w formularzu domyślnie język strony zapraszającego) — to jedyny znany język odbiorcy,
-- zapisany w `company_invitations.locale`. Konto z profilem nadal dostaje język z profilu.
--
-- 1. `company_invitations`: `locale` (wybrany język zaproszenia), `signup_token_hash`
--    (SHA-256 hex jednorazowego tokenu linku rejestracji — w bazie WYŁĄCZNIE hash),
--    `signup_token_used_at` (token zużyty rejestracją). Token = HMAC(sekret serwera,
--    "team-invite:" + nonce) liczy serwer aplikacji (akcja przy zapisie, worker przy renderze
--    linku) — jak aplikacja gościa (0095); `nonce` jest tylko w payloadzie e-maila, więc sam
--    odczyt bazy nie odtworzy linku. Hash znika, gdy zaproszenie przestaje oczekiwać.
-- 2. `invite_company_member(company, email, role, locale, token_hash, nonce)` zastępuje
--    wersję 3-argumentową. Istniejące konto pracodawcy — jak w 0086 (powiadomienie +
--    `teamInvitation` w języku z profilu). Adres bez konta — e-mail `teamInvitationSignup`
--    w języku zaproszenia z linkiem rejestracji pracodawcy (token we fragmencie `#`),
--    najwyżej 3 takie e-maile na adres na dobę (wszystkie firmy razem). Odświeżenie
--    oczekującego zaproszenia wymienia token (poprzedni link przestaje działać) i wysyła
--    nowy link. Wynik RPC (id, created) NIE zależy od tego, czy konto istnieje.
-- 3. `team_invitation_signup_preview(hash)` i `consume_team_invitation_signup(hash, email)`
--    — tylko service_role (strona rejestracji / akcja rejestracji). Token działa raz,
--    do końca ważności zaproszenia (14 dni) i wyłącznie dla adresu zaproszenia.
--    Rejestracja z tokenem NIE dołącza do firmy: po potwierdzeniu adresu zaproszenie czeka
--    w panelu (`get_my_company_invitations` — zweryfikowany ten sam adres), gdzie adresat
--    je przyjmuje albo odrzuca (`respond_to_company_invitation`, 0086 bez zmian).
--
-- Rollback: drop funkcji z pkt 2–3 i triggera, odtworzyć `invite_company_member(uuid,text,text)`
-- z 0086, `alter table company_invitations drop column locale, drop column signup_token_hash,
-- drop column signup_token_used_at`. Migracja nie zmienia istniejących danych.
-- =============================================================================

-- --- 1. Kolumny --------------------------------------------------------------------------
alter table public.company_invitations
  add column if not exists locale text references public.supported_locales(code),
  add column if not exists signup_token_hash text
    check (signup_token_hash is null or signup_token_hash ~ '^[0-9a-f]{64}$'),
  add column if not exists signup_token_used_at timestamptz;

create unique index if not exists company_invitations_signup_token_uq
  on public.company_invitations(signup_token_hash) where signup_token_hash is not null;

-- Zaproszenie rozstrzygnięte (przyjęte/odrzucone/cofnięte) — link rejestracji przestaje
-- istnieć także w bazie (minimalizacja: bez martwych hashy).
create or replace function public.company_invitation_clear_signup_token()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status <> 'pending' then
    new.signup_token_hash := null;
  end if;
  return new;
end $$;
revoke all on function public.company_invitation_clear_signup_token() from public, anon, authenticated;

drop trigger if exists trg_company_invitations_clear_signup_token on public.company_invitations;
create trigger trg_company_invitations_clear_signup_token
  before update on public.company_invitations
  for each row execute function public.company_invitation_clear_signup_token();

-- --- 2. E-mail na adres bez konta ---------------------------------------------------------
-- Odpowiednik enqueue_guest_email (0095) dla zaproszenia: odbiorca bez profilu, język =
-- jawnie wybrany język zaproszenia. Zwraca, czy wiersz trafił do kolejki.
create or replace function public.enqueue_team_invitation_signup_email(
  p_invitation_id uuid,
  p_to_email public.citext,
  p_locale text,
  p_type text,
  p_token_hash text,
  p_payload jsonb
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  if p_type is distinct from 'teamInvitationSignup' then
    raise exception 'VALIDATION_FAILED: nieznany typ e-maila zaproszenia' using errcode = '42501';
  end if;
  if not public.is_supported_locale(p_locale) then
    raise exception 'VALIDATION_FAILED: język zaproszenia' using errcode = '22023';
  end if;
  -- Ochrona adresu bez konta przed zasypaniem zaproszeniami (wszystkie firmy razem).
  select count(*) into v_count from public.email_deliveries d
    where d.template = 'teamInvitationSignup' and d.to_email = p_to_email
      and d.created_at > now() - interval '24 hours';
  if v_count >= 3 then
    return false;
  end if;
  insert into public.email_deliveries
    (profile_id, to_email, template, locale, subject, status, entity_type, entity_id,
     idempotency_key, payload, queued_at, next_attempt_at, attempts)
  values
    (null, p_to_email, p_type, p_locale, p_type, 'queued',
     'company_invitation', p_invitation_id,
     'team-invitation-signup:' || p_invitation_id::text || ':' || left(p_token_hash, 16),
     coalesce(p_payload, '{}'::jsonb), now(), now(), 0)
  on conflict (idempotency_key) where idempotency_key is not null
    do nothing;
  return found;
end $$;
revoke all on function public.enqueue_team_invitation_signup_email(uuid, public.citext, text, text, text, jsonb)
  from public, anon, authenticated;

-- --- 3. Zaproszenie z językiem i tokenem --------------------------------------------------
drop function if exists public.invite_company_member(uuid, text, text);

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
    if (select count(*) from public.company_invitations i
          where i.company_id = p_company_id and i.status = 'pending') >= 50 then
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

-- --- 4. Link rejestracji: podgląd i jednorazowe zużycie (service_role) ---------------------
-- Podgląd dla strony rejestracji: 'valid' (z danymi zaproszenia), 'used' (token już
-- zużyty), 'invalid' (nieznany, wygasły, rozstrzygnięty, usunięta firma) — bez rozróżniania,
-- dlaczego nieważny.
create or replace function public.team_invitation_signup_preview(p_token_hash text)
returns table (
  outcome text, invitation_id uuid, company_name text, role text, email text,
  locale text, expires_at timestamptz
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r record;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return query select 'invalid'::text, null::uuid, null::text, null::text, null::text,
                        null::text, null::timestamptz;
    return;
  end if;
  select i.id, i.email, i.role, i.locale, i.expires_at, i.signup_token_used_at, c.name
    into r
    from public.company_invitations i
    join public.companies c on c.id = i.company_id and c.deleted_at is null
    where i.signup_token_hash = p_token_hash and i.status = 'pending' and i.expires_at > now();
  if not found then
    return query select 'invalid'::text, null::uuid, null::text, null::text, null::text,
                        null::text, null::timestamptz;
    return;
  end if;
  if r.signup_token_used_at is not null then
    return query select 'used'::text, null::uuid, null::text, null::text, null::text,
                        r.locale::text, null::timestamptz;
    return;
  end if;
  return query select 'valid'::text, r.id, r.name::text, r.role::text, r.email::text,
                      r.locale::text, r.expires_at;
end $$;
revoke all on function public.team_invitation_signup_preview(text) from public, anon, authenticated;
grant execute on function public.team_invitation_signup_preview(text) to service_role;

-- Zużycie tokenu po rejestracji: tylko dla adresu zaproszenia, raz. Wynik:
-- 'consumed' | 'used' | 'email_mismatch' | 'invalid'.
create or replace function public.consume_team_invitation_signup(p_token_hash text, p_email text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.company_invitations%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return 'invalid'; end if;
  select * into r from public.company_invitations i
    where i.signup_token_hash = p_token_hash for update;
  if not found or r.status <> 'pending' or r.expires_at <= now()
     or not exists (select 1 from public.companies c
                    where c.id = r.company_id and c.deleted_at is null) then
    return 'invalid';
  end if;
  if r.signup_token_used_at is not null then return 'used'; end if;
  if r.email <> lower(btrim(coalesce(p_email, '')))::public.citext then
    return 'email_mismatch';
  end if;
  update public.company_invitations set signup_token_used_at = now() where id = r.id;
  perform public.write_audit('company.member_invitation_signup', 'company', r.company_id,
    null, jsonb_build_object('invitation_id', r.id));
  return 'consumed';
end $$;
revoke all on function public.consume_team_invitation_signup(text, text) from public, anon, authenticated;
grant execute on function public.consume_team_invitation_signup(text, text) to service_role;
