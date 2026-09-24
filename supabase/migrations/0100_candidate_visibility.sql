-- =============================================================================
-- 0100_candidate_visibility.sql — świadome włączenie i wyłączenie widoczności profilu
-- kandydata dla firm (#494).
--
-- Budujemy na 0029 (`set_candidate_searchable`, guard flag) i 0078 (blokady firm), bez
-- nowej ścieżki zapisu:
--   1. `candidate_profiles.searchable_changed_at` — znacznik czasu ostatniej REALNEJ zmiany
--      widoczności (NULL = kandydat nigdy jej nie włączał). Chroniony tym samym guardem co
--      `is_searchable` (klient nie ustawia go bezpośrednio).
--   2. `candidate_visibility_events` — historia zmian (kandydat × wartość × czas). Zapis
--      wyłącznie przez RPC; odczyt tylko własnych wierszy. Firma nie ma żadnej ścieżki
--      odczytu (nie dowiaduje się o wyłączeniu).
--   3. `set_candidate_searchable(boolean)` — ta sama sygnatura; teraz blokuje wiersz
--      (FOR UPDATE), zapisuje znacznik i zdarzenie TYLKO przy realnej zmianie (ponowienie =
--      bez duplikatu w historii). `true` nadal tylko dla ukończonego profilu; `false` zawsze.
--   4. `matches_select` — firma widzi wiersz dopasowania tylko wtedy, gdy widzi kandydata:
--      wyszukiwalny ukończony profil (dla zweryfikowanej firmy, bez blokady) ALBO relacja
--      z `company_can_view_candidate` (aplikacja/propozycja do firmy wywołującego, bez
--      blokady). Wcześniej sam `is_job_manager` wystarczał, więc po wyłączeniu widoczności
--      firma nadal czytała wynik dopasowania po znanym ID kandydata.
--
-- Zakres widoczności po włączeniu (bez zmian w tej migracji, udokumentowany dla #494):
--   * `candidate_profiles` (polityka `candidate_profiles_select_employer`, 0078): dane
--     zawodowe profilu — nagłówek, opis, miasto/region/promień, prawo jazdy/samochód,
--     doświadczenie, dostępność, zawody, kategorie, rodzaje umów, oczekiwana stawka.
--     Profil nie ma kolumn kontaktowych ani pliku CV.
--   * relacje profilu (`candidate_skills/languages/certificates`) — przez
--     `candidate_profile_is_searchable` (0078).
--   * `profiles` (imię, nazwisko, e-mail, telefon) — NIE: polityka
--     `profiles_select_company_candidate` wymaga relacji z `company_can_view_candidate`.
--   * pliki CV — NIE: dostęp do plików nie zależy od `is_searchable`.
-- Wyłączenie zatrzymuje wyszukiwanie i nowe dopasowania firm od razu (RLS czyta flagę przy
-- każdym zapytaniu). Relacja z aplikacji/propozycji (`company_can_view_candidate`, 0078)
-- pozostaje — firma, do której kandydat sam aplikował albo która już wysłała propozycję,
-- nadal widzi profil w tym procesie, dopóki kandydat jej nie zablokuje (0078).
--
-- Rollback: przywrócić `matches_select` z 0078, `set_candidate_searchable` i
-- `guard_candidate_completeness` z 0029; `drop table public.candidate_visibility_events;`
-- `alter table public.candidate_profiles drop column searchable_changed_at;`.
-- =============================================================================

alter table public.candidate_profiles
  add column if not exists searchable_changed_at timestamptz;

-- --- Historia zmian ------------------------------------------------------------------
create table if not exists public.candidate_visibility_events (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.profiles(id) on delete cascade,
  searchable   boolean not null,
  created_at   timestamptz not null default now()
);
create index if not exists candidate_visibility_events_candidate_idx
  on public.candidate_visibility_events (candidate_id, created_at desc);

alter table public.candidate_visibility_events enable row level security;
alter table public.candidate_visibility_events force row level security;

revoke all on public.candidate_visibility_events from public, anon, authenticated;
grant select on public.candidate_visibility_events to authenticated;

drop policy if exists candidate_visibility_events_select_own on public.candidate_visibility_events;
create policy candidate_visibility_events_select_own on public.candidate_visibility_events
  for select to authenticated
  using (candidate_id = auth.uid());

-- --- Guard: znacznik zmiany ustawia tylko system (rozszerzenie 0029) ------------------
create or replace function public.guard_candidate_completeness()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.profile_completed := false;
    new.is_searchable := false;
    new.searchable_changed_at := null;
    return new;
  end if;
  if new.profile_completed is distinct from old.profile_completed
     or new.is_searchable is distinct from old.is_searchable
     or new.searchable_changed_at is distinct from old.searchable_changed_at then
    raise exception 'PERMISSION_DENIED: flagi kompletności ustawia wyłącznie system'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- --- Opt-in / opt-out ------------------------------------------------------------------
create or replace function public.set_candidate_searchable(p_searchable boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_target boolean := coalesce(p_searchable, false);
  v_completed boolean;
  v_current boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  perform public.ensure_candidate_profile();

  select profile_completed, is_searchable into v_completed, v_current
    from public.candidate_profiles where profile_id = auth.uid()
    for update;

  if v_target and not coalesce(v_completed, false) then
    raise exception 'VALIDATION_FAILED: profil musi być kompletny, aby był wyszukiwalny'
      using errcode = '42501';
  end if;

  if v_current is distinct from v_target then
    update public.candidate_profiles
      set is_searchable = v_target, searchable_changed_at = now()
      where profile_id = auth.uid();
    insert into public.candidate_visibility_events (candidate_id, searchable)
      values (auth.uid(), v_target);
  end if;
  return v_target;
end $$;
revoke all on function public.set_candidate_searchable(boolean) from public, anon;
grant execute on function public.set_candidate_searchable(boolean) to authenticated;

-- --- Dopasowania: tylko dla kandydata, którego firma widzi ------------------------------
-- Wewnętrzny helper polityki: wyszukiwalny ukończony profil dla zweryfikowanej firmy
-- wywołującego (bez blokady) albo relacja aplikacja/propozycja (company_can_view_candidate).
create or replace function public.company_can_see_match_candidate(p_candidate uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select (
    exists (
      select 1 from public.candidate_profiles cp
      where cp.profile_id = p_candidate
        and cp.is_searchable = true
        and cp.profile_completed = true
        and cp.deleted_at is null
    )
    and public.current_user_has_verified_company()
    and not public.candidate_blocks_viewer(p_candidate)
  ) or public.company_can_view_candidate(p_candidate);
$$;
revoke all on function public.company_can_see_match_candidate(uuid) from public, anon;
grant execute on function public.company_can_see_match_candidate(uuid) to authenticated;

drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches
  for select to authenticated
  using (
    candidate_id = auth.uid()
    or (public.is_job_manager(job_id)
        and not public.candidate_blocked_job_company(candidate_id, job_id)
        and public.company_can_see_match_candidate(candidate_id))
  );
