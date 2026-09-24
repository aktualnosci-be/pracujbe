-- =============================================================================
-- 0107_consent_separation.sql — #493: rozdzielenie akceptacji regulaminu, potwierdzenia
-- zapoznania się z informacją o prywatności i zgód opcjonalnych.
--
-- Numer tymczasowy (koordynator poda docelowy).
--
-- Problem: rejestracja i onboarding miały JEDEN wymagany checkbox „Akceptuję regulamin
-- i politykę prywatności”, a receipt zapisywał ['terms','privacy'] jak dwie akceptacje.
-- Informacja z art. 13 RODO nie jest „akceptacją” ani zgodą, a zgoda na cel opcjonalny
-- (marketing) nie może być warunkiem konta.
--
-- Zmiany:
-- 1. document_acceptances.kind — znaczenie wiersza:
--      terms_acceptance   — akceptacja regulaminu (warunek konta),
--      privacy_notice_ack — potwierdzenie zapoznania się z informacją o prywatności (NIE zgoda),
--      legacy_combined    — zapis dawnego wspólnego checkboxa (wszystkie wiersze sprzed tej
--                           migracji). Nie jest zgodą na żaden cel (AI, marketing, publikację).
--    document_acceptances.source — kanał (signup / onboarding); historyczne = null.
--    Wiersze są niezmienne (trigger dla każdej roli); usunąć je może tylko kaskada
--    usunięcia profilu (prawo do usunięcia danych).
-- 2. optional_consents — niezmienny dowód KAŻDEJ zgody opcjonalnej osobno (cel, wybór,
--    wersja pokazanej treści, kanał, język, czas). Zapisujemy tylko cele, które były
--    pokazane w formularzu (także odmowę) — brak klucza = brak wiersza.
-- 3. record_signup_consents (service_role) — jedna transakcja: regulamin + informacja
--    o prywatności są wymagane, zgody opcjonalne nie. Zgoda na marketing ustawia
--    notification_preferences.email_marketing = true (wycofanie: ustawienia powiadomień).
-- 4. record_document_acceptance (dawne API wspólnego checkboxa) zapisuje legacy_combined.
-- 5. auth.record_signup_receipts (Better Auth, 0059): marker v2 → record_signup_consents;
--    v1 (formularz sprzed zmiany, w trakcie wdrożenia) → dawna ścieżka legacy_combined.
-- 6. guest_applications.consent_* — opis znaczenia (potwierdzenie informacji o prywatności).
--
-- Zależność: #513 (0101, email_consent_events) nie jest w main. Po jego scaleniu zmiana
-- email_marketing z tej funkcji zostawi też wpis w email_consent_events (trigger na
-- notification_preferences) — ten dowód jest uzupełnieniem, nie duplikatem: tutaj zapisujemy
-- wybór z formularza rejestracji, tam każdą późniejszą zmianę ustawień.
--
-- Rollback: przywrócić record_document_acceptance z 0054 i auth.record_signup_receipts z 0059;
-- drop record_signup_consents, optional_consents, triggerów niezmienności i kolumn kind/source.
-- Historii akceptacji nie usuwać.
-- =============================================================================

-- --- 1. document_acceptances: znaczenie i kanał ----------------------------------------
alter table public.document_acceptances
  add column if not exists kind text,
  add column if not exists source text;

-- Wszystko, co istnieje przed tą migracją, pochodzi ze wspólnego checkboxa.
update public.document_acceptances set kind = 'legacy_combined' where kind is null;

alter table public.document_acceptances
  alter column kind set not null,
  add constraint document_acceptances_kind_check check (
    (kind = 'terms_acceptance' and document = 'terms')
    or (kind = 'privacy_notice_ack' and document = 'privacy')
    or kind = 'legacy_combined'),
  add constraint document_acceptances_source_check check (
    source is null or source in ('signup', 'onboarding'));

comment on column public.document_acceptances.kind is
  'terms_acceptance = akceptacja regulaminu; privacy_notice_ack = potwierdzenie zapoznania się '
  'z informacją o prywatności (nie zgoda); legacy_combined = dawny wspólny checkbox '
  '„regulamin i polityka prywatności” (nie jest zgodą na żaden cel opcjonalny).';
