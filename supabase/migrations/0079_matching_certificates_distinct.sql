-- =============================================================================
-- 0079 — dopasowanie: data ważności certyfikatów kandydata (#96) oraz pięciu RÓŻNYCH
--        najlepiej dopasowanych kandydatów firmy (#141).
--
-- 1. set_candidate_certificates(p_certificates jsonb) zastępuje wersję text[] z 0028.
--    Elementem tablicy jest etykieta (string — zgodność ze starszą aplikacją) albo obiekt
--    {"label": "...", "expires_at": "YYYY-MM-DD" | null}. candidate_certificates.expires_at
--    istnieje od 0004, ale nie było jak jej zapisać; matching (scoreMatch) nie liczy
--    certyfikatu z expires_at wcześniejszym niż bieżąca data. Replace-all, dedup po etykiecie
--    (pierwsze wystąpienie wygrywa), te same obcięcia co w 0028 (160 znaków, 60 pozycji).
--    PostgREST wysyła tablicę JSON, więc stary klient (tablica stringów) działa bez zmian.
-- 2. get_company_top_matches(p_company_id, p_limit) — najlepsze dopasowanie NA KANDYDATA
--    (DISTINCT ON candidate_id, score desc, job_id) wyliczone PRZED limitem. Wcześniej loader
--    brał 24 najlepsze wiersze `matches` i deduplikował dopiero w aplikacji, więc kandydat
--    dopasowany do wielu ofert firmy wypierał pozostałych. SECURITY INVOKER: obowiązuje RLS
--    matches (recruiter+ firmy, 0039), jobs i candidate_profiles (widoczność kandydata:
--    wyszukiwalny kompletny profil dla zweryfikowanej firmy albo relacja aplikacja/propozycja).
--    Firma musi być zweryfikowana. Remis wyniku: rosnąco po candidate_id (stabilnie).
--
-- Rollback: `drop function public.get_company_top_matches(uuid, integer);`,
-- `drop function public.set_candidate_certificates(jsonb);` i odtworzenie
-- set_candidate_certificates(text[]) z 0028 (z grantem dla authenticated). Dane bez zmian.
-- =============================================================================

drop function if exists public.set_candidate_certificates(text[]);

create function public.set_candidate_certificates(p_certificates jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cp uuid := public.ensure_candidate_profile();
begin
  if p_certificates is not null and jsonb_typeof(p_certificates) <> 'array' then
    raise exception 'VALIDATION_FAILED: certificates must be an array' using errcode = '22023';
  end if;

  delete from public.candidate_certificates where candidate_profile_id = v_cp;
  insert into public.candidate_certificates (candidate_profile_id, certificate_label, expires_at)
    select v_cp, label, expires_at from (
      select distinct on (label) label, expires_at, ord
      from (
        select
          left(btrim(case jsonb_typeof(e) when 'string' then e #>> '{}' else e ->> 'label' end), 160) as label,
          case when jsonb_typeof(e) = 'object'
               then nullif(btrim(coalesce(e ->> 'expires_at', '')), '')::date end as expires_at,
          ord
        from jsonb_array_elements(coalesce(p_certificates, '[]'::jsonb)) with ordinality as t(e, ord)
        where jsonb_typeof(e) in ('string', 'object')
      ) raw
      where label is not null and label <> ''
      order by label, ord
    ) q
    order by ord
    limit 60
  on conflict (candidate_profile_id, certificate_label) do nothing;
end $$;
revoke all on function public.set_candidate_certificates(jsonb) from public;
grant execute on function public.set_candidate_certificates(jsonb) to authenticated;

create function public.get_company_top_matches(p_company_id uuid, p_limit integer default 5)
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
  order by b.score desc, b.candidate_id
  limit least(greatest(coalesce(p_limit, 5), 1), 20);
$$;
revoke all on function public.get_company_top_matches(uuid, integer) from public;
grant execute on function public.get_company_top_matches(uuid, integer) to authenticated;
