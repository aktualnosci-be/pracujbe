-- 0216_job_duplicate_draft.sql — „Kopiuj jako szkic” na liście ofert pracodawcy
-- (numer tymczasowy; ostateczny nada integrator).
--
-- Rekruter tworzy nowy SZKIC w tej samej firmie z treścią istniejącej oferty w dowolnym
-- statusie (szkic, aktywna, wstrzymana, zamknięta, wygasła). Jedno transakcyjne RPC
-- `duplicate_job_as_draft(job, client_key)`:
--   1. auth.uid() → UNAUTHENTICATED; klucz klienta wymagany (VALIDATION_FAILED).
--   2. Idempotencja: blokada doradcza (konto, klucz) + tabela `job_duplications`
--      (unikat created_by + client_key). Ponowienie tym samym kluczem (podwójne kliknięcie,
--      retry po zerwanym połączeniu) zwraca TEN SAM szkic; ten sam klucz dla innej oferty →
--      VALIDATION_FAILED.
--   3. Oferta nieistniejąca/usunięta albo firma, której użytkownik nie jest aktywnym członkiem
--      → NOT_FOUND (bez ujawniania istnienia cudzej oferty); członek bez roli recruiter+
--      (`can_manage_jobs`) → PERMISSION_DENIED.
--   4. Firma zawieszona (status `suspended` albo blokada `moderation_decision_id`) →
--      COMPANY_SUSPENDED; oferta z aktywną decyzją moderacyjną (`jobs.moderation_decision_id`)
--      → MODERATION_LOCKED. Treść wycofaną decyzją nie da się „odrodzić” kopią.
--   5. Kopiowane: kolumny `jobs` z listy dozwolonych `save_job_draft` (0083) + default_locale
--      i is_demo, tłumaczenie w języku oferty (bez meta_*), wymagania, umiejętności, języki,
--      certyfikaty i pytania screeningowe (0093). Pytania wstawiane do nowego szkicu przechodzą
--      detektor i — przy trafieniu — NOWY przegląd (`screening_question_reviews` jest per
--      oferta, trigger 0103), więc decyzje admina ze źródła nie przechodzą na kopię.
--   6. NIE kopiowane: status (zawsze `draft`), slug (techniczny `draft-…`), published_at,
--      expires_at, zgłoszenia, liczniki (views/applications), lejek (#99), blokada
--      moderacyjna, tłumaczenia w innych językach (tłumaczenia AI powstaną z nowego źródła).
--   7. Audyt `job.duplicated` (źródło, firma) w tej samej transakcji.
--
-- Rollback: `drop function public.duplicate_job_as_draft(uuid, uuid); drop table public.job_duplications;`
-- Migracja nie zmienia istniejących danych.

create table if not exists public.job_duplications (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  source_job_id uuid references public.jobs(id) on delete set null,
  new_job_id    uuid not null references public.jobs(id) on delete cascade,
  created_by    uuid references public.profiles(id) on delete set null,
  client_key    uuid not null,
  created_at    timestamptz not null default now(),
  unique (created_by, client_key)
);
create index if not exists idx_job_duplications_source on public.job_duplications(source_job_id);

-- RPC-only: klient nie czyta ani nie zapisuje tabeli bezpośrednio.
alter table public.job_duplications enable row level security;
alter table public.job_duplications force row level security;
revoke all on public.job_duplications from public, anon, authenticated;

create or replace function public.duplicate_job_as_draft(p_job_id uuid, p_client_key uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_src public.jobs%rowtype;
  v_cstatus text; v_clock uuid;
  v_existing_src uuid; v_existing_new uuid; v_existing_company uuid;
  v_new uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_job_id is null or p_client_key is null then
    raise exception 'VALIDATION_FAILED: brak oferty albo klucza' using errcode = '42501';
  end if;

  -- Serializacja ponowień tego samego klucza (dwa równoległe kliknięcia = jeden szkic).
  perform pg_advisory_xact_lock(hashtextextended('job_duplicate:' || v_uid::text || ':' || p_client_key::text, 0));

  select d.source_job_id, d.new_job_id, d.company_id
    into v_existing_src, v_existing_new, v_existing_company
    from public.job_duplications d
    where d.created_by = v_uid and d.client_key = p_client_key;
  if v_existing_new is not null then
    if v_existing_src is distinct from p_job_id then
      raise exception 'VALIDATION_FAILED: klucz użyty dla innej oferty' using errcode = '42501';
    end if;
    if not public.can_manage_jobs(v_existing_company) then
      raise exception 'PERMISSION_DENIED: kopiowanie oferty wymaga roli recruiter+' using errcode = '42501';
    end if;
    return v_existing_new;
  end if;

  select * into v_src from public.jobs j where j.id = p_job_id and j.deleted_at is null;
  if v_src.id is null or not public.is_company_member(v_src.company_id) then
    raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002';
  end if;
  if not public.can_manage_jobs(v_src.company_id) then
    raise exception 'PERMISSION_DENIED: kopiowanie oferty wymaga roli recruiter+' using errcode = '42501';
  end if;

  select c.status::text, c.moderation_decision_id into v_cstatus, v_clock
    from public.companies c where c.id = v_src.company_id;
  if v_cstatus = 'suspended' or v_clock is not null then
    raise exception 'COMPANY_SUSPENDED: firma zawieszona' using errcode = '42501';
  end if;
  if v_src.moderation_decision_id is not null then
    raise exception 'MODERATION_LOCKED: oferta wycofana decyzją moderacyjną' using errcode = '42501';
  end if;

  insert into public.jobs (
    company_id, created_by, slug, default_locale, title, status, category, occupation,
    contract_type, city, region, address, remote, salary_min, salary_max, currency,
    salary_period, working_hours, shifts, start_immediately, immediate, start_date,
    min_experience_years, requires_driving_license, no_language_required, accommodation,
    transport, contact_email, is_demo)
  values (
    v_src.company_id, v_uid, 'draft-' || gen_random_uuid()::text, v_src.default_locale,
    v_src.title, 'draft', v_src.category, v_src.occupation, v_src.contract_type, v_src.city,
    v_src.region, v_src.address, v_src.remote, v_src.salary_min, v_src.salary_max,
    v_src.currency, v_src.salary_period, v_src.working_hours, v_src.shifts,
    v_src.start_immediately, v_src.immediate, v_src.start_date, v_src.min_experience_years,
    v_src.requires_driving_license, v_src.no_language_required, v_src.accommodation,
    v_src.transport, v_src.contact_email, v_src.is_demo)
  returning id into v_new;

  -- Tłumaczenie w języku oferty (tytuł zawsze z jobs.title — jak save_job_draft).
  insert into public.job_translations (job_id, locale, title, description, responsibilities,
                                       conditions, benefits, highlights, working_hours, shifts,
                                       company_description)
    select v_new, t.locale, v_src.title, t.description, t.responsibilities, t.conditions,
           t.benefits, t.highlights, t.working_hours, t.shifts, t.company_description
      from public.job_translations t
      where t.job_id = p_job_id and t.locale = v_src.default_locale;

  insert into public.job_requirements (job_id, locale, kind, position, content)
    select v_new, r.locale, r.kind, r.position, r.content
      from public.job_requirements r where r.job_id = p_job_id
      order by r.kind, r.position, r.created_at, r.id;

  insert into public.job_skills (job_id, skill_id, skill_label, is_mandatory)
    select v_new, s.skill_id, s.skill_label, s.is_mandatory
      from public.job_skills s where s.job_id = p_job_id
      order by s.created_at, s.id;

  insert into public.job_languages (job_id, language_label, level)
    select v_new, l.language_label, l.level
      from public.job_languages l where l.job_id = p_job_id
      order by l.created_at, l.id;

  insert into public.job_certificates (job_id, certificate_label)
    select v_new, c.certificate_label
      from public.job_certificates c where c.job_id = p_job_id
      order by c.created_at, c.id;

  -- Pytania: trigger 0103 liczy ryzyko i zgłasza NOWY przegląd dla nowego szkicu.
  insert into public.job_screening_questions (job_id, position, type, required, prompt, options)
    select v_new, q.position, q.type, q.required, q.prompt, q.options
      from public.job_screening_questions q where q.job_id = p_job_id
      order by q.position;

  insert into public.job_duplications (company_id, source_job_id, new_job_id, created_by, client_key)
    values (v_src.company_id, p_job_id, v_new, v_uid, p_client_key);

  perform public.write_audit('job.duplicated', 'job', v_new, null,
    jsonb_build_object('source_job_id', p_job_id, 'company_id', v_src.company_id,
                       'status', 'draft'));

  return v_new;
end $$;
revoke all on function public.duplicate_job_as_draft(uuid, uuid) from public, anon;
grant execute on function public.duplicate_job_as_draft(uuid, uuid) to authenticated;