comment on column public.document_acceptances.source is
  'Kanał zapisu (signup / onboarding); null = wiersz sprzed #493.';

create or replace function public.forbid_consent_receipt_change()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Kaskada z usunięcia profilu działa z wnętrza triggera RI (głębokość > 1).
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'CONSENT_RECEIPT_IMMUTABLE' using errcode = '42501';
end $$;
revoke all on function public.forbid_consent_receipt_change() from public;

drop trigger if exists document_acceptances_immutable on public.document_acceptances;
create trigger document_acceptances_immutable
  before update or delete on public.document_acceptances
  for each row execute function public.forbid_consent_receipt_change();

-- --- 2. optional_consents ----------------------------------------------------------------
create table if not exists public.optional_consents (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references public.profiles(id) on delete cascade,
  purpose          text not null check (purpose in ('email_marketing')),
  granted          boolean not null,
  wording_version  text check (wording_version is null or char_length(wording_version) <= 80),
  source           text not null check (source in ('signup', 'onboarding')),
  locale           text references public.supported_locales(code),
  ip_address       inet,
  user_agent       text check (user_agent is null or char_length(user_agent) <= 512),
  created_at       timestamptz not null default now()
);

create index if not exists optional_consents_profile_idx
  on public.optional_consents (profile_id, purpose, created_at desc);

alter table public.optional_consents enable row level security;
revoke all on public.optional_consents from anon, authenticated;
grant select on public.optional_consents to authenticated;
drop policy if exists optional_consents_select_own on public.optional_consents;
create policy optional_consents_select_own on public.optional_consents
  for select to authenticated using (profile_id = auth.uid());

drop trigger if exists optional_consents_immutable on public.optional_consents;
create trigger optional_consents_immutable
  before update or delete on public.optional_consents
  for each row execute function public.forbid_consent_receipt_change();

