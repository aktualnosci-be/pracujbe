-- =============================================================================
-- 0110_candidate_age_policy.sql — polityka wieku kandydatów (#492), część techniczna.
--
-- NUMER TYMCZASOWY: koordynator nada ostateczny numer przy scalaniu.
--
-- Decyzja o wariancie (tylko dorośli czy także 15–17 lat) należy do właściciela produktu
-- po przeglądzie prawnym. Ta migracja NIE rozstrzyga prawa — daje mechanizm:
--   1. `age_policy` — próg wieku kandydata jako DANE (jeden wiersz). Domyślnie 18 —
--      najbezpieczniejszy wariant z issue — z `confirmed = false` (do potwierdzenia).
--      Zakres 13–18: górna granica = pełnoletność, więc deklaracja „mam co najmniej 18 lat”
--      spełnia każdy dopuszczalny próg.
--   2. `candidate_age_attestations` — niezmienny receipt deklaracji „mam co najmniej N lat”.
--      Minimalizacja (RODO art. 5(1)(c)): bez daty i roku urodzenia, bez dokumentu — tylko
--      zadeklarowany próg, źródło, język i czas.
--   3. Egzekwowanie w bazie (jeden chokepoint na ścieżkę, bez wyjątku dla ról systemowych):
--      * `applications` BEFORE INSERT / zmiana `candidate_id` — kandydat bez ważnej
--        deklaracji nie aplikuje i nie przejmuje aplikacji gościa (AGE_ATTESTATION_REQUIRED);
--      * `offers` BEFORE INSERT — firma nie wyśle propozycji takiej osobie (neutralny błąd
--        jak przy braku relacji — firma nie dowiaduje się dlaczego);
--      * `candidate_profiles` BEFORE UPDATE — profil bez ważnej deklaracji nie staje się
--        widoczny dla firm (#494, 0100);
--      * `guest_application_requests` BEFORE INSERT / ponowne wysłanie — gość deklaruje próg
--        w formularzu; bez deklaracji zgłoszenie nie powstaje.
--   4. `admin_set_candidate_min_age` — zmiana progu (admin), audyt `age_policy.updated`.
--      Podniesienie progu od razu ukrywa profile kandydatów, których deklaracja jest niższa
--      (historia w `candidate_visibility_events`, jak w 0100). Obniżenie niczego nie odsłania.
--   5. Rejestracja: deklaracja zapisywana w tej samej transakcji co konto — Better Auth przez
--      trigger `auth.record_signup_receipts` (metadane z walidowanej akcji), Supabase Auth
--      przez `record_candidate_age_attestation` (service_role) w akcji rejestracji.
--
-- Poza zakresem (wymaga decyzji właściciela/prawnika, patrz
-- docs/legal-drafts/kandydaci-niepelnoletni.md): wariant z niepełnoletnimi (zgoda opiekuna,
-- oznaczanie ofert dla młodocianych), treść regulaminu i polityki prywatności.
--
-- Rollback: przywrócić `auth.record_signup_receipts` z database/auth/0059; drop nowego
-- `export_my_data()` i zmienić nazwę `export_my_data_base` z powrotem (grant authenticated); zmienić nazwę
-- `submit_guest_application_core` z powrotem na `submit_guest_application` (drop wrappera,
-- grant execute dla service_role); drop triggerów `*_age_policy`, funkcji z tej migracji,
-- tabel `candidate_age_attestations`, `age_policy`, kolumn `guest_application_requests.age_*`.
-- =============================================================================

-- --- 1. Próg jako dane --------------------------------------------------------------------
create table if not exists public.age_policy (
  id                boolean primary key default true check (id),
  candidate_min_age smallint not null default 18 check (candidate_min_age between 13 and 18),
  -- false = wartość robocza, niezatwierdzona przez właściciela po przeglądzie prawnym.
  confirmed         boolean not null default false,
  reason            text check (reason is null or char_length(reason) <= 1000),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id) on delete set null
);
insert into public.age_policy (id, candidate_min_age, confirmed)
  values (true, 18, false)
  on conflict (id) do nothing;

alter table public.age_policy enable row level security;
alter table public.age_policy force row level security;
revoke all on public.age_policy from public, anon, authenticated;

-- Odczyt progu jest publiczny (formularze rejestracji i aplikacji gościa go pokazują).
-- Brak wiersza nie może obniżyć ochrony: wtedy 18.
create or replace function public.candidate_min_age()
returns smallint language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select candidate_min_age from public.age_policy where id), 18::smallint);
$$;
revoke all on function public.candidate_min_age() from public;
grant execute on function public.candidate_min_age() to anon, authenticated, service_role;

