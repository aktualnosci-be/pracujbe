-- =============================================================================
-- 0009_rls.sql
-- Pracuj.be — Row Level Security (RLS) + polityki dostępu.
--
-- Model bezpieczeństwa (Supabase):
--   * anon           — użytkownik niezalogowany (klucz anon). Widzi tylko dane publiczne.
--   * authenticated  — użytkownik zalogowany (auth.uid() != null). Widzi swoje + publiczne.
--   * service_role   — backend/klucz serwisowy. Ma BYPASSRLS -> omija WSZYSTKIE polityki.
--
-- Zasada: włączamy RLS na każdej tabeli z danymi. Tabela bez pasującej polityki
-- jest niedostępna dla anon/authenticated (deny-by-default); service_role i tak omija RLS.
-- Dlatego audit_logs/system_events/email_deliveries/discount_codes NIE mają polityk —
-- to je zamyka dla anon/authenticated, a backend (service_role) czyta je bez ograniczeń.
--
-- Idempotencja: enable RLS jest idempotentne; każda polityka ma poprzedzający
-- `drop policy if exists`, więc migrację można uruchomić ponownie bez błędu.
--
-- Ograniczenie RLS: polityki działają NA POZIOMIE WIERSZA, nie kolumny. Tam gdzie kontrakt
-- mówi o "podstawowych polach" (firmy) lub "profilu publicznym", zawężenie kolumn robi
-- warstwa aplikacji (SELECT konkretnych pól / widoki). RLS gwarantuje tu dostęp do wiersza.
-- =============================================================================

-- =============================================================================
-- Funkcje pomocnicze (SECURITY DEFINER).
-- Uruchamiane z uprawnieniami właściciela (postgres) -> ich wewnętrzne zapytania
-- OMIJAJĄ RLS. To eliminuje rekurencję polityk (np. company_members sprawdzające
-- członkostwo w company_members) i upraszcza wyrażenia USING/WITH CHECK.
-- Wszystkie: stable + set search_path=public (ochrona przed przejęciem search_path).
-- =============================================================================

-- Czy bieżący użytkownik jest AKTYWNYM członkiem danej firmy.
create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = p_company_id
      and cm.profile_id = auth.uid()
      and cm.is_active = true
  );
$$;

-- Czy bieżący użytkownik jest właścicielem/adminem danej firmy (zarządzanie członkami, billing).
create or replace function public.is_company_admin(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = p_company_id
      and cm.profile_id = auth.uid()
      and cm.is_active = true
      and cm.role in ('owner', 'admin')
  );
$$;

-- Czy firma jest zweryfikowana (warunek publikacji ofert: status='active').
create or replace function public.company_is_verified(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.companies c
    where c.id = p_company_id
      and c.status = 'verified'
      and c.deleted_at is null
  );
$$;

-- Czy bieżący użytkownik jest członkiem firmy będącej właścicielem danej oferty.
create or replace function public.is_job_company_member(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.jobs j
    join public.company_members cm on cm.company_id = j.company_id
    where j.id = p_job_id
      and cm.profile_id = auth.uid()
      and cm.is_active = true
  );
$$;

-- Czy dana oferta jest publicznie widoczna (opublikowana i nieusunięta).
create or replace function public.job_is_public(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.jobs j
    where j.id = p_job_id
      and j.status = 'active'
      and j.deleted_at is null
  );
$$;

-- Czy bieżący użytkownik jest właścicielem danego candidate_profiles (po jego PK).
create or replace function public.owns_candidate_profile(p_candidate_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.candidate_profiles cp
    where cp.id = p_candidate_profile_id
      and cp.profile_id = auth.uid()
  );
$$;

-- Czy dany candidate_profiles jest publicznie widoczny (opt-in kandydata na wyszukiwanie).
create or replace function public.candidate_profile_is_searchable(p_candidate_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.candidate_profiles cp
    where cp.id = p_candidate_profile_id
      and cp.is_searchable = true
      and cp.deleted_at is null
  );
$$;

-- Czy firma bieżącego użytkownika ma relację (aplikacja lub propozycja) z danym kandydatem.
-- p_profile_id = profiles.id (tożsamość kandydata; = applications.candidate_id / offers.candidate_id).
-- Pozwala pracodawcy zobaczyć profil/dane kandydata, który aplikował lub dostał ofertę.
create or replace function public.company_can_view_candidate(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.applications a
    join public.company_members cm on cm.company_id = a.company_id
    where a.candidate_id = p_profile_id
      and cm.profile_id = auth.uid()
      and cm.is_active = true
  ) or exists (
    select 1
    from public.offers o
    join public.company_members cm on cm.company_id = o.company_id
    where o.candidate_id = p_profile_id
      and cm.profile_id = auth.uid()
      and cm.is_active = true
  );
