-- =============================================================================
-- 0219_public_job_machine_translation.sql — #33: odczyt przekładu oferty na publicznej
-- stronie w języku widza (numer TYMCZASOWY — ostateczny nada integrator).
--
-- Zależy od 0145 (kolejka, translation_documents) i 0146 (synchronizacja ofert).
--
-- Tabele kolejki są deny dla anon/authenticated (0145). Strona oferty potrzebuje jednak
-- przekładu dla języka, w którym oferta NIE ma własnego tłumaczenia. Jedyna ścieżka to
-- `get_public_job_machine_translation(job, locale)` (SECURITY DEFINER, anon/authenticated):
--
--   * tylko oferta publiczna w tym samym sensie co `get_public_job` (active, nieusunięta,
--     niewygasła, firma verified i nieusunięta) i nie demonstracyjna,
--   * tylko źródło aktywne i przekład BIEŻĄCEJ rewizji (`revision_id = current_revision_id`,
--     `not is_stale`) — nigdy przekład starej treści po edycji oferty,
--   * tylko gdy rewizja jest w języku oferty (`default_locale`) i język docelowy jest inny,
--   * tylko gdy oferta nie ma w tym języku własnego tłumaczenia ani wymagań (tekst człowieka
--     ma pierwszeństwo przed przekładem),
--   * tylko gdy strona pokazuje tę treść, z której powstała rewizja: `get_public_job` przy
--     braku tłumaczenia w języku strony bierze tłumaczenie w `default_locale`, a gdy go nie ma
--     — dowolne inne (np. `en`), choć rewizja powstaje z `default_locale` (albo `jobs.title`,
--     gdy tłumaczeń nie ma wcale, 0146). Wymagamy więc tłumaczenia w `default_locale` albo
--     braku tłumaczeń — inaczej przekład nie odpowiadałby wyświetlanemu oryginałowi (ten sam
--     warunek co karty listy, 0226),
--   * zwraca wyłącznie pola wyświetlane na stronie (lista kluczy niżej) — bez meta, autora
--     korekty, wersji pipeline ani identyfikatorów kolejki.
--
-- Treść przekładu pochodzi z publicznej treści oferty, więc nie ujawnia niczego ponad to, co
-- `get_public_job` zwraca w języku oryginału.
--
-- Rollback: drop function public.get_public_job_machine_translation(uuid, text).
-- =============================================================================

create or replace function public.get_public_job_machine_translation(p_job_id uuid, p_locale text)
returns table (source_locale text, origin text, fields jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.source_locale,
         d.origin,
         coalesce((
           select jsonb_object_agg(e.key, e.value)
             from jsonb_each(d.fields) e
            where jsonb_typeof(e.value) = 'string'
              and (e.key in ('title', 'description', 'working_hours', 'shifts', 'company_description')
                   or e.key ~ '^(responsibilities|conditions|highlights|requirements_mandatory|requirements_optional)\.[0-9]{1,4}$')
         ), '{}'::jsonb) as fields
    from public.jobs j
    join public.companies c on c.id = j.company_id
    join public.translation_sources s on s.entity_type = 'job' and s.entity_id = j.id
    join public.translation_source_revisions r on r.id = s.current_revision_id
    join public.translation_documents d
      on d.entity_type = 'job' and d.entity_id = j.id and d.locale = p_locale
   where j.id = p_job_id
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
          or not exists (select 1 from public.job_translations jt where jt.job_id = j.id))
   limit 1;
$$;
revoke all on function public.get_public_job_machine_translation(uuid, text) from public;
grant execute on function public.get_public_job_machine_translation(uuid, text)
  to anon, authenticated, service_role;
