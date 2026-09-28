-- =============================================================================
-- 0160_public_jobs_machine_titles.sql — #33: przekład tytułu i wyróżników ofert na LIŚCIE
-- (karty ofert: strona główna, /oferty-pracy, landingi, profil firmy) w języku widza.
-- Zależy od 0145, 0146 i 0159.
--
-- Jedno wywołanie na stronę listy: `get_public_jobs_machine_titles(ids[], locale)` przyjmuje
-- identyfikatory ofert bieżącej strony (najwyżej 100 — tyle, ile zwraca `get_public_jobs`)
-- i zwraca wiersz tylko dla ofert, które mają aktualny przekład. Te same warunki co
-- `get_public_job_machine_translation` (0159):
--
--   * oferta publiczna (active, nieusunięta, niewygasła, firma verified i nieusunięta), nie demo,
--   * źródło aktywne i przekład BIEŻĄCEJ rewizji (`revision_id = current_revision_id`,
--     `not is_stale`), rewizja w języku oferty, język docelowy inny niż źródło,
--   * oferta nie ma w tym języku własnego tłumaczenia ani wymagań (tekst człowieka wygrywa),
--
-- oraz jeden warunek właściwy liście: karta pokazuje tytuł z `get_public_jobs`, który przy
-- braku tłumaczenia w języku strony bierze tłumaczenie w `default_locale` (albo `jobs.title`,
-- gdy tłumaczeń nie ma wcale). Wymagamy, żeby karta pokazywała właśnie tę treść, z której
-- powstała rewizja — inaczej (np. tytuł z tłumaczenia `en` przy braku `default_locale`)
-- przekład nie odpowiadałby oryginałowi na karcie.
--
-- Zwraca wyłącznie pola karty: `title` i `highlights.N`.
--
-- Rollback: drop function public.get_public_jobs_machine_titles(uuid[], text).
-- =============================================================================

create or replace function public.get_public_jobs_machine_titles(p_job_ids uuid[], p_locale text)
returns table (job_id uuid, source_locale text, origin text, fields jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select j.id,
         r.source_locale,
         d.origin,
         coalesce((
           select jsonb_object_agg(e.key, e.value)
             from jsonb_each(d.fields) e
            where jsonb_typeof(e.value) = 'string'
              and (e.key = 'title' or e.key ~ '^highlights\.[0-9]{1,4}$')
         ), '{}'::jsonb) as fields
    from public.jobs j
    join public.companies c on c.id = j.company_id
    join public.translation_sources s on s.entity_type = 'job' and s.entity_id = j.id
    join public.translation_source_revisions r on r.id = s.current_revision_id
    join public.translation_documents d
      on d.entity_type = 'job' and d.entity_id = j.id and d.locale = p_locale
   where j.id = any ((coalesce(p_job_ids, '{}'::uuid[]))[1:100])
     and public.is_supported_locale(p_locale)
     and j.status = 'active'
     and j.deleted_at is null
     and (j.expires_at is null or j.expires_at > now())
     and not j.is_demo
     and c.status = 'verified'
     and c.deleted_at is null
     and s.is_active
     and d.revision_id = s.current_revision_id
     and not d.is_stale
     and r.source_locale = j.default_locale
     and p_locale <> r.source_locale
     and not exists (select 1 from public.job_translations jt
                      where jt.job_id = j.id and jt.locale = p_locale)
     and not exists (select 1 from public.job_requirements q
                      where q.job_id = j.id and q.locale = p_locale)
     and (exists (select 1 from public.job_translations jt
                   where jt.job_id = j.id and jt.locale = j.default_locale)
          or not exists (select 1 from public.job_translations jt where jt.job_id = j.id));
$$;
revoke all on function public.get_public_jobs_machine_titles(uuid[], text) from public;
grant execute on function public.get_public_jobs_machine_titles(uuid[], text)
  to anon, authenticated, service_role;