$$;

-- Czy bieżący użytkownik jest uczestnikiem danej konwersacji (bez rekurencji na conversation_members).
create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.profile_id = auth.uid()
  );
$$;

-- Czy dana konwersacja została utworzona przez bieżącego użytkownika (bootstrap uczestników).
create or replace function public.conversation_created_by_me(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and c.created_by = auth.uid()
  );
$$;

-- Dostęp do aplikacji (kandydat-właściciel lub członek firmy oferty) — dla tabel powiązanych.
create or replace function public.can_access_application(p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.applications a
    where a.id = p_application_id
      and (a.candidate_id = auth.uid() or public.is_job_company_member(a.job_id))
  );
$$;

-- Dostęp do propozycji (kandydat-odbiorca lub członek firmy-nadawcy) — dla tabel powiązanych.
create or replace function public.can_access_offer(p_offer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.offers o
    where o.id = p_offer_id
      and (
        o.candidate_id = auth.uid()
        or public.is_job_company_member(o.job_id)
        or public.is_company_member(o.company_id)
      )
  );
$$;

-- Wykonanie funkcji dostępne dla ról klienta (są bezpieczne: zwracają boolean w oparciu o auth.uid()).
grant execute on function
  public.is_company_member(uuid),
  public.is_company_admin(uuid),
  public.company_is_verified(uuid),
  public.is_job_company_member(uuid),
  public.job_is_public(uuid),
  public.owns_candidate_profile(uuid),
  public.candidate_profile_is_searchable(uuid),
  public.company_can_view_candidate(uuid),
  public.is_conversation_member(uuid),
  public.conversation_created_by_me(uuid),
  public.can_access_application(uuid),
  public.can_access_offer(uuid)
to anon, authenticated;

-- =============================================================================
-- Włączenie RLS na wszystkich tabelach z danymi (idempotentnie).
-- Nie używamy FORCE — service_role ma omijać RLS.
-- =============================================================================
do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'candidate_profiles', 'employer_profiles', 'companies', 'company_members',
    'categories', 'occupations', 'skills', 'languages', 'certificates', 'locations',
    'jobs', 'job_translations', 'job_requirements', 'job_skills',
    'candidate_skills', 'candidate_languages', 'candidate_certificates', 'saved_jobs',
    'applications', 'application_status_history', 'matches', 'offers', 'offer_status_history',
    'conversations', 'conversation_members', 'messages',
    'notifications', 'notification_preferences', 'email_deliveries',
    'files', 'consent_versions', 'consents', 'reports', 'discount_codes',
    'subscriptions', 'invoices', 'payments', 'audit_logs', 'system_events'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- Tabele wyłącznie serwisowe: dodatkowo odbieramy uprawnienia rolom klienta
-- (defense-in-depth ponad deny-by-default z RLS).
revoke all on table public.audit_logs      from anon, authenticated;
revoke all on table public.system_events    from anon, authenticated;
revoke all on table public.email_deliveries from anon, authenticated;
revoke all on table public.discount_codes   from anon, authenticated;

-- =============================================================================
-- Słowniki referencyjne — publiczny odczyt, zapis tylko service_role.
-- categories, occupations, skills, languages, certificates, locations, consent_versions.
-- =============================================================================
do $$
declare
  t text;
  dict text[] := array[
    'categories', 'occupations', 'skills', 'languages',
    'certificates', 'locations', 'consent_versions'
  ];
begin
  foreach t in array dict loop
    execute format('drop policy if exists %I on public.%I;', t || '_public_read', t);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true);',
      t || '_public_read', t
    );
  end loop;
end $$;

-- =============================================================================
-- profiles — właściciel czyta/edytuje swój profil; pracodawca widzi profil kandydata
-- powiązanego relacją (aplikacja/propozycja). Bez anonimowego odczytu (chroni PII:
-- e-mail/telefon). Publiczna widoczność zawodowa jest na candidate_profiles (niżej).
-- =============================================================================
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_select_company_candidate on public.profiles;
create policy profiles_select_company_candidate on public.profiles
  for select to authenticated
  using (public.company_can_view_candidate(id));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- =============================================================================
