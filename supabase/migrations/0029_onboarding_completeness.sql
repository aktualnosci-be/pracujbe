-- =============================================================================
-- 0029_onboarding_completeness.sql
-- Remediacja audytu 2026-07-24 — Wave E1b: kompletność profilu liczona w DB (FUN-05).
--
-- FUN-05 (P1) — krok 6 onboardingu ustawiał `profile_completed=true` bezpośrednim UPDATE,
--   a właściciel miał szeroki UPDATE własnego profilu. Klient mógł oznaczyć profil jako
--   kompletny / `is_searchable=true` BEZ wymaganych danych (wprost przez PostgREST).
--   Naprawa: (1) kompletność wylicza DB z obecności danych, (2) flagi profile_completed/
--   is_searchable może zmienić WYŁĄCZNIE zaufana rola (guard trigger; kolumnowy REVOKE nie
--   działa, gdy rola ma grant UPDATE na całej tabeli), (3) `is_searchable` można włączyć
--   tylko dla kompletnego profilu (świadomy opt-in).
-- =============================================================================

-- --- Guard: flagi kompletności zmienia tylko zaufana rola ----------------------
-- SECURITY INVOKER (świadomie): trigger musi widzieć REALNĄ rolę wywołującego. SECURITY
-- DEFINER RPC (finish_onboarding/set_candidate_searchable) wykonują UPDATE jako właściciel
-- (`postgres`), więc przechodzą; klient (`authenticated`/`anon`) jest gejtowany. Seed/migracje
-- (`postgres`) i admin (`service_role`) też przechodzą.
create or replace function public.guard_candidate_completeness()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- Klient nie może od razu wstawić profilu kompletnego/wyszukiwalnego.
    new.profile_completed := false;
    new.is_searchable := false;
    return new;
  end if;
  -- UPDATE: klient nie może zmienić flag (musi przez finish_onboarding/set_candidate_searchable).
  if new.profile_completed is distinct from old.profile_completed
     or new.is_searchable is distinct from old.is_searchable then
    raise exception 'PERMISSION_DENIED: flagi kompletności ustawia wyłącznie system'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_candidate_completeness on public.candidate_profiles;
create trigger trg_guard_candidate_completeness
  before insert or update on public.candidate_profiles
  for each row execute function public.guard_candidate_completeness();

-- --- Kompletność wyliczana z danych (nie ustawiana przez klienta) --------------
create or replace function public.finish_onboarding()
returns boolean language plpgsql security definer set search_path = public as $$
declare v_complete boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  perform public.ensure_candidate_profile();

  select
    (p.first_name is not null and btrim(p.first_name) <> '')
    and (p.last_name is not null and btrim(p.last_name) <> '')
    and coalesce(array_length(cp.occupations, 1), 0) > 0
    and coalesce(array_length(cp.categories, 1), 0) > 0
    and (cp.city is not null and btrim(cp.city) <> '')
    and cp.availability is not null
  into v_complete
  from public.candidate_profiles cp
  join public.profiles p on p.id = cp.profile_id
  where cp.profile_id = auth.uid();

  update public.candidate_profiles
    set profile_completed = coalesce(v_complete, false)
    where profile_id = auth.uid();
  return coalesce(v_complete, false);
end $$;
revoke all on function public.finish_onboarding() from public;
grant execute on function public.finish_onboarding() to authenticated;

-- --- Świadomy opt-in wyszukiwalności — tylko dla kompletnego profilu ------------
create or replace function public.set_candidate_searchable(p_searchable boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_completed boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  perform public.ensure_candidate_profile();
  select profile_completed into v_completed
    from public.candidate_profiles where profile_id = auth.uid();
  if coalesce(p_searchable, false) and not coalesce(v_completed, false) then
    raise exception 'VALIDATION_FAILED: profil musi być kompletny, aby był wyszukiwalny'
      using errcode = '42501';
  end if;
  update public.candidate_profiles
    set is_searchable = coalesce(p_searchable, false)
    where profile_id = auth.uid();
  return coalesce(p_searchable, false);
end $$;
revoke all on function public.set_candidate_searchable(boolean) from public;
grant execute on function public.set_candidate_searchable(boolean) to authenticated;
