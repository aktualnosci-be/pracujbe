-- =============================================================================
-- 0133 — utwardzenie limitu e-maili `teamInvitationSignup` na adres (#403, 0121).
--
-- `enqueue_team_invitation_signup_email` sprawdzał limit „najwyżej 3 e-maile na adres
-- w 24 h” osobnym `COUNT(*)` przed `INSERT`-em — dwa równoległe wywołania (np. zaproszenia
-- z różnych firm dla tego samego adresu bez konta) mogły odczytać ten sam licznik i obie
-- przejść próg, zanim którakolwiek zdążyła wstawić wiersz. Naprawa: `pg_advisory_xact_lock`
-- kluczowany znormalizowanym adresem SERIALIZUJE odczyt licznika i wstawienie w jednej
-- sekcji krytycznej (ten sam wzorzec co `begin_checkout`, 0050, i `send_message`/
-- `submit_guest_application`, 0075/0095) — blokada zwalnia się dopiero z transakcją
-- wywołującego RPC (`invite_company_member`), więc kolejne wywołanie dla tego samego
-- adresu czeka na commit/rollback poprzedniego i widzi już jego wpis.
--
-- Sygnatura i logika poza dodaną blokadą bez zmian. Rollback: przywrócić poprzednią wersję
-- funkcji z migracji 0121 (bez `perform pg_advisory_xact_lock(...)`).
--
-- Dodatkowo (bez zmiany zachowania): `team_invitation_signup_preview` dostaje jawny
-- komentarz utrwalający kontrakt stanu `used` (token zużyty, ale zaproszenie wciąż
-- `pending` — czeka w panelu na odpowiedź adresata) — zweryfikowany testem sekwencji
-- `preview → consume → preview` w `supabase/tests/rls.sql` (sekcja TI610).
-- =============================================================================

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
  -- Advisory lock per adres: serializuje COUNT + INSERT wobec równoległych wywołań dla
  -- tego samego adresu (różne zaproszenia/firmy) — bez niego limit dałoby się ominąć
  -- współbieżnością (dwie transakcje odczytujące ten sam licznik przed wstawieniem).
  perform pg_advisory_xact_lock(hashtextextended('team-invite-signup:' || lower(p_to_email::text), 0));
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

-- --- Kontrakt stanu `used` (bez zmiany logiki, tylko jawny komentarz) ---------------------
-- Zużycie tokenu (`consume_team_invitation_signup`) ustawia WYŁĄCZNIE `signup_token_used_at`
-- — `status` zostaje `pending` (zaproszenie samo w sobie nadal czeka na odpowiedź adresata
-- w panelu, niezależnie od tego, czy rejestracja z linku już się odbyła). Dlatego zapytanie
-- niżej filtruje `status = 'pending' and expires_at > now()` BEZ warunku na
-- `signup_token_used_at` — zużyty, ale wciąż aktywny wiersz ma świadomie przechodzić ten
-- filtr, żeby gałąź `r.signup_token_used_at is not null` mogła rozpoznać go i zwrócić
-- `'used'` (a nie ten sam ogólny `'invalid'` co dla nieznanego/wygasłego/rozstrzygniętego
-- tokenu). Kolejność jest celowa: 1) brak wiersza pod ten filtr → `invalid`;
-- 2) wiersz z `signup_token_used_at` → `used`; 3) reszta → `valid`.
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
