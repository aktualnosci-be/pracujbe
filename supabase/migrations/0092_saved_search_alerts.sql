-- =============================================================================
-- 0092 — zapisane wyszukiwania i alerty o nowych ofertach (#100).
--
-- Model:
--   * saved_searches — właściciel (kandydat), nazwa, locale, KANONICZNE i wersjonowane
--     filtry listy ofert (`filters`, `filters_version`), skrót filtrów (`filters_hash`,
--     unikat per właściciel → identyczne filtry nie tworzą duplikatu), adres listy do
--     ponownego otwarcia (`query`), częstotliwość digestu (daily/weekly), przełącznik
--     alertu, watermark (`last_checked_at`) i termin kolejnego przebiegu (`next_run_at`).
--   * saved_search_alerts — (wyszukiwanie × oferta) już zgłoszona; PK blokuje ponowny
--     alert o tej samej ofercie dla tego samego wyszukiwania (idempotencja).
--
-- Zapis wyłącznie przez RPC (save_saved_search / set_saved_search_alerts /
-- delete_saved_search); klient ma tylko SELECT własnych wierszy (RLS). Tabela alertów
-- nie ma żadnej ścieżki klienta.
--
-- Worker: process_saved_search_alerts(p_limit) — tylko service_role, wołany przez
-- /api/maintenance (cron co godzinę). Dla wyszukiwań z next_run_at <= now():
--   1. nowe oferty = WYWOŁANIE public.get_public_jobs z zapisanymi filtrami i
--      p_since = watermark − 1 h (zakładka na publikacje zatwierdzone po odczycie;
--      duplikaty odcina PK saved_search_alerts), nie wcześniej niż `alerts_since`
--      (utworzenie / ponowne włączenie) — dopasowanie liczone w SQL tą samą
--      funkcją co lista ofert, więc nie może się rozjechać;
--   2. pomija oferty firm zablokowanych przez kandydata (0078);
--   3. wstawia (wyszukiwanie, oferta) ON CONFLICT DO NOTHING — liczą się tylko nowe;
--   4. jeśli są nowe: jedno powiadomienie in-app (`job_match`, trigger 0035 respektuje
--      in_app_enabled) i jeden e-mail `jobMatch` przez enqueue_email (język ODBIORCY,
--      opt-out email_job_matches; klucz idempotencji = wyszukiwanie + przebieg);
--   5. przesuwa watermark i next_run_at o 1 dzień / 7 dni (limit częstotliwości:
--      najwyżej jeden digest na wyszukiwanie na okres).
-- Wiersze są blokowane FOR UPDATE SKIP LOCKED — dwa równoległe przebiegi nie
-- przetworzą tego samego wyszukiwania.
--
-- Rollback: drop function process_saved_search_alerts, delete_saved_search,
-- set_saved_search_alerts, save_saved_search, saved_search_canonical_filters,
-- saved_search_text_array; drop table saved_search_alerts, saved_searches.
-- =============================================================================

-- --- Tabele ---------------------------------------------------------------------
create table if not exists public.saved_searches (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 80),
  locale          text not null references public.supported_locales(code),
  filters_version smallint not null default 1 check (filters_version = 1),
  filters         jsonb not null check (jsonb_typeof(filters) = 'object'),
  filters_hash    text not null check (char_length(filters_hash) = 32),
  query           text not null default '' check (char_length(query) <= 2000),
  frequency       text not null default 'daily' check (frequency in ('daily', 'weekly')),
  alerts_enabled  boolean not null default true,
  -- Początek okresu alertów (utworzenie / ostatnie włączenie) — dolna granica „nowości".
  alerts_since    timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  next_run_at     timestamptz not null default now() + interval '1 day',
  last_alert_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (profile_id, filters_hash)
);
create index if not exists saved_searches_due_idx
  on public.saved_searches (next_run_at) where alerts_enabled;
create index if not exists saved_searches_profile_idx
  on public.saved_searches (profile_id, created_at desc);

drop trigger if exists trg_saved_searches_updated_at on public.saved_searches;
create trigger trg_saved_searches_updated_at
  before update on public.saved_searches
  for each row execute function public.set_updated_at();