-- candidate_profiles — właściciel (pełny dostęp); publiczny odczyt gdy is_searchable=true
-- (opt-in kandydata = "visible"); pracodawca widzi profil powiązanego kandydata.
-- =============================================================================
drop policy if exists candidate_profiles_select_own on public.candidate_profiles;
create policy candidate_profiles_select_own on public.candidate_profiles
  for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists candidate_profiles_select_public on public.candidate_profiles;
create policy candidate_profiles_select_public on public.candidate_profiles
  for select to anon, authenticated
  using (is_searchable = true and deleted_at is null);

drop policy if exists candidate_profiles_select_company on public.candidate_profiles;
create policy candidate_profiles_select_company on public.candidate_profiles
  for select to authenticated
  using (public.company_can_view_candidate(profile_id));

drop policy if exists candidate_profiles_insert_own on public.candidate_profiles;
create policy candidate_profiles_insert_own on public.candidate_profiles
  for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists candidate_profiles_update_own on public.candidate_profiles;
create policy candidate_profiles_update_own on public.candidate_profiles
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists candidate_profiles_delete_own on public.candidate_profiles;
create policy candidate_profiles_delete_own on public.candidate_profiles
  for delete to authenticated
  using (profile_id = auth.uid());

-- =============================================================================
-- candidate_skills / candidate_languages / candidate_certificates —
-- odczyt: właściciel LUB publiczny (gdy profil searchable) LUB pracodawca z relacją.
-- zapis: tylko właściciel profilu.
-- Wspólny wzorzec generowany w pętli (te same kolumny: candidate_profile_id).
-- =============================================================================
do $$
declare
  t text;
  child text[] := array['candidate_skills', 'candidate_languages', 'candidate_certificates'];
begin
  foreach t in array child loop
    -- SELECT
    execute format('drop policy if exists %I on public.%I;', t || '_select', t);
    execute format($f$
      create policy %I on public.%I
        for select to anon, authenticated
        using (
          public.owns_candidate_profile(candidate_profile_id)
          or public.candidate_profile_is_searchable(candidate_profile_id)
          or public.company_can_view_candidate(
               (select cp.profile_id from public.candidate_profiles cp
                 where cp.id = candidate_profile_id)
             )
        );
    $f$, t || '_select', t);

    -- INSERT (właściciel)
    execute format('drop policy if exists %I on public.%I;', t || '_insert_own', t);
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (public.owns_candidate_profile(candidate_profile_id));
    $f$, t || '_insert_own', t);

    -- UPDATE (właściciel)
    execute format('drop policy if exists %I on public.%I;', t || '_update_own', t);
    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (public.owns_candidate_profile(candidate_profile_id))
        with check (public.owns_candidate_profile(candidate_profile_id));
    $f$, t || '_update_own', t);

    -- DELETE (właściciel)
    execute format('drop policy if exists %I on public.%I;', t || '_delete_own', t);
    execute format($f$
      create policy %I on public.%I
        for delete to authenticated
        using (public.owns_candidate_profile(candidate_profile_id));
    $f$, t || '_delete_own', t);
  end loop;
end $$;

-- =============================================================================
-- saved_jobs — właściciel (kandydat). candidate_id = profiles(id) = auth.uid().
-- =============================================================================
drop policy if exists saved_jobs_select_own on public.saved_jobs;
create policy saved_jobs_select_own on public.saved_jobs
  for select to authenticated
  using (candidate_id = auth.uid());

drop policy if exists saved_jobs_insert_own on public.saved_jobs;
create policy saved_jobs_insert_own on public.saved_jobs
  for insert to authenticated
  with check (candidate_id = auth.uid());

drop policy if exists saved_jobs_delete_own on public.saved_jobs;
create policy saved_jobs_delete_own on public.saved_jobs
  for delete to authenticated
  using (candidate_id = auth.uid());

-- =============================================================================
-- companies — publiczny odczyt firm zweryfikowanych; członkowie widzą swoją firmę
-- (dowolny status); firma A nie widzi firmy B. Tworzenie: dowolny zalogowany.
-- Edycja: członek firmy. Kolumny "podstawowe" filtruje aplikacja (SELECT pól/widok).
-- =============================================================================
drop policy if exists companies_select_public on public.companies;
create policy companies_select_public on public.companies
  for select to anon, authenticated
  using (status = 'verified' and deleted_at is null);

