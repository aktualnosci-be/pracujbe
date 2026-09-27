-- =============================================================================
-- 0138 (numer nadany przez integratora; 0134 #622, 0135 #653, 0136 #626, 0137 #658) — alerty zapisanych
-- wyszukiwań bez limitu 100 ofert na przebieg (#100).
--
-- Problem (0092): process_saved_search_alerts wołał get_public_jobs raz, z p_limit => 100
-- i sortem „najnowsze”. Gdy od ostatniego przebiegu pojawiło się > 100 pasujących ofert,
-- starsze od setnej nigdy nie trafiały do saved_search_alerts: watermark przesuwał się na
-- czas przebiegu, więc w kolejnym przebiegu wypadały poza p_since — oferta 101. przepadała.
--
-- Zmiana:
--   1. Stały porządek remisów `published_at` zapewnia 0136 (#594: `j.id desc` w ORDER BY
--      get_public_jobs) — bez niego strony z różnym offsetem mogły mieć dziury i duble.
--   2. saved_search_matching_jobs(filtry, locale, since, max_pages) — WSZYSTKIE pasujące
--      oferty: kolejne strony get_public_jobs (po 100) w JEDNYM zapytaniu (rekurencyjne
--      CTE). Funkcje STABLE w jednym zapytaniu widzą jeden snapshot, więc oferta
--      zamknięta/opublikowana w trakcie przebiegu nie przesuwa stron. Dopasowanie nadal
--      liczy ta sama funkcja co lista ofert. Górna granica = limit offsetu listy
--      (10 000) → najwyżej 101 stron = 10 100 ofert na wyszukiwanie w jednym przebiegu.
--   3. process_saved_search_alerts: nowe oferty z saved_search_matching_jobs zamiast
--      jednej strony. Bez zmian: rejestr (wyszukiwanie, oferta) z PK = brak ponownej
--      wysyłki pary, jedno in-app i jeden e-mail na przebieg, digest ≤ 5 ofert (count =
--      liczba wszystkich nowych), next_run_at + 1 dzień / 7 dni.
--
-- Dowód: supabase/tests/rls.sql sekcja SC100 (105 ofert z jednym published_at; kontrola
-- ujemna: jedna strona jak w 0092 gubi ofertę 101).
-- Rollback: przywróć process_saved_search_alerts z 0092,
-- drop function saved_search_matching_jobs(jsonb, text, timestamptz, integer),
-- saved_search_job_page(jsonb, text, timestamptz, integer).
-- =============================================================================

-- Jedna strona (100 ofert) get_public_jobs z kanonicznymi filtrami v1 (0092).
create or replace function public.saved_search_job_page(
  p_filters jsonb, p_locale text, p_since timestamptz, p_offset integer
) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select g.id
  from public.get_public_jobs(
    p_locale         => p_locale,
    p_keyword        => p_filters ->> 'keyword',
    p_city           => p_filters ->> 'city',
    p_categories     => (select array_agg(x) from jsonb_array_elements_text(p_filters -> 'categories') x),
    p_locations      => (select array_agg(x) from jsonb_array_elements_text(p_filters -> 'locations') x),
    p_contract_types => (select array_agg(x) from jsonb_array_elements_text(p_filters -> 'contractTypes') x),
    p_salary_min     => (p_filters ->> 'salaryMin')::integer,
    p_salary_max     => (p_filters ->> 'salaryMax')::integer,
    p_accommodation  => (p_filters ->> 'accommodation')::boolean,
    p_immediate      => (p_filters ->> 'immediate')::boolean,
    p_no_language    => (p_filters ->> 'noLanguage')::boolean,
    p_since          => p_since,
    p_sort           => 'newest',
    p_limit          => 100,
    p_offset         => p_offset,
    p_salary_unit    => coalesce(p_filters ->> 'salaryUnit', 'month')
  ) g;
$$;


-- --- Wszystkie pasujące oferty zapisanego wyszukiwania (tylko service_role) --------------
create or replace function public.saved_search_matching_jobs(
  p_filters   jsonb,
  p_locale    text,
  p_since     timestamptz,
  p_max_pages integer default 101
) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive pages(page_offset, ids) as (
    select 0, array(select public.saved_search_job_page(p_filters, p_locale, p_since, 0))
    union all
    select p.page_offset + 100,
           array(select public.saved_search_job_page(p_filters, p_locale, p_since, p.page_offset + 100))
    from pages p
    where cardinality(p.ids) = 100
      and p.page_offset + 100 <= 10000
      and (p.page_offset / 100) + 1 < least(greatest(coalesce(p_max_pages, 101), 1), 101)
  )
  select distinct unnest(ids) from pages;
$$;

revoke all on function public.saved_search_job_page(jsonb, text, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.saved_search_job_page(jsonb, text, timestamptz, integer) to service_role;
revoke all on function public.saved_search_matching_jobs(jsonb, text, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.saved_search_matching_jobs(jsonb, text, timestamptz, integer) to service_role;

-- --- Worker (0092) — nowe oferty ze wszystkich stron ------------------------------------
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

    -- 0138: wszystkie strony (nie tylko 100 najnowszych), jeden snapshot.
    with found as (
      select m.id
      from public.saved_search_matching_jobs(
        v_f, v_search.locale,
        greatest(v_search.last_checked_at - interval '1 hour', v_search.alerts_since)
      ) as m(id)
      join public.jobs j on j.id = m.id
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