create table if not exists public.saved_search_alerts (
  saved_search_id uuid not null references public.saved_searches(id) on delete cascade,
  job_id          uuid not null references public.jobs(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  digest_key      text not null,
  created_at      timestamptz not null default now(),
  primary key (saved_search_id, job_id)
);
create index if not exists saved_search_alerts_job_idx on public.saved_search_alerts (job_id);

alter table public.saved_searches enable row level security;
alter table public.saved_searches force row level security;
alter table public.saved_search_alerts enable row level security;
alter table public.saved_search_alerts force row level security;

revoke all on public.saved_searches from public, anon, authenticated;
grant select on public.saved_searches to authenticated;
revoke all on public.saved_search_alerts from public, anon, authenticated;

drop policy if exists saved_searches_select_own on public.saved_searches;
create policy saved_searches_select_own on public.saved_searches
  for select to authenticated
  using (profile_id = auth.uid());

-- --- Kanoniczne filtry ------------------------------------------------------------
-- Tablica tekstów z jsonb: przycięte, niepuste, unikalne, posortowane (C), ≤ p_max_len
-- znaków każda, najwyżej 50 pozycji. Nie-tablica / nie-teksty → VALIDATION_FAILED.
create or replace function public.saved_search_text_array(p_value jsonb, p_max_len integer)
returns text[] language plpgsql immutable set search_path = public, pg_temp as $$
declare v_out text[];
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then return null; end if;
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 50 then
    raise exception 'VALIDATION_FAILED: nieprawidłowa lista filtrów' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) <> 'string') then
    raise exception 'VALIDATION_FAILED: nieprawidłowa lista filtrów' using errcode = '22023';
  end if;
  select array_agg(v order by v collate "C") into v_out
  from (
    select distinct btrim(e) as v from jsonb_array_elements_text(p_value) e
    where btrim(e) <> ''
  ) s;
  if v_out is not null and exists (select 1 from unnest(v_out) v where char_length(v) > p_max_len) then
    raise exception 'VALIDATION_FAILED: za długa wartość filtra' using errcode = '22023';
  end if;
  return v_out;
end $$;
revoke all on function public.saved_search_text_array(jsonb, integer) from public, anon, authenticated;

-- Kanoniczna postać filtrów (wersja 1) — dokładnie argumenty get_public_jobs:
--   keyword, city (tekst ≤ 100, przycięty, małe litery — oba porównywane ILIKE),
--   categories / contractTypes (wartości enumów job_category / contract_type),
--   locations (dokładne nazwy miast, jak `j.city = any(...)`),
--   salaryMin / salaryMax (EUR brutto w jednostce salaryUnit, 0..1 000 000, min ≤ max),
--   salaryUnit ('hour' zapisywane tylko przy widełkach; brak = 'month', jak w 0091),
--   accommodation (bool), immediate / noLanguage (tylko true),
--   locale — wyłącznie przy słowie kluczowym (dopasowanie tytułu zależy od języka).
-- Klucze spoza listy → VALIDATION_FAILED (brak cichego gubienia filtrów). Pusty zestaw
-- (= wszystkie oferty) → VALIDATION_FAILED: alert musi coś zawężać.
create or replace function public.saved_search_canonical_filters(p_filters jsonb, p_locale text)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_text text;
  v_arr text[];
  v_min integer;
  v_max integer;
