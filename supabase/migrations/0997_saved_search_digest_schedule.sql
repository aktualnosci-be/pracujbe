-- =============================================================================
-- 0997 (numer tymczasowy — ostateczny nada integrator) — alerty zapisanych wyszukiwań bez
-- dryfu terminu digestu (#1112, TIME21-04).
--
-- Problem: `process_saved_search_alerts` (0138) ustawiał `next_run_at = now() + 1 dzień/7 dni`,
-- czyli od chwili PRZEBIEGU. Cron co godzinę (albo spóźniony/nieregularny) przesuwał porę
-- digestu z każdym przebiegiem (08:00 → 08:20 → 08:45 …), a odstępy rosły ponad dobę/tydzień.
--
-- Zmiana:
--   * `saved_search_next_run_at(poprzedni termin, częstotliwość, chwila przebiegu)` — kolejny
--     termin = poprzedni termin + pełne okresy (1 dzień / 7 dni) w czasie ŚCIENNYM
--     Europe/Brussels (pora nie przeskakuje o godzinę przy zmianie czasu); pierwszy termin
--     PÓŹNIEJSZY niż chwila przebiegu (zaległe okresy są pomijane — jeden digest, bez serii);
--   * `process_saved_search_alerts` — treść 1:1 z 0138, poza wyliczeniem `next_run_at`.
-- Watermark (`last_checked_at`), wybór ofert, blokady firm, digest ≤ 5 ofert i klucze
-- idempotencji bez zmian. Tryb ogłoszeniowy: bez zmian (alerty wynikają z filtrów, #1148).
-- Rollback: supabase/rollback/0997_saved_search_digest_schedule.down.sql.
-- =============================================================================

create or replace function public.saved_search_next_run_at(
  p_previous timestamptz, p_frequency text, p_run_at timestamptz
) returns timestamptz language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_days integer := case when p_frequency = 'weekly' then 7 else 1 end;
  v_local timestamp;
  v_steps bigint;
  v_next timestamptz;
begin
  if p_run_at is null then return null; end if;
  -- Brak poprzedniego terminu albo termin z przyszłości (taki wiersz nie jest wybierany) —
  -- zachowanie sprzed 0997: okres od chwili przebiegu.
  if p_previous is null or p_previous > p_run_at then
    return p_run_at + make_interval(days => v_days);
  end if;
  v_local := p_previous at time zone 'Europe/Brussels';
  -- Liczba okresów do pierwszego terminu po przebiegu (przybliżenie w dobach UTC; pętla
  -- koryguje różnicę ±1 h przy zmianie czasu).
  v_steps := floor(extract(epoch from (p_run_at - p_previous)) / (86400 * v_days))::bigint + 1;
  v_next := (v_local + make_interval(days => (v_steps * v_days)::integer)) at time zone 'Europe/Brussels';
  while v_next <= p_run_at loop
    v_steps := v_steps + 1;
    v_next := (v_local + make_interval(days => (v_steps * v_days)::integer)) at time zone 'Europe/Brussels';
  end loop;
  return v_next;
end $$;
revoke all on function public.saved_search_next_run_at(timestamptz, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.saved_search_next_run_at(timestamptz, text, timestamptz) to service_role;

-- --- Worker (0138) — kolejny termin bez dryfu ------------------------------------------
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
          -- 0997 (#1112): stała pora w Europe/Brussels od poprzedniego terminu, nie od chwili
          -- przebiegu — spóźniony/nieregularny cron nie przesuwa kolejnych digestów.
          next_run_at = public.saved_search_next_run_at(v_search.next_run_at, v_search.frequency, v_run_at),
          last_alert_at = case when v_count > 0 then v_run_at else last_alert_at end
      where id = v_search.id;
  end loop;

  return v_digests;
end $$;
revoke all on function public.process_saved_search_alerts(integer) from public, anon, authenticated;
grant execute on function public.process_saved_search_alerts(integer) to service_role;