-- --- 2. Deklaracje kandydatów (receipt) -----------------------------------------------------
create table if not exists public.candidate_age_attestations (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  min_age    smallint not null check (min_age between 13 and 18),
  source     text not null check (source in ('signup', 'self')),
  locale     text references public.supported_locales(code),
  created_at timestamptz not null default now()
);
create index if not exists candidate_age_attestations_profile_idx
  on public.candidate_age_attestations (profile_id, min_age desc);

alter table public.candidate_age_attestations enable row level security;
alter table public.candidate_age_attestations force row level security;
revoke all on public.candidate_age_attestations from public, anon, authenticated;
grant select on public.candidate_age_attestations to authenticated;

drop policy if exists candidate_age_attestations_select_own on public.candidate_age_attestations;
create policy candidate_age_attestations_select_own on public.candidate_age_attestations
  for select to authenticated
  using (profile_id = auth.uid());

-- Receipt jest niezmienny dla KAŻDEJ roli (usunięcie tylko kaskadą z usunięciem konta).
create or replace function public.candidate_age_attestations_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'PERMISSION_DENIED: deklaracja wieku jest niezmienna' using errcode = '42501';
end $$;
drop trigger if exists trg_candidate_age_attestations_immutable on public.candidate_age_attestations;
create trigger trg_candidate_age_attestations_immutable
  before update on public.candidate_age_attestations
  for each row execute function public.candidate_age_attestations_immutable();

-- Czy kandydat ma deklarację co najmniej na BIEŻĄCY próg.
create or replace function public.candidate_meets_age_policy(p_profile uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.candidate_age_attestations a
    where a.profile_id = p_profile and a.min_age >= public.candidate_min_age()
  );
$$;
revoke all on function public.candidate_meets_age_policy(uuid) from public, anon, authenticated;

-- Wspólna walidacja deklarowanego progu (null / poniżej progu / poza zakresem).
create or replace function public.assert_age_attestation(p_min_age integer)
returns smallint language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_min_age is null or p_min_age < public.candidate_min_age() then
    raise exception 'AGE_ATTESTATION_REQUIRED' using errcode = '42501';
  end if;
  if p_min_age > 18 then
    raise exception 'VALIDATION_FAILED: deklarowany próg poza zakresem' using errcode = '42501';
  end if;
  return p_min_age::smallint;
end $$;
revoke all on function public.assert_age_attestation(integer) from public, anon, authenticated;