begin
  if p_filters is null or jsonb_typeof(p_filters) <> 'object' then
    raise exception 'VALIDATION_FAILED: filtry muszą być obiektem' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_filters) k
    where k not in ('keyword', 'city', 'categories', 'locations', 'contractTypes',
                    'salaryMin', 'salaryMax', 'salaryUnit', 'accommodation', 'immediate',
                    'noLanguage')
  ) then
    raise exception 'VALIDATION_FAILED: nieznany filtr' using errcode = '22023';
  end if;

  foreach v_text in array array['keyword', 'city'] loop
    if p_filters ? v_text and jsonb_typeof(p_filters -> v_text) <> 'null' then
      if jsonb_typeof(p_filters -> v_text) <> 'string'
         or char_length(btrim(p_filters ->> v_text)) > 100 then
        raise exception 'VALIDATION_FAILED: nieprawidłowy filtr tekstowy' using errcode = '22023';
      end if;
      if btrim(p_filters ->> v_text) <> '' then
        v_out := v_out || jsonb_build_object(v_text, lower(btrim(p_filters ->> v_text)));
      end if;
    end if;
  end loop;

  v_arr := public.saved_search_text_array(p_filters -> 'categories', 50);
  if v_arr is not null then
    if not v_arr <@ enum_range(null::public.job_category)::text[] then
      raise exception 'VALIDATION_FAILED: nieznana kategoria' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('categories', to_jsonb(v_arr));
  end if;

  v_arr := public.saved_search_text_array(p_filters -> 'contractTypes', 50);
  if v_arr is not null then
    if not v_arr <@ enum_range(null::public.contract_type)::text[] then
      raise exception 'VALIDATION_FAILED: nieznany rodzaj umowy' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('contractTypes', to_jsonb(v_arr));
  end if;

  v_arr := public.saved_search_text_array(p_filters -> 'locations', 100);
  if v_arr is not null then
    v_out := v_out || jsonb_build_object('locations', to_jsonb(v_arr));
  end if;

  foreach v_text in array array['salaryMin', 'salaryMax'] loop
    if p_filters ? v_text and jsonb_typeof(p_filters -> v_text) <> 'null' then
      if jsonb_typeof(p_filters -> v_text) <> 'number'
         or (p_filters ->> v_text)::numeric <> trunc((p_filters ->> v_text)::numeric)
         or (p_filters ->> v_text)::numeric not between 0 and 1000000 then
        raise exception 'VALIDATION_FAILED: nieprawidłowe wynagrodzenie' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object(v_text, (p_filters ->> v_text)::integer);
    end if;
  end loop;
  v_min := (v_out ->> 'salaryMin')::integer;
  v_max := (v_out ->> 'salaryMax')::integer;
  if v_min is not null and v_max is not null and v_min > v_max then
    raise exception 'VALIDATION_FAILED: minimum powyżej maksimum' using errcode = '22023';
  end if;

  -- Jednostka widełek (0091): 'month' (domyślna) albo 'hour'. Zapisujemy tylko 'hour'
  -- i tylko przy widełkach — bez kwot jednostka nie zawęża wyników.
  if p_filters ? 'salaryUnit' and jsonb_typeof(p_filters -> 'salaryUnit') <> 'null' then
    if jsonb_typeof(p_filters -> 'salaryUnit') <> 'string'
       or p_filters ->> 'salaryUnit' not in ('month', 'hour') then
      raise exception 'VALIDATION_FAILED: nieprawidłowa jednostka wynagrodzenia' using errcode = '22023';
    end if;
    if p_filters ->> 'salaryUnit' = 'hour' and (v_min is not null or v_max is not null) then
      v_out := v_out || jsonb_build_object('salaryUnit', 'hour');
    end if;
  end if;

  if p_filters ? 'accommodation' and jsonb_typeof(p_filters -> 'accommodation') <> 'null' then
    if jsonb_typeof(p_filters -> 'accommodation') <> 'boolean' then
      raise exception 'VALIDATION_FAILED: nieprawidłowy filtr zakwaterowania' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('accommodation', (p_filters ->> 'accommodation')::boolean);
  end if;

  foreach v_text in array array['immediate', 'noLanguage'] loop
    if p_filters ? v_text and jsonb_typeof(p_filters -> v_text) <> 'null' then
      if jsonb_typeof(p_filters -> v_text) <> 'boolean' then
        raise exception 'VALIDATION_FAILED: nieprawidłowy filtr' using errcode = '22023';
      end if;
      if (p_filters ->> v_text)::boolean then
        v_out := v_out || jsonb_build_object(v_text, true);
      end if;
    end if;
  end loop;

  if v_out = '{}'::jsonb then
    raise exception 'VALIDATION_FAILED: wymagany co najmniej jeden filtr' using errcode = '22023';
  end if;

  if v_out ? 'keyword' then
    if not coalesce(public.is_supported_locale(p_locale), false) then
      raise exception 'VALIDATION_FAILED: nieobsługiwany język' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('locale', p_locale);
  end if;

  return v_out;