drop policy if exists companies_select_member on public.companies;
create policy companies_select_member on public.companies
  for select to authenticated
  using (public.is_company_member(id));

drop policy if exists companies_insert_authenticated on public.companies;
create policy companies_insert_authenticated on public.companies
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists companies_update_member on public.companies;
create policy companies_update_member on public.companies
  for update to authenticated
  using (public.is_company_member(id))
  with check (public.is_company_member(id));

-- =============================================================================
-- company_members — tylko członkowie danej firmy. Bootstrap: pierwszy członek
-- może dodać siebie (profile_id = auth.uid()); kolejnych dodaje owner/admin.
-- =============================================================================
drop policy if exists company_members_select on public.company_members;
create policy company_members_select on public.company_members
  for select to authenticated
  using (profile_id = auth.uid() or public.is_company_member(company_id));

drop policy if exists company_members_insert on public.company_members;
create policy company_members_insert on public.company_members
  for insert to authenticated
  with check (profile_id = auth.uid() or public.is_company_admin(company_id));

drop policy if exists company_members_update_admin on public.company_members;
create policy company_members_update_admin on public.company_members
  for update to authenticated
  using (public.is_company_admin(company_id))
  with check (public.is_company_admin(company_id));

drop policy if exists company_members_delete on public.company_members;
create policy company_members_delete on public.company_members
  for delete to authenticated
  using (profile_id = auth.uid() or public.is_company_admin(company_id));

-- =============================================================================
-- employer_profiles — właściciel (pełny dostęp); współpracownicy z tej samej firmy
-- (primary_company_id) mogą odczytać.
-- =============================================================================
drop policy if exists employer_profiles_select_own on public.employer_profiles;
create policy employer_profiles_select_own on public.employer_profiles
  for select to authenticated
  using (
    profile_id = auth.uid()
    or (primary_company_id is not null and public.is_company_member(primary_company_id))
  );

drop policy if exists employer_profiles_insert_own on public.employer_profiles;
create policy employer_profiles_insert_own on public.employer_profiles
  for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists employer_profiles_update_own on public.employer_profiles;
create policy employer_profiles_update_own on public.employer_profiles
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists employer_profiles_delete_own on public.employer_profiles;
create policy employer_profiles_delete_own on public.employer_profiles
  for delete to authenticated
  using (profile_id = auth.uid());

-- =============================================================================
-- jobs — publiczny SELECT gdy status='active'; członkowie firmy widzą swoje oferty
-- (dowolny status). INSERT/UPDATE: członek firmy właściciela; publikacja (status='active')
-- wymaga zweryfikowanej firmy (company_is_verified).
-- =============================================================================
drop policy if exists jobs_select_public on public.jobs;
create policy jobs_select_public on public.jobs
  for select to anon, authenticated
  using (status = 'active' and deleted_at is null);

drop policy if exists jobs_select_member on public.jobs;
create policy jobs_select_member on public.jobs
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists jobs_insert_member on public.jobs;
create policy jobs_insert_member on public.jobs
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (status <> 'active' or public.company_is_verified(company_id))
  );

drop policy if exists jobs_update_member on public.jobs;
create policy jobs_update_member on public.jobs
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (
    public.is_company_member(company_id)
    and (status <> 'active' or public.company_is_verified(company_id))
  );

drop policy if exists jobs_delete_member on public.jobs;
create policy jobs_delete_member on public.jobs
  for delete to authenticated
  using (public.is_company_member(company_id));

-- =============================================================================
-- job_translations / job_requirements / job_skills — treść oferty.
-- Odczyt: gdy oferta publiczna LUB członek firmy oferty. Zapis: członek firmy oferty.
-- =============================================================================
do $$
declare
  t text;
  child text[] := array['job_translations', 'job_requirements', 'job_skills'];
begin
  foreach t in array child loop
    execute format('drop policy if exists %I on public.%I;', t || '_select', t);
    execute format($f$
      create policy %I on public.%I
        for select to anon, authenticated
        using (public.job_is_public(job_id) or public.is_job_company_member(job_id));
    $f$, t || '_select', t);

    execute format('drop policy if exists %I on public.%I;', t || '_insert_member', t);
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (public.is_job_company_member(job_id));
    $f$, t || '_insert_member', t);

    execute format('drop policy if exists %I on public.%I;', t || '_update_member', t);
    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (public.is_job_company_member(job_id))
        with check (public.is_job_company_member(job_id));
    $f$, t || '_update_member', t);

    execute format('drop policy if exists %I on public.%I;', t || '_delete_member', t);
    execute format($f$
      create policy %I on public.%I
        for delete to authenticated
        using (public.is_job_company_member(job_id));
    $f$, t || '_delete_member', t);
  end loop;
