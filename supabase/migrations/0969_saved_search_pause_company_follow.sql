-- =============================================================================
-- 0969 (numer tymczasowy) — czasowa pauza alertów i obserwowanie firmy (#810, #855)
--
-- Decyzja właściciela: konto kandydata = alerty + dziennik aplikacji; zapisane wyszukiwania
-- działają w trybie ogłoszeniowym (bez profilu kandydata, bez dopasowań).
--
-- 1. #810 — jedna czasowa pauza alertów o nowych ofertach dla całego konta:
--    `saved_search_alert_pauses` (jeden wiersz na konto, `paused_until`), RPC
--    `set_saved_search_alerts_pause(date)` (null = wznowienie od razu). Indywidualne flagi
--    i częstotliwości wyszukiwań zostają bez zmian. Worker pomija konta w pauzie, a po jej końcu
--    (albo po wcześniejszym wznowieniu) liczy nowości od `paused_until` — oferty z okresu
--    pauzy nie wracają lawiną, oferty po wznowieniu trafiają do kolejnych alertów.
-- 2. #855 — obserwowanie firmy jako zapisane wyszukiwanie z kluczem firmy:
--    `saved_searches.company_id` (stabilny klucz, nie słowo kluczowe tytułu). Filtry v1
--    (`filters`) zostają bez zmian (`{}` dla obserwacji), więc `saved_search_canonical_filters`,
--    `get_public_jobs` i kopia `saved_search_jobs_after` nie są ruszane. RPC `follow_company`,
--    `unfollow_company`, `get_my_followed_companies`. Worker dla obserwacji bierze nowe,
--    publiczne oferty tej firmy (aktywne, niewygasłe, firma verified), pomija firmy
--    zablokowane przez kandydata i korzysta z tej samej deduplikacji par (wyszukiwanie, oferta),
--    alertu, e-maila `jobMatch` i wypisania co zapisane wyszukiwanie. Firma nie widzi obserwujących
--    (brak jakiegokolwiek odczytu po stronie firm).
--
-- Rollback: supabase/rollback/0969_saved_search_pause_company_follow.down.sql
-- =============================================================================

-- --- 1. Pauza alertów -------------------------------------------------------------------
create table if not exists public.saved_search_alert_pauses (
  profile_id   uuid primary key references public.profiles(id) on delete cascade,
  -- Alerty wracają od tej chwili; wartość w przeszłości = pauza zakończona (zostaje jako
  -- dolna granica „nowości”, żeby oferty z okresu pauzy nie wróciły w jednym digeście).
  paused_until timestamptz not null,
  updated_at   timestamptz not null default now()
);

alter table public.saved_search_alert_pauses enable row level security;
alter table public.saved_search_alert_pauses force row level security;
revoke all on public.saved_search_alert_pauses from public, anon, authenticated;
grant select on public.saved_search_alert_pauses to authenticated;

drop policy if exists saved_search_alert_pauses_select_own on public.saved_search_alert_pauses;
create policy saved_search_alert_pauses_select_own on public.saved_search_alert_pauses
  for select to authenticated
  using (profile_id = auth.uid());

-- Pauza do dnia `p_until` (początek tego dnia, Europe/Brussels): jutro..+366 dni. null =
-- wznowienie od razu (trwająca pauza kończy się „teraz”; brak pauzy = bez zmian).
-- Zwraca aktywny koniec pauzy albo null.
create or replace function public.set_saved_search_alerts_pause(p_until date)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Europe/Brussels')::date;
  v_until timestamptz;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.role = 'candidate' and p.deleted_at is null
  ) then
    raise exception 'PERMISSION_DENIED: tylko kandydat wstrzymuje alerty' using errcode = '42501';
  end if;

  -- Blokada profilu serializuje równoległe zmiany pauzy tego konta.
  perform 1 from public.profiles where id = v_uid for update;

  if p_until is null then
    update public.saved_search_alert_pauses
       set paused_until = now(), updated_at = now()
     where profile_id = v_uid and paused_until > now();
    return null;
  end if;

  if p_until <= v_today or p_until > v_today + 366 then
    raise exception 'VALIDATION_FAILED: data wznowienia od jutra do roku' using errcode = '22023';
  end if;
  v_until := p_until::timestamp at time zone 'Europe/Brussels';

  insert into public.saved_search_alert_pauses (profile_id, paused_until)
  values (v_uid, v_until)
  on conflict (profile_id) do update
    set paused_until = excluded.paused_until, updated_at = now();
  return v_until;
end $$;
revoke all on function public.set_saved_search_alerts_pause(date) from public, anon;
grant execute on function public.set_saved_search_alerts_pause(date) to authenticated;

-- --- 2. Obserwowanie firmy ---------------------------------------------------------------
alter table public.saved_searches
  add column if not exists company_id uuid references public.companies(id) on delete cascade;
create index if not exists saved_searches_company_idx
  on public.saved_searches (company_id) where company_id is not null;

