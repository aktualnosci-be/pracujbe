-- =============================================================================
-- 0991 (numer tymczasowy) — indeksy pod usuwanie konta i kaskady FK (#1245, audyt 29.09
-- DB-3) oraz nazwy bez znaków sterujących (#1244, audyt 29.09 DB-2).
--
-- 1. Indeksy (#1245). `erase_candidate_subject`/`erase_employer_subject` (0105/0161/0166)
--    usuwają `notifications`/`email_deliveries` po `entity_id = any(…)`, kaskada `profiles`
--    usuwa `saved_search_alerts` po `profile_id`, a kaskada `auth.users` i FK `ON DELETE SET NULL`
--    „aktora” (twórca oferty, nadawca propozycji, autor zmiany statusu, twórca rozmowy, nadawca
--    formularza kontaktu, adresat listu konta) przeszukują tabele po kolumnach bez indeksu —
--    każde usunięcie konta robiło pełne skany, trzymając blokady profilu i członkostw firm.
--    Indeksy częściowe (`where … is not null`) tam, gdzie kolumna bywa pusta. Zwykłe
--    `create index` w transakcji migratora (baza startowa jest mała; `concurrently` nie działa
--    w transakcji). Pozostałe kolumny aktora (`decided_by`, `invited_by`…) leżą na tabelach
--    rosnących z pracą admina/firm, nie z ruchem kandydatów — poza tym krokiem.
-- 2. Znaki sterujące (#1244). `save_saved_search` sprawdzał tylko długość nazwy, a
--    `rename_saved_search` (0124) odrzucał `[[:cntrl:]]` — nazwa z CR/LF trafiała do tematu
--    e-maila `jobMatch`. `save_saved_search` = definicja z 0092 (później niezmieniana) + ta sama
--    reguła co 0124. Dodatkowo CHECK na tabelach, niezależny od ścieżki zapisu:
--    `saved_searches_name_no_control` i `companies_name_no_control` (nazwa firmy trafia do
--    tematu zaproszenia do zespołu wysyłanego do innej osoby). Zakres: C0 (U+0001–U+001F),
--    DEL i C1 (U+007F–U+009F) — lustro `CONTROL_CHARS_RE` w `src/lib/validation/control-chars.ts`.
--    Istniejące wiersze są czyszczone PRZED dodaniem CHECK (sekwencja znaków sterujących →
--    jedna spacja, przycięcie); migracja działa bez sesji użytkownika, więc
--    `protect_company_verification` nie cofa weryfikacji firmy.
-- Rollback: supabase/rollback/0991_db_perf_indexes_control_chars.down.sql.
-- =============================================================================

-- --- 1. Indeksy (#1245) ----------------------------------------------------------
create index if not exists idx_notifications_entity
  on public.notifications (entity_id) where entity_id is not null;
create index if not exists idx_email_deliveries_entity
  on public.email_deliveries (entity_id) where entity_id is not null;
create index if not exists idx_saved_search_alerts_profile
  on public.saved_search_alerts (profile_id);
create index if not exists idx_jobs_created_by
  on public.jobs (created_by) where created_by is not null;
create index if not exists idx_offers_sender
  on public.offers (sender_id) where sender_id is not null;
create index if not exists idx_application_status_history_changed_by
  on public.application_status_history (changed_by) where changed_by is not null;
create index if not exists idx_offer_status_history_changed_by
  on public.offer_status_history (changed_by) where changed_by is not null;
create index if not exists idx_conversations_created_by
  on public.conversations (created_by) where created_by is not null;
create index if not exists idx_contact_messages_sender
  on public.contact_messages (sender_id) where sender_id is not null;
-- auth.email_outbox (0061) istnieje tylko na ścieżce Better Auth (seed-shim go nie tworzy).
do $$
begin
  if to_regclass('auth.email_outbox') is not null then
    create index if not exists email_outbox_user_idx on auth.email_outbox (user_id);
  end if;
end $$;

-- --- 2. Znaki sterujące (#1244) ----------------------------------------------------
update public.saved_searches
   set name = left(coalesce(nullif(btrim(regexp_replace(name, '[\u0001-\u001f\u007f-\u009f]+', ' ', 'g')), ''), '?'), 80)
 where name ~ '[\u0001-\u001f\u007f-\u009f]';
alter table public.saved_searches
  add constraint saved_searches_name_no_control check (name !~ '[\u0001-\u001f\u007f-\u009f]');

update public.companies
   set name = coalesce(nullif(btrim(regexp_replace(name, '[\u0001-\u001f\u007f-\u009f]+', ' ', 'g')), ''), '?')
 where name ~ '[\u0001-\u001f\u007f-\u009f]';
alter table public.companies
  add constraint companies_name_no_control check (name !~ '[\u0001-\u001f\u007f-\u009f]');

create or replace function public.save_saved_search(
  p_name text,
  p_locale text,
  p_filters jsonb,
  p_query text default '',
  p_frequency text default 'daily'
) returns table (saved_search_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_filters jsonb;
  v_hash text;
  v_name text := btrim(coalesce(p_name, ''));
  v_query text := coalesce(p_query, '');
  v_id uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.role = 'candidate' and p.deleted_at is null
  ) then
    raise exception 'PERMISSION_DENIED: tylko kandydat zapisuje wyszukiwania' using errcode = '42501';
  end if;
  if not coalesce(public.is_supported_locale(p_locale), false) then
    raise exception 'VALIDATION_FAILED: nieobsługiwany język' using errcode = '22023';
  end if;
  -- #1244: ta sama reguła co rename_saved_search (0124) — bez znaków sterujących (CR/LF…).
  if char_length(v_name) not between 1 and 80 or v_name ~ '[\u0001-\u001f\u007f-\u009f]' then
    raise exception 'VALIDATION_FAILED: nazwa wymagana (1–80 znaków)' using errcode = '22023';
  end if;
  if char_length(v_query) > 2000 or (v_query <> '' and left(v_query, 1) <> '?') then
    raise exception 'VALIDATION_FAILED: nieprawidłowy adres wyszukiwania' using errcode = '22023';
  end if;
  if coalesce(p_frequency, 'daily') not in ('daily', 'weekly') then
    raise exception 'VALIDATION_FAILED: nieprawidłowa częstotliwość' using errcode = '22023';
  end if;

  v_filters := public.saved_search_canonical_filters(p_filters, p_locale);
  v_hash := md5(v_filters::text);

  -- Blokada profilu serializuje równoległe zapisy tego samego kandydata (limit + unikat).
  perform 1 from public.profiles where id = v_uid for update;

  select s.id into v_id from public.saved_searches s
    where s.profile_id = v_uid and s.filters_hash = v_hash;
  if v_id is not null then
    return query select v_id, false;
    return;
  end if;

  if (select count(*) from public.saved_searches s where s.profile_id = v_uid) >= 20 then
    raise exception 'SAVED_SEARCH_LIMIT_REACHED: najwyżej 20 zapisanych wyszukiwań' using errcode = '42501';
  end if;

  insert into public.saved_searches
    (profile_id, name, locale, filters, filters_hash, query, frequency,
     last_checked_at, next_run_at)
  values
    (v_uid, v_name, p_locale, v_filters, v_hash, v_query, coalesce(p_frequency, 'daily'),
     now(), now() + case coalesce(p_frequency, 'daily')
                      when 'weekly' then interval '7 days' else interval '1 day' end)
  returning id into v_id;

  return query select v_id, true;
end $$;
revoke all on function public.save_saved_search(text, text, jsonb, text, text) from public, anon;
grant execute on function public.save_saved_search(text, text, jsonb, text, text) to authenticated;
