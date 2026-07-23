-- =============================================================================
-- 0013_security_hardening_2.sql
-- Druga fala remediacji audytu (2026-07-23): domknięcie ustaleń dot. bazy danych.
--   * P0 — anonimowy odczyt profili kandydatów i tabel-dzieci (skills/languages/certificates);
--          helper nie sprawdzał profile_completed. Teraz: TYLKO zweryfikowana firma (opt-in).
--   * P0 — niezamrożony payload aplikacji/propozycji (message/idempotency_key/locale/match_score).
--          Teraz: kolumny niezmienne po INSERT (zmiana tylko przez backend/service_role).
-- =============================================================================

-- --- Helper: czy zalogowany należy do AKTYWNEGO członkostwa ZWERYFIKOWANEJ firmy ---
create or replace function public.current_user_has_verified_company()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.company_members cm
    join public.companies c on c.id = cm.company_id
    where cm.profile_id = auth.uid()
      and cm.is_active = true
      and c.status = 'verified'
      and c.deleted_at is null
  );
$$;

-- =============================================================================
-- P0 — profile kandydatów: odcięcie anon; widoczność tylko dla zweryfikowanej firmy
-- =============================================================================
-- Helper dzieci: teraz wymaga profile_completed ORAZ uprawnionego pracodawcy (anon => false).
create or replace function public.candidate_profile_is_searchable(p_candidate_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.candidate_profiles cp
    where cp.id = p_candidate_profile_id
      and cp.is_searchable = true
      and cp.profile_completed = true
      and cp.deleted_at is null
  ) and public.current_user_has_verified_company();
$$;

-- Profil: brak anon; publiczny (opt-in) odczyt tylko dla zweryfikowanej firmy.
drop policy if exists candidate_profiles_select_public on public.candidate_profiles;
create policy candidate_profiles_select_employer on public.candidate_profiles
  for select to authenticated
  using (
    is_searchable = true
    and profile_completed = true
    and deleted_at is null
    and public.current_user_has_verified_company()
  );

-- Tabele-dzieci: usuń anon; ten sam warunek (owner / uprawniona firma) tylko dla authenticated.
drop policy if exists candidate_skills_select on public.candidate_skills;
create policy candidate_skills_select on public.candidate_skills
  for select to authenticated
  using (
    public.owns_candidate_profile(candidate_profile_id)
    or public.candidate_profile_is_searchable(candidate_profile_id)
    or public.company_can_view_candidate(
      (select cp.profile_id from public.candidate_profiles cp where cp.id = candidate_skills.candidate_profile_id)
    )
  );

drop policy if exists candidate_languages_select on public.candidate_languages;
create policy candidate_languages_select on public.candidate_languages
  for select to authenticated
  using (
    public.owns_candidate_profile(candidate_profile_id)
    or public.candidate_profile_is_searchable(candidate_profile_id)
    or public.company_can_view_candidate(
      (select cp.profile_id from public.candidate_profiles cp where cp.id = candidate_languages.candidate_profile_id)
    )
  );

drop policy if exists candidate_certificates_select on public.candidate_certificates;
create policy candidate_certificates_select on public.candidate_certificates
  for select to authenticated
  using (
    public.owns_candidate_profile(candidate_profile_id)
    or public.candidate_profile_is_searchable(candidate_profile_id)
    or public.company_can_view_candidate(
      (select cp.profile_id from public.candidate_profiles cp where cp.id = candidate_certificates.candidate_profile_id)
    )
  );

-- =============================================================================
-- P0 — zamrożenie payloadu aplikacji/propozycji po INSERT (klient nie podmienia treści/klucza)
-- =============================================================================
create or replace function public.enforce_application_integrity()
returns trigger language plpgsql security definer set search_path = public as $function$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.candidate_id := auth.uid();
      new.company_id := (select company_id from public.jobs where id = new.job_id);
      new.match_score := null;                                          -- score liczy backend
      if new.status is null or new.status not in ('draft', 'submitted') then
        new.status := 'submitted';
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if auth.uid() is not null then
      if new.candidate_id is distinct from old.candidate_id
         or new.job_id is distinct from old.job_id
         or new.company_id is distinct from old.company_id then
        raise exception 'PERMISSION_DENIED: nie można zmienić powiązań aplikacji' using errcode = '42501';
      end if;
      -- Payload niezmienny po wysłaniu (treść/telefon/dostępność/locale/klucz/score/czas).
      if new.message is distinct from old.message
         or new.phone is distinct from old.phone
         or new.availability is distinct from old.availability
         or new.locale is distinct from old.locale
         or new.idempotency_key is distinct from old.idempotency_key
         or new.match_score is distinct from old.match_score
         or new.submitted_at is distinct from old.submitted_at then
        raise exception 'PERMISSION_DENIED: pola aplikacji są niezmienne po wysłaniu' using errcode = '42501';
      end if;
      -- Kandydat (właściciel) może jedynie wycofać aplikację.
      if new.candidate_id = auth.uid()
         and new.status is distinct from old.status
         and new.status <> 'withdrawn' then
        raise exception 'PERMISSION_DENIED: kandydat może jedynie wycofać aplikację' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $function$;

create or replace function public.enforce_offer_integrity()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_company uuid; v_company_status text; v_job_status text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      select j.company_id, c.status::text, j.status::text
        into v_company, v_company_status, v_job_status
        from public.jobs j join public.companies c on c.id = j.company_id
        where j.id = new.job_id;
      if v_company is null then raise exception 'JOB_NOT_ACTIVE: oferta nie istnieje' using errcode = '42501'; end if;
      if not public.is_company_member(v_company) then
        raise exception 'PERMISSION_DENIED: brak członkostwa w firmie oferty' using errcode = '42501';
      end if;
      if v_company_status <> 'verified' then raise exception 'COMPANY_NOT_VERIFIED' using errcode = '42501'; end if;
      if v_job_status <> 'active' then raise exception 'JOB_NOT_ACTIVE' using errcode = '42501'; end if;
      new.company_id := v_company;
      new.sender_id := auth.uid();
      if new.status is null or new.status not in ('draft', 'sent') then new.status := 'sent'; end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if auth.uid() is not null then
      if new.job_id is distinct from old.job_id
         or new.candidate_id is distinct from old.candidate_id
         or new.company_id is distinct from old.company_id
         or new.sender_id is distinct from old.sender_id then
        raise exception 'PERMISSION_DENIED: nie można zmienić powiązań propozycji' using errcode = '42501';
      end if;
      -- Payload niezmienny po INSERT (klucz idempotencyjny / treść / locale / czas wysyłki).
      if new.idempotency_key is distinct from old.idempotency_key
         or new.message is distinct from old.message
         or new.locale is distinct from old.locale
         or new.sent_at is distinct from old.sent_at then
        raise exception 'PERMISSION_DENIED: payload propozycji jest niezmienny' using errcode = '42501';
      end if;
      -- Kandydat (odbiorca) może jedynie zaakceptować/odrzucić.
      if new.candidate_id = auth.uid()
         and new.status is distinct from old.status
         and new.status not in ('accepted', 'declined') then
        raise exception 'PERMISSION_DENIED: kandydat może jedynie zaakceptować/odrzucić propozycję' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $function$;
