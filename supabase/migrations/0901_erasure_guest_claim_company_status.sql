-- =============================================================================
-- 0901_erasure_guest_claim_company_status.sql — numer TYMCZASOWY (ostateczny nada
-- integrator). Dwie poprawki spójności z audytu:
--
-- 1. Usunięcie konta kandydata, który przejął aplikację gościa (#486 × #98).
--    `erase_candidate_subject` (0105) usuwa `guest_application_requests` kandydata.
--    Klucz `applications.guest_request_id` ma `ON DELETE SET NULL`, więc PostgreSQL robi
--    `UPDATE applications SET guest_request_id = NULL`. Trigger
--    `enforce_application_integrity` (0095) przy aktywnej sesji (auth.uid() nie jest NULL,
--    czyli ścieżka samoobsługowa `request_account_erasure`) traktował to jako zmianę
--    niezmiennego pola i rzucał PERMISSION_DENIED — całe usunięcie się cofało (art. 17 RODO).
--    Retencja (bez sesji) przechodziła, więc problem dotyczył tylko samoobsługi.
--
--    Poprawka: trigger przepuszcza zmianę `guest_request_id` na NULL WYŁĄCZNIE wtedy, gdy
--    zgłoszenie gościa, na które wskazywała aplikacja, już nie istnieje — czyli dokładnie
--    akcję klucza obcego po usunięciu zgłoszenia (tak jak `reports_guard` przepuszcza
--    FK → null, 0105). Wyzerowanie linku przy istniejącym zgłoszeniu i każda inna zmiana
--    pola nadal = PERMISSION_DENIED. Reszta funkcji bez zmian (wierna kopia z 0095).
--
-- 2. `job_is_public` sprawdza firmę (DC-04 / SM16-01).
--    Wszystkie odczyty publiczne (get_public_jobs, _count, get_public_job, _by_ids, facety,
--    profil firmy, lejek) wymagają firmy `verified` i nieusuniętej. `job_is_public` (0048)
--    sprawdzał tylko ofertę, więc oferta firmy zawieszonej (także decyzją DSA 0099),
--    odrzuconej, w `pending` po zmianie nazwy/VAT (0072) albo usuniętej dalej przyjmowała
--    aplikacje: `apply_to_job`, `submit_guest_application_core`, `confirm_guest_application`
--    (link potwierdzenia wysłany przed zawieszeniem), a `get_public_job_screening_questions`
--    zwracało pytania. Dodajemy warunek na firmę — jedna definicja „oferta publiczna”.
--
--    Wywołujący (przejrzani):
--      * apply_to_job (0093), submit_guest_application_core (0095),
--        confirm_guest_application (0095) → JOB_NOT_ACTIVE / outcome 'job_closed';
--      * get_public_job_screening_questions (0154) → brak pytań (strona i tak 404);
--      * submit_content_report (0094, DSA) → NOT_FOUND dla oferty firmy niezweryfikowanej;
--        treść nie jest już publiczna (get_public_job = 404), więc zgodnie z regułą
--        „zgłaszać można tylko treść publiczną”; sprawę firmy prowadzi decyzja moderacyjna;
--      * get_job_company_block (0078) — kontrolka na stronie oferty, która i tak jest 404;
--        blokady zarządzane w ustawieniach kandydata bez zmian;
--      * record_job_funnel (0128) — już wymagał firmy verified (bez zmian skutku);
--      * polityki SELECT anon/authenticated na job_translations/requirements/skills (0009)
--        i job_languages/certificates (0030): `job_is_public(job_id) or
--        is_job_company_member(job_id)` — firma dalej widzi swoje dane, anon przestaje widzieć
--        relacje oferty ukrytej na liście (spójnie z get_public_job);
--      * applications_insert_candidate (0009) — bezpośredni INSERT odebrany w 0025.
--    Historia kandydata (get_applied_jobs_display, get_offered_jobs_display, szczegół
--    zgłoszenia) nie używa job_is_public — kandydat nadal widzi swoje zgłoszenia.
--
-- Rollback: odtworzyć job_is_public z 0048 i enforce_application_integrity z 0095.
-- =============================================================================

-- --- 1. job_is_public (0048) + firma verified i nieusunięta ----------------------------------
create or replace function public.job_is_public(p_job_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.jobs j
    join public.companies c on c.id = j.company_id
    where j.id = p_job_id
      and j.status = 'active'
      and j.deleted_at is null
      and (j.expires_at is null or j.expires_at > now())
      and c.status = 'verified'
      and c.deleted_at is null
  );
$$;

-- --- 2. enforce_application_integrity (0095) + akcja FK guest_request_id → NULL -------------
create or replace function public.enforce_application_integrity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.candidate_id := auth.uid();
      new.company_id := (select company_id from public.jobs where id = new.job_id);
      new.match_score := null;
      -- Aplikacja z sesją nigdy nie jest aplikacją gościa.
      new.guest_name := null; new.guest_email := null; new.guest_request_id := null; new.claimed_at := null;
      if new.status is null or new.status not in ('draft', 'submitted') then
        new.status := 'submitted';
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if auth.uid() is not null then
      -- Jedyna dozwolona zmiana kandydata: przejęcie aplikacji gościa (NULL → auth.uid())
      -- wewnątrz claim_guest_application (flaga transakcji z id tej aplikacji).
      if new.candidate_id is distinct from old.candidate_id
         and not (old.candidate_id is null
                  and new.candidate_id = auth.uid()
                  and new.claimed_at is not null
                  and coalesce(current_setting('pracujbe.guest_claim', true), '') = new.id::text) then
        raise exception 'PERMISSION_DENIED: nie można zmienić powiązań aplikacji' using errcode = '42501';
      end if;
      if new.job_id is distinct from old.job_id
         or new.company_id is distinct from old.company_id then
        raise exception 'PERMISSION_DENIED: nie można zmienić powiązań aplikacji' using errcode = '42501';
      end if;
      if new.message is distinct from old.message
         or new.phone is distinct from old.phone
         or new.availability is distinct from old.availability
         or new.locale is distinct from old.locale
         or new.idempotency_key is distinct from old.idempotency_key
         or new.match_score is distinct from old.match_score
         or new.submitted_at is distinct from old.submitted_at
         or new.guest_name is distinct from old.guest_name
         or new.guest_email is distinct from old.guest_email
         -- guest_request_id → NULL tylko jako akcja FK (ON DELETE SET NULL): zgłoszenia już
         -- nie ma (np. erase_candidate_subject pod sesją kandydata). Inaczej niezmienne.
         or (new.guest_request_id is distinct from old.guest_request_id
             and not (new.guest_request_id is null
                      and not exists (select 1 from public.guest_application_requests g
                                       where g.id = old.guest_request_id)))
         or (new.claimed_at is distinct from old.claimed_at
             and new.candidate_id is not distinct from old.candidate_id) then
        raise exception 'PERMISSION_DENIED: pola aplikacji są niezmienne po wysłaniu' using errcode = '42501';
      end if;
      -- Kandydat (właściciel): może jedynie wycofać aplikację.
      if new.candidate_id = auth.uid()
         and new.status is distinct from old.status
         and new.status <> 'withdrawn' then
        raise exception 'PERMISSION_DENIED: kandydat może jedynie wycofać aplikację' using errcode = '42501';
      end if;
      -- Firma (nie kandydat; także aplikacja gościa z candidate_id NULL): status tylko z
      -- allow-listy transition_application.
      if new.candidate_id is distinct from auth.uid()
         and new.status is distinct from old.status
         and new.status not in ('viewed','shortlisted','interview','offer_sent','rejected','hired') then
        raise exception 'PERMISSION_DENIED: niedozwolone przejście statusu aplikacji przez firmę'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $function$;