create or replace function public.insert_candidate_age_attestation(
  p_profile_id uuid, p_min_age integer, p_source text, p_locale text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_age smallint;
begin
  v_age := public.assert_age_attestation(p_min_age);
  if not exists (select 1 from public.profiles where id = p_profile_id and role = 'candidate') then
    raise exception 'PERMISSION_DENIED: deklaracja wieku tylko dla kandydata' using errcode = '42501';
  end if;
  -- Ponowienie tej samej (albo słabszej) deklaracji nie tworzy duplikatu.
  if exists (select 1 from public.candidate_age_attestations
             where profile_id = p_profile_id and min_age >= v_age) then
    return;
  end if;
  insert into public.candidate_age_attestations (profile_id, min_age, source, locale)
  values (p_profile_id, v_age, p_source,
          case when public.is_supported_locale(p_locale) then p_locale else null end);
end $$;
revoke all on function public.insert_candidate_age_attestation(uuid, integer, text, text)
  from public, anon, authenticated;

-- Rejestracja przez Supabase Auth (akcja serwerowa, auth.uid() jeszcze null) — service_role.
create or replace function public.record_candidate_age_attestation(
  p_profile_id uuid, p_min_age integer, p_locale text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_profile_id is null then raise exception 'VALIDATION_FAILED' using errcode = '42501'; end if;
  perform public.insert_candidate_age_attestation(p_profile_id, p_min_age, 'signup', p_locale);
end $$;
revoke all on function public.record_candidate_age_attestation(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.record_candidate_age_attestation(uuid, integer, text) to service_role;

-- Kandydat z istniejącym kontem (sprzed polityki albo po podniesieniu progu) deklaruje sam.
create or replace function public.attest_candidate_age(p_min_age integer)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_locale text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select coalesce(preferred_locale, account_locale, signup_locale) into v_locale
    from public.profiles where id = auth.uid();
  perform public.insert_candidate_age_attestation(auth.uid(), p_min_age, 'self', v_locale);
  return public.candidate_meets_age_policy(auth.uid());
end $$;
revoke all on function public.attest_candidate_age(integer) from public, anon;
grant execute on function public.attest_candidate_age(integer) to authenticated;

-- Stan dla UI kandydata: bieżący próg, najwyższa deklaracja i czy wystarcza.
create or replace function public.get_my_age_attestation()
returns table (required_min_age smallint, attested_min_age smallint, attested_at timestamptz,
               meets_policy boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select public.candidate_min_age(),
         a.min_age, a.created_at,
         coalesce(a.min_age >= public.candidate_min_age(), false)
  from (select 1) as one
  left join lateral (
    select min_age, created_at from public.candidate_age_attestations
    where profile_id = auth.uid()
    order by min_age desc, created_at desc
    limit 1
  ) a on true
  where auth.uid() is not null;
$$;
revoke all on function public.get_my_age_attestation() from public, anon;
grant execute on function public.get_my_age_attestation() to authenticated;

-- --- 3. Egzekwowanie -----------------------------------------------------------------------
-- Aplikacja (apply_to_job, claim_guest_application i każda inna ścieżka zapisu).
create or replace function public.enforce_application_age_policy()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.candidate_id is not null
     and (tg_op = 'INSERT' or new.candidate_id is distinct from old.candidate_id)
     and not public.candidate_meets_age_policy(new.candidate_id) then
    raise exception 'AGE_ATTESTATION_REQUIRED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.enforce_application_age_policy() from public, anon, authenticated;
drop trigger if exists trg_applications_age_policy on public.applications;
create trigger trg_applications_age_policy
  before insert or update of candidate_id on public.applications
  for each row execute function public.enforce_application_age_policy();

-- Propozycja: neutralny błąd (jak blokada firmy, 0078) — firma nie poznaje powodu.
create or replace function public.enforce_offer_age_policy()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.candidate_meets_age_policy(new.candidate_id) then
    raise exception 'PERMISSION_DENIED: brak relacji firma–kandydat dla propozycji' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.enforce_offer_age_policy() from public, anon, authenticated;
drop trigger if exists trg_offers_age_policy on public.offers;
create trigger trg_offers_age_policy
  before insert on public.offers
  for each row execute function public.enforce_offer_age_policy();

-- Widoczność profilu dla firm (#494): włączenie tylko z ważną deklaracją.
create or replace function public.enforce_searchable_age_policy()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_searchable and not coalesce(old.is_searchable, false)
     and not public.candidate_meets_age_policy(new.profile_id) then
    raise exception 'AGE_ATTESTATION_REQUIRED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.enforce_searchable_age_policy() from public, anon, authenticated;
drop trigger if exists trg_candidate_profiles_age_policy on public.candidate_profiles;
create trigger trg_candidate_profiles_age_policy
  before update of is_searchable on public.candidate_profiles
  for each row execute function public.enforce_searchable_age_policy();

-- --- 4. Aplikacja gościa -------------------------------------------------------------------
alter table public.guest_application_requests
  add column if not exists age_attested_min smallint
    check (age_attested_min is null or age_attested_min between 13 and 18),
  add column if not exists age_attested_at timestamptz;

-- Deklarację przekazuje wrapper `submit_guest_application` przez ustawienie transakcji;
-- zgłoszenie bez niej (w tym bezpośrednie wywołanie funkcji core) jest odrzucane.
create or replace function public.guest_application_age_policy()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_raw text;
begin
  -- Nowe zgłoszenie albo ponowne wysłanie (nowy token) = nowa deklaracja.
  if tg_op = 'INSERT' or new.confirm_token_hash is distinct from old.confirm_token_hash then
    v_raw := nullif(current_setting('pracujbe.guest_age_attested_min', true), '');
    if v_raw is null or v_raw !~ '^[0-9]{1,2}$' then
      raise exception 'AGE_ATTESTATION_REQUIRED' using errcode = '42501';
    end if;
    new.age_attested_min := public.assert_age_attestation(v_raw::integer);
    new.age_attested_at := now();
  end if;
  return new;
end $$;
revoke all on function public.guest_application_age_policy() from public, anon, authenticated;
drop trigger if exists trg_guest_application_requests_age_policy on public.guest_application_requests;
create trigger trg_guest_application_requests_age_policy
  before insert or update of confirm_token_hash on public.guest_application_requests
  for each row execute function public.guest_application_age_policy();

-- Dotychczasowa funkcja staje się wewnętrzna (bez EXECUTE dla ról aplikacji).
alter function public.submit_guest_application(uuid, text, text, text, text, text, text, text, text, text, text, text, jsonb)
  rename to submit_guest_application_core;
revoke all on function public.submit_guest_application_core(uuid, text, text, text, text, text, text, text, text, text, text, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.submit_guest_application(
  p_job_id             uuid,
  p_email              text,
  p_full_name          text,
  p_phone              text,
  p_availability       text,
  p_message            text,
  p_locale             text,
  p_idempotency_key    text,
  p_confirm_nonce      text,
  p_confirm_token_hash text,
  p_ip                 text default null,
  p_user_agent         text default null,
  p_answers            jsonb default null,
  p_age_attested_min   integer default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public.assert_age_attestation(p_age_attested_min);
  perform set_config('pracujbe.guest_age_attested_min', p_age_attested_min::text, true);
  v_id := public.submit_guest_application_core(p_job_id, p_email, p_full_name, p_phone,
    p_availability, p_message, p_locale, p_idempotency_key, p_confirm_nonce, p_confirm_token_hash,
    p_ip, p_user_agent, p_answers);
  -- Deklaracja nie przechodzi na kolejne polecenia tej transakcji.
  perform set_config('pracujbe.guest_age_attested_min', '', true);
  return v_id;
end $$;
revoke all on function public.submit_guest_application(uuid, text, text, text, text, text, text, text, text, text, text, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.submit_guest_application(uuid, text, text, text, text, text, text, text, text, text, text, text, jsonb, integer)
  to service_role;

-- --- 5. Zmiana progu (admin) ---------------------------------------------------------------
create or replace function public.admin_set_candidate_min_age(
  p_min_age   integer,
  p_confirmed boolean,
  p_reason    text
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_before public.age_policy;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_hidden integer := 0;
begin
  if not public.is_admin() then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_min_age is null or p_min_age not between 13 and 18 or p_confirmed is null
     or v_reason is null or char_length(v_reason) > 1000 then
    raise exception 'VALIDATION_FAILED' using errcode = '42501';
  end if;

  select * into v_before from public.age_policy where id for update;
  update public.age_policy
     set candidate_min_age = p_min_age, confirmed = p_confirmed, reason = v_reason,
         updated_at = now(), updated_by = auth.uid()
   where id;
  if not found then
    insert into public.age_policy (id, candidate_min_age, confirmed, reason, updated_by)
    values (true, p_min_age, p_confirmed, v_reason, auth.uid());
  end if;

  -- Wyższy próg: profile z niższą deklaracją znikają z wyszukiwania od razu (0100).
  with hidden as (
    update public.candidate_profiles cp
       set is_searchable = false, searchable_changed_at = now()
     where cp.is_searchable and not public.candidate_meets_age_policy(cp.profile_id)
    returning cp.profile_id
  ), events as (
    insert into public.candidate_visibility_events (candidate_id, searchable)
    select profile_id, false from hidden
    returning 1
  )
  select count(*) into v_hidden from events;

  perform public.write_audit('age_policy.updated', 'age_policy', null,
    jsonb_build_object('candidate_min_age', v_before.candidate_min_age, 'confirmed', v_before.confirmed),
    jsonb_build_object('candidate_min_age', p_min_age, 'confirmed', p_confirmed,
                       'reason', v_reason, 'hidden_profiles', v_hidden));
  return v_hidden;
end $$;
revoke all on function public.admin_set_candidate_min_age(integer, boolean, text) from public, anon;
grant execute on function public.admin_set_candidate_min_age(integer, boolean, text) to authenticated;

-- --- 5b. Eksport danych kandydata (#486, art. 15/20) obejmuje deklaracje wieku --------------
-- Bez kopiowania całej funkcji z 0105: dotychczasowa staje się wewnętrzną częścią, a nowa
-- dopisuje klucz `ageAttestations` (sam próg, źródło, język, czas). Usunięcie konta kasuje
-- deklaracje kaskadą FK (profiles → candidate_age_attestations).
do $mig$
begin
  if to_regprocedure('public.export_my_data()') is null
     or to_regprocedure('public.export_my_data_base()') is not null then
    return;
  end if;
  alter function public.export_my_data() rename to export_my_data_base;
  revoke all on function public.export_my_data_base() from public, anon, authenticated;
end
$mig$;

create or replace function public.export_my_data()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_out jsonb;
begin
  v_out := public.export_my_data_base();
  return v_out || jsonb_build_object('ageAttestations',
    (select coalesce(jsonb_agg(jsonb_build_object(
              'minAge', a.min_age, 'source', a.source, 'locale', a.locale, 'createdAt', a.created_at)
              order by a.created_at), '[]'::jsonb)
       from public.candidate_age_attestations a where a.profile_id = auth.uid()));
end $$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- --- 6. Rejestracja Better Auth: deklaracja w tej samej transakcji co konto -----------------
-- Funkcja istnieje tylko w bazie z migracjami auth (database/auth/0059, stosowana wcześniej
-- w tej samej kolejności numerów). Treść = wersja z 0108 (#493: receipt v1 albo v2 z osobnym
-- potwierdzeniem informacji o prywatności i zgodami opcjonalnymi) + deklaracja wieku (#492).
-- Zmieniając tę funkcję w późniejszej migracji, zachowaj obie części.
do $mig$
begin
  if to_regprocedure('auth.record_signup_receipts()') is null then
    return;
  end if;
  execute $ddl$
create or replace function auth.record_signup_receipts()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $fn$
declare
  meta jsonb := new.raw_user_meta_data;
  loc text := meta->>'locale';
  ver jsonb := meta->'signup_receipt_version';
begin
  if not (meta ? 'signup_receipt_version') then return new; end if;
  if coalesce(ver not in ('1'::jsonb, '2'::jsonb), true)
    or meta->'agree_terms' is distinct from 'true'::jsonb
    or coalesce(meta->>'role', '') not in ('candidate', 'employer')
    or not public.is_supported_locale(coalesce(loc, '')) then
    raise exception 'VALIDATION_FAILED' using errcode = '23514';
  end if;
  if ver = '2'::jsonb and (
       meta->'privacy_notice_ack' is distinct from 'true'::jsonb
       or jsonb_typeof(coalesce(meta->'optional_consents', '{}'::jsonb)) <> 'object'
       or jsonb_typeof(coalesce(meta->'consent_wording', '{}'::jsonb)) <> 'object') then
    raise exception 'VALIDATION_FAILED' using errcode = '23514';
  end if;
  -- #492: kandydat deklaruje próg wieku; bez deklaracji konto nie powstaje.
  if meta->>'role' = 'candidate'
     and coalesce(jsonb_typeof(meta->'age_min_attested'), '') <> 'number' then
    raise exception 'AGE_ATTESTATION_REQUIRED' using errcode = '23514';
  end if;

  update public.profiles set preferred_locale = loc where id = new.id;
  if not found then raise exception 'Brak profilu rejestracji.'; end if;
  if ver = '1'::jsonb then
    -- Formularz sprzed #493 (wspólny checkbox) — zapis zachowuje dawne znaczenie.
    perform public.record_document_acceptance(new.id, array['terms','privacy'], loc, null, null);
  else
    perform public.record_signup_consents(new.id, true, true,
      coalesce(meta->'optional_consents', '{}'::jsonb), 'signup', loc,
      coalesce(meta->'consent_wording', '{}'::jsonb), null, null);
  end if;
  if meta->>'role' = 'candidate' then
    perform public.insert_candidate_age_attestation(
      new.id, (meta->>'age_min_attested')::numeric::integer, 'signup', loc);
  end if;
  return new;
end $fn$
  $ddl$;
  execute 'revoke all on function auth.record_signup_receipts() from public, anon, authenticated, '
    || 'pracujbe_app, pracujbe_auth, service_role';
end
$mig$;
