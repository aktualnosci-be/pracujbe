-- =============================================================================
-- 0011_security_hardening.sql
-- Domknięcie ustaleń audytu bezpieczeństwa (2026-07-23): P0-01..04, P1-02/06/07/14.
--
-- Zasada: klient (anon/authenticated) NIE może bezpośrednio mutować rekordów
-- domenowych ani kolumn uprzywilejowanych przez REST Supabase. Tożsamość i
-- powiązania wyliczane są po stronie bazy (triggery), historia i weryfikacja
-- tylko przez backend (service_role omija RLS) lub kontrolowane RPC/triggery.
--
-- Triggery używają auth.uid(): dla żądań z JWT użytkownika zwraca jego UUID,
-- dla backendu (service_role, brak JWT) zwraca NULL — dzięki temu operacje
-- serwerowe pozostają dozwolone, a samoobsługowe nadużycia są blokowane.
-- =============================================================================

-- =============================================================================
-- P1-02 — ochrona uprzywilejowanych kolumn profiles (blokada eskalacji roli)
-- =============================================================================
create or replace function public.protect_profiles_privileged()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
       or new.deleted_at is distinct from old.deleted_at
       or new.signup_locale is distinct from old.signup_locale then
      raise exception 'PERMISSION_DENIED: nie można zmienić uprzywilejowanych kolumn profilu'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_profiles on public.profiles;
create trigger trg_protect_profiles
  before update on public.profiles
  for each row execute function public.protect_profiles_privileged();

-- =============================================================================
-- P0-02 — profile kandydata prywatne domyślnie (opt-in publikacja)
-- =============================================================================
alter table public.candidate_profiles alter column is_searchable set default false;

-- Istniejące niekompletne profile nie mogą być publiczne.
update public.candidate_profiles
  set is_searchable = false
  where profile_completed = false;

-- Publiczny odczyt tylko dla świadomie opublikowanego, ukończonego profilu.
drop policy if exists candidate_profiles_select_public on public.candidate_profiles;
create policy candidate_profiles_select_public on public.candidate_profiles
  for select to anon, authenticated
  using (is_searchable = true and profile_completed = true and deleted_at is null);

-- =============================================================================
-- P0-01 — firmy: brak samodzielnego dołączania + ochrona weryfikacji/statusu
-- =============================================================================
-- Tworzenie firmy tylko przez RPC (poniżej). Zdejmujemy otwarty INSERT klienta.
drop policy if exists companies_insert_authenticated on public.companies;

-- Dodawanie członków tylko przez admina firmy (bootstrap idzie przez RPC).
drop policy if exists company_members_insert on public.company_members;
create policy company_members_insert on public.company_members
  for insert to authenticated
  with check (public.is_company_admin(company_id));

-- Status/weryfikacja firmy nietykalne dla zwykłego użytkownika (tylko backend/admin).
create or replace function public.protect_company_verification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if new.status is distinct from old.status
       or new.verified_at is distinct from old.verified_at
       or new.verified_by is distinct from old.verified_by then
      raise exception 'PERMISSION_DENIED: status/weryfikacja firmy tylko przez backend/admina'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_company on public.companies;
create trigger trg_protect_company
  before update on public.companies
  for each row execute function public.protect_company_verification();