end $$;
revoke all on function public.saved_search_canonical_filters(jsonb, text) from public, anon, authenticated;

-- --- RPC klienta ------------------------------------------------------------------
-- Zapis wyszukiwania. Identyczne (kanonicznie) filtry tego samego kandydata zwracają
-- istniejący wiersz (created = false) — podwójne kliknięcie/ponowienie bez duplikatu.
-- Limit 20 wyszukiwań na konto.
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
  if char_length(v_name) not between 1 and 80 then
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

-- Włączenie/wyłączenie alertu i zmiana częstotliwości. Ponowne włączenie przesuwa
-- watermark na „teraz" — kandydat dostaje tylko oferty opublikowane PO włączeniu,
-- bez zaległego zalewu z okresu wyłączenia.
create or replace function public.set_saved_search_alerts(
  p_saved_search_id uuid,
  p_enabled boolean,
  p_frequency text default null
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_row public.saved_searches%rowtype;
  v_freq text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_enabled is null then
    raise exception 'VALIDATION_FAILED: brak stanu alertu' using errcode = '22023';
  end if;
  if p_frequency is not null and p_frequency not in ('daily', 'weekly') then
    raise exception 'VALIDATION_FAILED: nieprawidłowa częstotliwość' using errcode = '22023';
  end if;

  select * into v_row from public.saved_searches s
    where s.id = p_saved_search_id and s.profile_id = v_uid
    for update;
  if v_row.id is null then
    raise exception 'NOT_FOUND: wyszukiwanie nie istnieje' using errcode = 'P0002';
  end if;

  v_freq := coalesce(p_frequency, v_row.frequency);
  if p_enabled and not v_row.alerts_enabled then
    update public.saved_searches
      set alerts_enabled = true, frequency = v_freq, last_checked_at = now(), alerts_since = now(),
          next_run_at = now() + case v_freq when 'weekly' then interval '7 days' else interval '1 day' end
      where id = v_row.id;
  elsif v_freq <> v_row.frequency or p_enabled <> v_row.alerts_enabled then
    update public.saved_searches
      set alerts_enabled = p_enabled, frequency = v_freq,
          next_run_at = v_row.last_checked_at
            + case v_freq when 'weekly' then interval '7 days' else interval '1 day' end
      where id = v_row.id;
  end if;
  return p_enabled;
end $$;
revoke all on function public.set_saved_search_alerts(uuid, boolean, text) from public, anon;
grant execute on function public.set_saved_search_alerts(uuid, boolean, text) to authenticated;

-- Usunięcie (razem z historią alertów — ON DELETE CASCADE). Cudze/nieistniejące → NOT_FOUND.
create or replace function public.delete_saved_search(p_saved_search_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  delete from public.saved_searches s
    where s.id = p_saved_search_id and s.profile_id = auth.uid();
  if not found then
    raise exception 'NOT_FOUND: wyszukiwanie nie istnieje' using errcode = 'P0002';
  end if;
end $$;
revoke all on function public.delete_saved_search(uuid) from public, anon;
grant execute on function public.delete_saved_search(uuid) to authenticated;

-- --- Worker (service_role) -------------------------------------------------------
-- Zwraca liczbę wysłanych digestów (wyszukiwań z co najmniej jedną nową ofertą).
create or replace function public.process_saved_search_alerts(p_limit integer default 200)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_search record;
  v_run_at timestamptz := now();
  v_key text;
  v_new uuid[];
  v_count integer;
  v_locale text;
  v_jobs jsonb;
  v_digests integer := 0;
  v_f jsonb;
begin
  for v_search in
    select s.*
    from public.saved_searches s
    join public.profiles p on p.id = s.profile_id
    where s.alerts_enabled
      and s.next_run_at <= v_run_at
      and p.role = 'candidate' and p.deleted_at is null
    order by s.next_run_at
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    for update of s skip locked
  loop
    v_f := v_search.filters;
    v_key := 'saved-search:' || v_search.id::text || ':' || (extract(epoch from v_run_at) * 1000000)::bigint::text;

    with found as (
      select g.id
      from public.get_public_jobs(
        p_locale         => v_search.locale,
        p_keyword        => v_f ->> 'keyword',
        p_city           => v_f ->> 'city',
        p_categories     => (select array_agg(x) from jsonb_array_elements_text(v_f -> 'categories') x),
        p_locations      => (select array_agg(x) from jsonb_array_elements_text(v_f -> 'locations') x),
        p_contract_types => (select array_agg(x) from jsonb_array_elements_text(v_f -> 'contractTypes') x),
        p_salary_min     => (v_f ->> 'salaryMin')::integer,
        p_salary_max     => (v_f ->> 'salaryMax')::integer,
        p_accommodation  => (v_f ->> 'accommodation')::boolean,
        p_immediate      => (v_f ->> 'immediate')::boolean,
        p_no_language    => (v_f ->> 'noLanguage')::boolean,
        p_since          => greatest(v_search.last_checked_at - interval '1 hour',
                                     v_search.alerts_since),
        p_sort           => 'newest',
        p_limit          => 100,
        p_offset         => 0,
        p_salary_unit    => coalesce(v_f ->> 'salaryUnit', 'month')
      ) g
      join public.jobs j on j.id = g.id
      where not public.candidate_blocked_company(v_search.profile_id, j.company_id)
    ), inserted as (
      insert into public.saved_search_alerts (saved_search_id, job_id, profile_id, digest_key)
      select v_search.id, f.id, v_search.profile_id, v_key from found f
      on conflict (saved_search_id, job_id) do nothing
      returning job_id
    )
    select array_agg(job_id) into v_new from inserted;
    v_count := coalesce(array_length(v_new, 1), 0);

    if v_count > 0 then
      -- Tytuły w języku ODBIORCY (Invariant #1); dopasowanie liczyło locale wyszukiwania.
      v_locale := public.resolve_recipient_locale(v_search.profile_id);
      select coalesce(jsonb_agg(x.item order by x.published_at desc), '[]'::jsonb) into v_jobs
      from (
        select j.published_at,
               jsonb_build_object(
                 'title', coalesce(t.title, j.title),
                 'city', j.city,
                 'slug', j.slug,
                 'companyName', c.name) as item
        from public.jobs j
        join public.companies c on c.id = j.company_id
        left join lateral (
          select jt.title from public.job_translations jt
          where jt.job_id = j.id
          order by (jt.locale = v_locale) desc, (jt.locale = j.default_locale) desc,
                   (jt.locale = 'en') desc
          limit 1
        ) t on true
        where j.id = any(v_new)
        order by j.published_at desc
        limit 5
      ) x;

      insert into public.notifications (profile_id, type, title, data, entity_type, entity_id)
      values (v_search.profile_id, 'job_match', 'saved_search',
              jsonb_build_object('kind', 'saved_search', 'count', v_count,
                                 'name', v_search.name),
              'saved_search', v_search.id);

      perform public.enqueue_email(
        v_search.profile_id, 'jobMatch', 'saved_search', v_search.id, v_key,
        jsonb_build_object('searchName', v_search.name, 'count', v_count,
                           'jobs', v_jobs, 'query', v_search.query));

      v_digests := v_digests + 1;
    end if;

    update public.saved_searches
      set last_checked_at = v_run_at,
          next_run_at = v_run_at + case v_search.frequency
                                     when 'weekly' then interval '7 days' else interval '1 day' end,
          last_alert_at = case when v_count > 0 then v_run_at else last_alert_at end
      where id = v_search.id;
  end loop;

  return v_digests;
end $$;
revoke all on function public.process_saved_search_alerts(integer) from public, anon, authenticated;
grant execute on function public.process_saved_search_alerts(integer) to service_role;
