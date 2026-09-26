-- =============================================================================
-- 0215_saved_jobs_availability.sql — zapisane oferty kandydata ze stanem oferty.
--
-- Numer tymczasowy — ostateczny nada integrator.
--
-- `get_saved_jobs_display` (0066) zwracała WYŁĄCZNIE oferty publiczne: zapisana oferta, która
-- została zamknięta, wygasła, wstrzymana, usunięta albo której firma straciła weryfikację,
-- znikała z `/candidate/zapisane` bez śladu, a wiersz `saved_jobs` zostawał (kandydat nie mógł
-- go usunąć z panelu).
--
-- Teraz funkcja zwraca KAŻDY własny zapis z kolumną `job_availability`:
--   available   — oferta publiczna (te same warunki co `get_public_job`: aktywna, nieusunięta,
--                 przed terminem, firma `verified` i nieusunięta),
--   closed      — status `closed` albo oferta/firma usunięta,
--   expired     — status `expired` albo termin `expires_at` minął,
--   paused      — wstrzymana przez pracodawcę (przed terminem),
--   unavailable — inaczej (szkic, firma niezweryfikowana/zawieszona).
-- `slug` jest zwracany WYŁĄCZNIE dla `available` — panel linkuje tylko do strony, która
-- istnieje. Tytuł, firma i miasto zostają dla każdego stanu (to własny zapis kandydata).
-- Klasyfikacja zgodna z `candidate_job_availability` z historii zgłoszeń (PR #758) plus stan
-- `paused`; celowo inline, bez zależności od tamtej migracji.
--
-- Zmiana typu wyniku wymaga DROP + CREATE; granty jak w 0066 (bez anon).
-- Rollback: `drop function public.get_saved_jobs_display(text)` i odtworzenie definicji z 0066.
-- =============================================================================

drop function if exists public.get_saved_jobs_display(text);

create function public.get_saved_jobs_display(p_locale text default 'pl')
returns table (
  id uuid,
  slug text,
  title text,
  company_name text,
  city text,
  job_availability text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    j.id,
    case when v.availability = 'available' then j.slug end as slug,
    coalesce(t.title, j.title) as title,
    coalesce(c.name, '') as company_name,
    coalesce(j.city, '') as city,
    v.availability
  from public.saved_jobs s
  join public.jobs j on j.id = s.job_id
  left join public.companies c on c.id = j.company_id
  cross join lateral (
    select case
      when j.deleted_at is null and j.status = 'active'
           and (j.expires_at is null or j.expires_at > now())
           and c.status = 'verified' and c.deleted_at is null
        then 'available'
      when j.deleted_at is not null or j.status = 'closed' or c.deleted_at is not null
        then 'closed'
      when j.status = 'expired'
           or (j.status in ('active', 'paused') and j.expires_at is not null and j.expires_at <= now())
        then 'expired'
      when j.status = 'paused'
        then 'paused'
      else 'unavailable'
    end as availability
  ) v
  left join lateral (
    select jt.title
    from public.job_translations jt
    where jt.job_id = j.id
    order by
      (jt.locale = case when public.is_supported_locale(p_locale) then p_locale else 'pl' end) desc,
      (jt.locale = j.default_locale) desc,
      (jt.locale = 'en') desc
    limit 1
  ) t on true
  where s.candidate_id = auth.uid()
  order by s.created_at desc, j.id desc;
$$;

revoke all on function public.get_saved_jobs_display(text) from public, anon;
grant execute on function public.get_saved_jobs_display(text) to authenticated;