end $$;

-- =============================================================================
-- applications — kandydat widzi/edytuje swoje; firma widzi/edytuje aplikacje na swoje
-- oferty. INSERT: kandydat na aktywną ofertę (job_is_public) — egzekwuje JOB_NOT_ACTIVE.
-- =============================================================================
drop policy if exists applications_select on public.applications;
create policy applications_select on public.applications
  for select to authenticated
  using (candidate_id = auth.uid() or public.is_job_company_member(job_id));

drop policy if exists applications_insert_candidate on public.applications;
create policy applications_insert_candidate on public.applications
  for insert to authenticated
  with check (candidate_id = auth.uid() and public.job_is_public(job_id));

drop policy if exists applications_update on public.applications;
create policy applications_update on public.applications
  for update to authenticated
  using (candidate_id = auth.uid() or public.is_job_company_member(job_id))
  with check (candidate_id = auth.uid() or public.is_job_company_member(job_id));

drop policy if exists applications_delete_candidate on public.applications;
create policy applications_delete_candidate on public.applications
  for delete to authenticated
  using (candidate_id = auth.uid());

-- =============================================================================
-- application_status_history — historia (append-only). Odczyt/zapis: strony aplikacji.
-- =============================================================================
drop policy if exists application_status_history_select on public.application_status_history;
create policy application_status_history_select on public.application_status_history
  for select to authenticated
  using (public.can_access_application(application_id));

drop policy if exists application_status_history_insert on public.application_status_history;
create policy application_status_history_insert on public.application_status_history
  for insert to authenticated
  with check (public.can_access_application(application_id));

-- =============================================================================
-- matches — cache scoreMatch. Odczyt: kandydat (swoje) lub firma (dla swojej oferty).
-- Zapis: właściciel-kandydat (typowo liczone przez backend/service_role).
-- =============================================================================
drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches
  for select to authenticated
  using (candidate_id = auth.uid() or public.is_job_company_member(job_id));

drop policy if exists matches_insert_own on public.matches;
create policy matches_insert_own on public.matches
  for insert to authenticated
  with check (candidate_id = auth.uid());

drop policy if exists matches_update_own on public.matches;
create policy matches_update_own on public.matches
  for update to authenticated
  using (candidate_id = auth.uid())
  with check (candidate_id = auth.uid());

-- =============================================================================
-- offers — kandydat-odbiorca widzi swoje; firma-nadawca widzi swoje.
-- INSERT/DELETE: firma (przez ofertę). UPDATE: kandydat (odpowiedź) lub firma.
-- =============================================================================
drop policy if exists offers_select on public.offers;
create policy offers_select on public.offers
  for select to authenticated
  using (
    candidate_id = auth.uid()
    or public.is_job_company_member(job_id)
    or public.is_company_member(company_id)
  );

drop policy if exists offers_insert_company on public.offers;
create policy offers_insert_company on public.offers
  for insert to authenticated
  with check (public.is_job_company_member(job_id));

drop policy if exists offers_update on public.offers;
create policy offers_update on public.offers
  for update to authenticated
  using (candidate_id = auth.uid() or public.is_job_company_member(job_id))
  with check (candidate_id = auth.uid() or public.is_job_company_member(job_id));

drop policy if exists offers_delete_company on public.offers;
create policy offers_delete_company on public.offers
  for delete to authenticated
  using (public.is_job_company_member(job_id));

-- =============================================================================
-- offer_status_history — historia (append-only). Odczyt/zapis: strony propozycji.
-- =============================================================================
drop policy if exists offer_status_history_select on public.offer_status_history;
create policy offer_status_history_select on public.offer_status_history
  for select to authenticated
  using (public.can_access_offer(offer_id));

drop policy if exists offer_status_history_insert on public.offer_status_history;
create policy offer_status_history_insert on public.offer_status_history
  for insert to authenticated
  with check (public.can_access_offer(offer_id));

-- =============================================================================
-- conversations / conversation_members / messages — tylko uczestnicy konwersacji.
-- =============================================================================
drop policy if exists conversations_select_member on public.conversations;
create policy conversations_select_member on public.conversations
  for select to authenticated
  using (public.is_conversation_member(id));