-- Bootstrap firmy: tworzy firmę (status wymuszony 'unverified') + właściciela atomowo.
create or replace function public.create_company_with_owner(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  insert into public.companies (name, slug, status)
    values (p_name, p_slug, 'unverified')
    returning id into v_id;
  insert into public.company_members (company_id, profile_id, role, is_active)
    values (v_id, auth.uid(), 'owner', true);
  return v_id;
end $$;

revoke all on function public.create_company_with_owner(text, text) from public;
grant execute on function public.create_company_with_owner(text, text) to authenticated;

-- =============================================================================
-- P0-03 / P1-06 — aplikacje: niezmienne powiązania, kontrolowany status, auto-historia
-- =============================================================================
create or replace function public.enforce_application_integrity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.candidate_id := auth.uid();                                   -- kandydat = zalogowany
      new.company_id := (select company_id from public.jobs where id = new.job_id);
      new.match_score := null;                                          -- score liczy backend
      if new.status is null or new.status not in ('draft', 'submitted') then
        new.status := 'submitted';                                      -- klient nie ustawia 'hired' itp.
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if auth.uid() is not null then
      if new.candidate_id is distinct from old.candidate_id
         or new.job_id is distinct from old.job_id
         or new.company_id is distinct from old.company_id then
        raise exception 'PERMISSION_DENIED: nie można zmienić powiązań aplikacji'
          using errcode = '42501';
      end if;
      -- Kandydat (właściciel) może jedynie wycofać aplikację.
      if new.candidate_id = auth.uid()
         and new.status is distinct from old.status
         and new.status <> 'withdrawn' then
        raise exception 'PERMISSION_DENIED: kandydat może jedynie wycofać aplikację'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_application_integrity on public.applications;
create trigger trg_application_integrity
  before insert or update on public.applications
  for each row execute function public.enforce_application_integrity();

-- Auto-historia zmian statusu (spójny ślad audytowy w tej samej transakcji).
create or replace function public.log_application_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.application_status_history (application_id, from_status, to_status, changed_by)
      values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_log_application_status on public.applications;
create trigger trg_log_application_status
  after update on public.applications
  for each row execute function public.log_application_status();

-- Klient nie może ręcznie fabrykować historii (tworzy ją trigger/service_role).
drop policy if exists application_status_history_insert on public.application_status_history;

-- =============================================================================
-- P0-04 / P1-06 — propozycje: autoryzacja nadawcy, verified+active, niezmienne pola, auto-historia
-- =============================================================================
create or replace function public.enforce_offer_integrity()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_company_status text; v_job_status text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      select j.company_id, c.status::text, j.status::text
        into v_company, v_company_status, v_job_status
        from public.jobs j join public.companies c on c.id = j.company_id
        where j.id = new.job_id;
      if v_company is null then
        raise exception 'JOB_NOT_ACTIVE: oferta nie istnieje' using errcode = '42501';
      end if;
      if not public.is_company_member(v_company) then
        raise exception 'PERMISSION_DENIED: brak członkostwa w firmie oferty' using errcode = '42501';
      end if;
      if v_company_status <> 'verified' then
        raise exception 'COMPANY_NOT_VERIFIED' using errcode = '42501';
      end if;
      if v_job_status <> 'active' then
        raise exception 'JOB_NOT_ACTIVE' using errcode = '42501';
      end if;
      new.company_id := v_company;                 -- wyliczone z oferty
      new.sender_id := auth.uid();                 -- nadawca = zalogowany
      if new.status is null or new.status not in ('draft', 'sent') then
        new.status := 'sent';
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if auth.uid() is not null then
      if new.job_id is distinct from old.job_id
         or new.candidate_id is distinct from old.candidate_id
         or new.company_id is distinct from old.company_id
         or new.sender_id is distinct from old.sender_id then
        raise exception 'PERMISSION_DENIED: nie można zmienić powiązań propozycji'
          using errcode = '42501';
      end if;
      -- Kandydat (odbiorca) może jedynie zaakceptować/odrzucić.
      if new.candidate_id = auth.uid()
         and new.status is distinct from old.status
         and new.status not in ('accepted', 'declined') then
        raise exception 'PERMISSION_DENIED: kandydat może jedynie zaakceptować/odrzucić propozycję'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_offer_integrity on public.offers;
create trigger trg_offer_integrity
  before insert or update on public.offers
  for each row execute function public.enforce_offer_integrity();

create or replace function public.log_offer_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.offer_status_history (offer_id, from_status, to_status, changed_by)
      values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_log_offer_status on public.offers;
create trigger trg_log_offer_status
  after update on public.offers
  for each row execute function public.log_offer_status();

drop policy if exists offer_status_history_insert on public.offer_status_history;

-- =============================================================================
-- P1-07 — matches: cache liczy wyłącznie backend (klient tylko odczyt swoich)
-- =============================================================================
drop policy if exists matches_insert_own on public.matches;
drop policy if exists matches_update_own on public.matches;

-- =============================================================================
-- P1-14 — rozmowy: brak wstrzykiwania dowolnych uczestników
-- (członkiem może zostać tylko sam użytkownik; kontekstowe dodawanie stron
--  realizuje przyszła RPC get_or_create_conversation z walidacją relacji)
-- =============================================================================
drop policy if exists conversation_members_insert on public.conversation_members;
create policy conversation_members_insert on public.conversation_members
  for insert to authenticated
  with check (profile_id = auth.uid());