-- Obserwuje zweryfikowaną firmę z publicznym profilem. Ponowne wywołanie zwraca istniejący
-- wiersz (created = false). Obserwacja liczy się do limitu 20 wyszukiwań konta. Firma
-- zablokowana przez kandydata, niezweryfikowana albo usunięta = NOT_FOUND (neutralnie).
create or replace function public.follow_company(p_company_id uuid, p_locale text)
returns table (saved_search_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_hash text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.role = 'candidate' and p.deleted_at is null
  ) then
    raise exception 'PERMISSION_DENIED: tylko kandydat obserwuje firmy' using errcode = '42501';
  end if;
  if not coalesce(public.is_supported_locale(p_locale), false) then
    raise exception 'VALIDATION_FAILED: nieobsługiwany język' using errcode = '22023';
  end if;

  select left(btrim(c.name), 80) into v_name
    from public.companies c
   where c.id = p_company_id and c.status = 'verified' and c.deleted_at is null
     and c.slug is not null and btrim(c.name) <> ''
     and not public.candidate_blocked_company(v_uid, c.id);
  if v_name is null then
    raise exception 'NOT_FOUND: firma nie istnieje' using errcode = 'P0002';
  end if;

  v_hash := md5('company:' || p_company_id::text);
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
     last_checked_at, next_run_at, company_id)
  values
    (v_uid, v_name, p_locale, '{}'::jsonb, v_hash, '', 'daily',
     now(), now() + interval '1 day', p_company_id)
  returning id into v_id;

  return query select v_id, true;
end $$;
revoke all on function public.follow_company(uuid, text) from public, anon;
grant execute on function public.follow_company(uuid, text) to authenticated;

-- Przestaje obserwować (idempotentnie: brak obserwacji nie jest błędem).
create or replace function public.unfollow_company(p_company_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  delete from public.saved_searches s
   where s.profile_id = auth.uid() and s.company_id = p_company_id;
end $$;
revoke all on function public.unfollow_company(uuid) from public, anon;
grant execute on function public.unfollow_company(uuid) to authenticated;

-- Własne obserwacje z adresem profilu firmy (kandydat nie czyta `companies` pod RLS).
-- Firma niezweryfikowana/usunięta → brak slugu (panel nie linkuje do nieistniejącego profilu).
create or replace function public.get_my_followed_companies()
returns table (saved_search_id uuid, company_id uuid, company_slug text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.company_id,
         case when c.status = 'verified' and c.deleted_at is null then c.slug end
    from public.saved_searches s
    join public.companies c on c.id = s.company_id
   where s.profile_id = auth.uid() and s.company_id is not null;
$$;
revoke all on function public.get_my_followed_companies() from public, anon;
grant execute on function public.get_my_followed_companies() to authenticated;

-- --- 3. Worker (definicja bazuje na 0138) ---------------------------------------------------
-- Zmiany względem 0138: pomijanie kont w pauzie + dolna granica `paused_until`; obserwacje
-- firm (`company_id`) biorą nowe oferty tej firmy zamiast filtrów listy.
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
  v_since timestamptz;
begin
  for v_search in
    select s.*, ap.paused_until
    from public.saved_searches s
    join public.profiles p on p.id = s.profile_id
    left join public.saved_search_alert_pauses ap on ap.profile_id = s.profile_id
    where s.alerts_enabled
      and s.next_run_at <= v_run_at
      and p.role = 'candidate' and p.deleted_at is null
      -- 0969 (#810): konto w pauzie nie dostaje alertów; wyszukiwanie zostaje „do wykonania”.
      and (ap.paused_until is null or ap.paused_until <= v_run_at)
    order by s.next_run_at
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    for update of s skip locked
  loop
    v_f := v_search.filters;
    v_key := 'saved-search:' || v_search.id::text || ':' || (extract(epoch from v_run_at) * 1000000)::bigint::text;
    -- Nowości liczone od końca ostatniej pauzy: oferty z jej okresu nie wracają lawiną.
    v_since := greatest(v_search.last_checked_at - interval '1 hour', v_search.alerts_since,
                        coalesce(v_search.paused_until, '-infinity'::timestamptz));

    if v_search.company_id is null then
      -- 0138: wszystkie strony (nie tylko 100 najnowszych), jeden snapshot.
      with found as (
        select m.id
        from public.saved_search_matching_jobs(v_f, v_search.locale, v_since) as m(id)
        join public.jobs j on j.id = m.id
        where not public.candidate_blocked_company(v_search.profile_id, j.company_id)
      ), inserted as (
        insert into public.saved_search_alerts (saved_search_id, job_id, profile_id, digest_key)
        select v_search.id, f.id, v_search.profile_id, v_key from found f
        on conflict (saved_search_id, job_id) do nothing
        returning job_id
      )
      select array_agg(job_id) into v_new from inserted;
    else
      -- 0969 (#855): obserwowana firma — nowe, publiczne oferty po `company_id`.
      with found as (
        select j.id
        from public.jobs j
        join public.companies c on c.id = j.company_id
        where j.company_id = v_search.company_id
          and j.status = 'active' and j.deleted_at is null
          and (j.expires_at is null or j.expires_at > v_run_at)
          and c.status = 'verified' and c.deleted_at is null
          and j.published_at >= v_since
          and not public.candidate_blocked_company(v_search.profile_id, j.company_id)
      ), inserted as (
        insert into public.saved_search_alerts (saved_search_id, job_id, profile_id, digest_key)
        select v_search.id, f.id, v_search.profile_id, v_key from found f
        on conflict (saved_search_id, job_id) do nothing
        returning job_id
      )
      select array_agg(job_id) into v_new from inserted;
    end if;
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