drop policy if exists conversations_insert_creator on public.conversations;
create policy conversations_insert_creator on public.conversations
  for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists conversations_update_member on public.conversations;
create policy conversations_update_member on public.conversations
  for update to authenticated
  using (public.is_conversation_member(id))
  with check (public.is_conversation_member(id));

drop policy if exists conversation_members_select on public.conversation_members;
create policy conversation_members_select on public.conversation_members
  for select to authenticated
  using (profile_id = auth.uid() or public.is_conversation_member(conversation_id));

drop policy if exists conversation_members_insert on public.conversation_members;
create policy conversation_members_insert on public.conversation_members
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    or public.conversation_created_by_me(conversation_id)
    or public.is_conversation_member(conversation_id)
  );

drop policy if exists conversation_members_update_own on public.conversation_members;
create policy conversation_members_update_own on public.conversation_members
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists conversation_members_delete_own on public.conversation_members;
create policy conversation_members_delete_own on public.conversation_members
  for delete to authenticated
  using (profile_id = auth.uid() or public.conversation_created_by_me(conversation_id));

drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages
  for select to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists messages_insert_member on public.messages;
create policy messages_insert_member on public.messages
  for insert to authenticated
  with check (public.is_conversation_member(conversation_id) and sender_id = auth.uid());

drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
  for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages
  for delete to authenticated
  using (sender_id = auth.uid());

-- =============================================================================
-- notifications — właściciel. Tworzenie: service_role (system/triggery) — brak INSERT dla klienta.
-- =============================================================================
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete to authenticated
  using (profile_id = auth.uid());

-- =============================================================================
-- notification_preferences — właściciel (pełny dostęp).
-- =============================================================================
drop policy if exists notification_preferences_select_own on public.notification_preferences;
create policy notification_preferences_select_own on public.notification_preferences
  for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists notification_preferences_insert_own on public.notification_preferences;
create policy notification_preferences_insert_own on public.notification_preferences
  for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists notification_preferences_update_own on public.notification_preferences;
create policy notification_preferences_update_own on public.notification_preferences
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- =============================================================================
-- consents — właściciel; zapis dozwolony też anonimowo (profile_id null = zgoda sesji
-- przed logowaniem). Rekordy zgód są append-only (bez UPDATE/DELETE dla klienta).
-- =============================================================================
drop policy if exists consents_select_own on public.consents;
create policy consents_select_own on public.consents
  for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists consents_insert on public.consents;
create policy consents_insert on public.consents
  for insert to anon, authenticated
  with check (profile_id is null or profile_id = auth.uid());

-- =============================================================================
-- files — właściciel (pełny dostęp); pliki publiczne (visibility='public') odczytywalne.
-- =============================================================================
drop policy if exists files_select on public.files;
create policy files_select on public.files
  for select to anon, authenticated
  using (owner_id = auth.uid() or visibility = 'public');

drop policy if exists files_insert_own on public.files;
create policy files_insert_own on public.files
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists files_update_own on public.files;
create policy files_update_own on public.files
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists files_delete_own on public.files;
create policy files_delete_own on public.files
  for delete to authenticated
  using (owner_id = auth.uid());

-- =============================================================================
-- reports — zgłaszający tworzy i widzi swoje zgłoszenia; moderacja przez service_role.
-- =============================================================================
drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter_id = auth.uid());

drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

-- =============================================================================
-- subscriptions / invoices / payments — billing firmy: odczyt dla owner/admin firmy.
-- Zapis przez service_role (webhooki dostawcy płatności).
-- =============================================================================
drop policy if exists subscriptions_select_admin on public.subscriptions;
create policy subscriptions_select_admin on public.subscriptions
  for select to authenticated
  using (public.is_company_admin(company_id));

drop policy if exists invoices_select_admin on public.invoices;
create policy invoices_select_admin on public.invoices
  for select to authenticated
  using (public.is_company_admin(company_id));

drop policy if exists payments_select_admin on public.payments;
create policy payments_select_admin on public.payments
  for select to authenticated
  using (public.is_company_admin(company_id));

-- =============================================================================
-- Tabele wyłącznie serwisowe (RLS włączone, BEZ polityk => deny dla anon/authenticated,
-- service_role omija RLS): audit_logs, system_events, email_deliveries, discount_codes.
-- Polityk celowo nie dodajemy.
-- =============================================================================