-- Wersja pokazanej treści (np. 'sha256:…') — tylko krótki, drukowalny identyfikator.
create or replace function public.consent_wording_version(p_versions jsonb, p_key text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when jsonb_typeof(p_versions -> p_key) = 'string'
      and (p_versions ->> p_key) ~ '^[a-z0-9]+:[A-Za-z0-9._-]{1,72}$'
    then p_versions ->> p_key
    else null
  end;
$$;
revoke all on function public.consent_wording_version(jsonb, text) from public;

-- --- 3. record_signup_consents -----------------------------------------------------------
create or replace function public.record_signup_consents(
  p_profile_id        uuid,
  p_terms_accepted    boolean,
  p_privacy_notice_ack boolean,
  p_optional          jsonb default '{}'::jsonb,
  p_source            text default 'signup',
  p_locale            text default null,
  p_wording_versions  jsonb default '{}'::jsonb,
  p_ip                text default null,
  p_user_agent        text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_loc text := case when public.is_supported_locale(p_locale) then p_locale else null end;
  v_src text := p_source;
  v_ip inet;
  v_ua text := nullif(left(coalesce(p_user_agent, ''), 512), '');
  v_opt jsonb := coalesce(p_optional, '{}'::jsonb);
  v_doc text;
  v_kind text;
  v_version_id uuid;
  v_version text;
  v_purpose text;
  v_granted boolean;
begin
  if p_profile_id is null
     or p_terms_accepted is distinct from true
     or p_privacy_notice_ack is distinct from true
     or v_src is null or v_src not in ('signup', 'onboarding')
     or jsonb_typeof(v_opt) <> 'object' then
    raise exception 'VALIDATION_FAILED' using errcode = '23514';
  end if;
  -- Nieznany cel albo nie-boolean = błąd (nie zapisujemy zgody, której formularz nie pokazał).
  if exists (select 1 from jsonb_each(v_opt) e
              where e.key <> 'email_marketing' or jsonb_typeof(e.value) <> 'boolean') then
    raise exception 'VALIDATION_FAILED' using errcode = '23514';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'NOT_FOUND' using errcode = '23503';
  end if;

  begin
    v_ip := nullif(btrim(coalesce(p_ip, '')), '')::inet;
  exception when others then v_ip := null; end;

  foreach v_doc in array array['terms', 'privacy'] loop
    v_kind := case v_doc when 'terms' then 'terms_acceptance' else 'privacy_notice_ack' end;
    select id, version into v_version_id, v_version from public.consent_versions
      where document = v_doc and is_current = true
      order by (locale = v_loc) desc nulls last, published_at desc nulls last, created_at desc
      limit 1;
    insert into public.document_acceptances
      (profile_id, document, kind, source, consent_version_id, document_version, locale,
       ip_address, user_agent)
    values
      (p_profile_id, v_doc, v_kind, v_src, v_version_id,
       coalesce(v_version, public.consent_wording_version(p_wording_versions, v_doc)),
       v_loc, v_ip, v_ua);
    v_version_id := null; v_version := null;
  end loop;

  for v_purpose, v_granted in
    select e.key, (e.value)::text::boolean from jsonb_each(v_opt) e order by e.key
  loop
    insert into public.optional_consents
      (profile_id, purpose, granted, wording_version, source, locale, ip_address, user_agent)
    values
      (p_profile_id, v_purpose, v_granted,
       public.consent_wording_version(p_wording_versions, v_purpose),
       v_src, v_loc, v_ip, v_ua);

    -- Zgoda włącza kategorię; odmowa niczego nie zmienia (domyślnie wyłączone, 0006/0087).
    if v_purpose = 'email_marketing' and v_granted then
      insert into public.notification_preferences (profile_id, email_marketing)
      values (p_profile_id, true)
      on conflict (profile_id) do update set email_marketing = true;
    end if;
  end loop;
end $$;
revoke all on function public.record_signup_consents(uuid, boolean, boolean, jsonb, text, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.record_signup_consents(uuid, boolean, boolean, jsonb, text, text, jsonb, text, text)
  to service_role;

-- --- 4. Dawne API wspólnego checkboxa → legacy_combined ----------------------------------
create or replace function public.record_document_acceptance(
  p_profile_id uuid,
  p_documents  text[],
  p_locale     text default null,
  p_ip         text default null,
  p_user_agent text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ip inet; v_loc text; doc text; v_version_id uuid; v_version text;
  v_allowed text[] := array['terms', 'privacy'];
begin
  if p_profile_id is null then raise exception 'VALIDATION_FAILED' using errcode = '42501'; end if;

  v_loc := case when public.is_supported_locale(p_locale) then p_locale else null end;
  begin
    v_ip := nullif(btrim(coalesce(p_ip, '')), '')::inet;
  exception when others then v_ip := null; end;

  foreach doc in array coalesce(p_documents, '{}'::text[]) loop
    if doc = any(v_allowed) then
      select id, version into v_version_id, v_version from public.consent_versions
        where document = doc and is_current = true
        order by (locale = v_loc) desc nulls last, published_at desc nulls last, created_at desc
        limit 1;
      insert into public.document_acceptances
        (profile_id, document, kind, consent_version_id, document_version, locale, ip_address, user_agent)
      values
        (p_profile_id, doc, 'legacy_combined', v_version_id, v_version, v_loc, v_ip,
         nullif(left(coalesce(p_user_agent, ''), 512), ''));
      v_version_id := null; v_version := null;
    end if;
  end loop;
end $$;
revoke all on function public.record_document_acceptance(uuid, text[], text, text, text) from public;
grant execute on function public.record_document_acceptance(uuid, text[], text, text, text) to service_role;

-- --- 5. Better Auth: marker v2 ----------------------------------------------------------
create or replace function auth.record_signup_receipts()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
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
  return new;
end $$;
revoke all on function auth.record_signup_receipts() from public, anon, authenticated,
  pracujbe_app, pracujbe_auth, service_role;

-- --- 6. Aplikacja bez konta: znaczenie snapshotu ------------------------------------------
comment on column public.guest_application_requests.consent_accepted_at is
  'Czas potwierdzenia zapoznania się z informacją o prywatności (nie zgoda na cel opcjonalny).';
comment on column public.guest_application_requests.consent_version_id is
  'Wersja informacji o prywatności (consent_versions, document=privacy) pokazanej gościowi.';
