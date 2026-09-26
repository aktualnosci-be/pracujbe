-- =============================================================================
-- 0192 (NUMER TYMCZASOWY — ostateczny nada integrator) — stronicowanie kursorem list panelu
-- pracodawcy (audyt P1-05).
--
-- Problem: `/employer/oferty` i `/employer/aplikacje` stronicowały przez OFFSET (koszt rośnie
-- z numerem strony, a wiersz wstawiony/usunięty między stronami przesuwa granicę — dubel albo
-- dziura), a `/employer/kandydaci` pokazywał tylko 5 najlepszych dopasowań (reszta
-- niedostępna).
--
-- Zmiana:
--   1. Indeksy częściowe pod kursor (czas + UUID) w obrębie firmy: zgłoszenia po
--      (company_id, submitted_at, id), oferty po (company_id, created_at, id) — tylko
--      nieusunięte, tak jak filtrują loadery.
--   2. get_company_matches_page(firma, limit, kursor wyniku, kursor kandydata, kierunek) —
--      najlepsze dopasowanie NA KANDYDATA (jak get_company_top_matches z 0079) w porządku
--      (score DESC, candidate_id ASC) z kursorem w obu kierunkach: 'next' = kolejne (gorsze)
--      wyniki, 'prev' = poprzednie. SECURITY INVOKER: RLS wywołującego (recruiter+ firmy,
--      widoczność kandydata, blokady #97) i bramka firmy zweryfikowanej — bez zmian względem
--      0079. Limit 1–51 (strona 50 + znacznik kolejnej).
--
-- Dowód: supabase/tests/rls.sql sekcja EP05 (granica strony z remisem wyniku, oba kierunki,
-- izolacja firm i roli member; kontrola ujemna: OFFSET po wstawieniu wiersza dubluje rekord).
-- Rollback: drop function public.get_company_matches_page(uuid, integer, integer, uuid, text);
-- drop index public.idx_applications_company_submitted; drop index public.idx_jobs_company_created.
-- =============================================================================

create index if not exists idx_applications_company_submitted
  on public.applications (company_id, submitted_at desc, id desc)
  where deleted_at is null;

create index if not exists idx_jobs_company_created
  on public.jobs (company_id, created_at desc, id desc)
  where deleted_at is null;

create function public.get_company_matches_page(
  p_company_id uuid,
  p_limit integer default 10,
  p_cursor_score integer default null,
  p_cursor_candidate uuid default null,
  p_direction text default 'next'
)
returns table (candidate_id uuid, job_id uuid, score integer)
language sql stable security invoker set search_path = public, pg_temp as $$
  select b.candidate_id, b.job_id, b.score
  from (
    select distinct on (m.candidate_id) m.candidate_id, m.job_id, m.score
    from public.matches m
    join public.jobs j on j.id = m.job_id
    where j.company_id = p_company_id
      and j.deleted_at is null
      -- Widoczność kandydata pod RLS wywołującego (candidate_profiles_select_*).
      and exists (select 1 from public.candidate_profiles cp where cp.profile_id = m.candidate_id)
      and exists (select 1 from public.companies c
                  where c.id = p_company_id and c.status = 'verified' and c.deleted_at is null)
    order by m.candidate_id, m.score desc, m.job_id
  ) b
  -- Porządek listy = rosnąca krotka (-score, candidate_id). Kursor bez obu pól = pierwsza strona.
  where p_cursor_score is null or p_cursor_candidate is null
     or (p_direction = 'prev' and (-b.score, b.candidate_id) < (-p_cursor_score, p_cursor_candidate))
     or (p_direction is distinct from 'prev' and (-b.score, b.candidate_id) > (-p_cursor_score, p_cursor_candidate))
  -- 'prev' czyta wstecz (najbliższe kursorowi pierwsze); aplikacja odwraca stronę.
  order by case when p_direction = 'prev' then b.score end asc,
           case when p_direction = 'prev' then b.candidate_id end desc,
           b.score desc, b.candidate_id asc
  limit least(greatest(coalesce(p_limit, 10), 1), 51);
$$;
revoke all on function public.get_company_matches_page(uuid, integer, integer, uuid, text) from public;
revoke all on function public.get_company_matches_page(uuid, integer, integer, uuid, text) from anon;
grant execute on function public.get_company_matches_page(uuid, integer, integer, uuid, text) to authenticated;
