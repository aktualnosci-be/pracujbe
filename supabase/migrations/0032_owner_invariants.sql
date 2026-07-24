-- =============================================================================
-- 0032_owner_invariants.sql
-- Remediacja audytu 2026-07-24 — Wave C1: SEC-10 (ochrona właściciela firmy).
--
-- Problem: owner/admin mógł aktualizować/usuwać członkostwa bez zasad — admin mógł awansować
--   siebie na ownera (przejęcie firmy), a ostatni owner mógł zostać zdemotowany/usunięty
--   (firma bez podmiotu zarządzającego). Brak było też zasady „min. jeden aktywny owner".
--
-- Naprawa (trigger enforce_owner_invariants na company_members):
--   * rolę `owner` NADAJE/ODBIERA wyłącznie istniejący aktywny owner firmy,
--   * nie można zdemotować/dezaktywować/usunąć OSTATNIEGO aktywnego ownera,
--   * bootstrap (create_company_with_owner, definer=postgres), seed i admin przechodzą.
-- Transfer własności = owner awansuje innego członka do owner, potem (opcjonalnie) sam schodzi.
-- =============================================================================

-- Czy bieżący użytkownik jest AKTYWNYM właścicielem firmy.
create or replace function public.is_company_owner(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members cm
    where cm.company_id = p_company_id
      and cm.profile_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'owner'
  );
$$;

-- Liczba aktywnych ownerów firmy z pominięciem wskazanego wiersza (do sprawdzeń „ostatni owner").
create or replace function public.count_other_active_owners(p_company_id uuid, p_exclude_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.company_members cm
  where cm.company_id = p_company_id and cm.role = 'owner' and cm.is_active = true
    and cm.id <> p_exclude_id;
$$;

create or replace function public.enforce_owner_invariants()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Zaufane role (bootstrap definer=postgres, admin=service_role, seed) — pomijamy.
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'owner' and not public.is_company_owner(new.company_id) then
      raise exception 'PERMISSION_DENIED: rolę owner nadaje wyłącznie właściciel firmy'
        using errcode = '42501';
    end if;
    return new;

  elsif tg_op = 'UPDATE' then
    -- Nadanie lub odebranie roli owner tylko przez aktywnego ownera.
    if (new.role = 'owner') is distinct from (old.role = 'owner') then
      if not public.is_company_owner(new.company_id) then
        raise exception 'PERMISSION_DENIED: zmianę roli owner wykonuje wyłącznie właściciel firmy'
          using errcode = '42501';
      end if;
    end if;
    -- Nie pozostaw firmy bez aktywnego ownera (demote lub dezaktywacja ostatniego).
    if (old.role = 'owner' and old.is_active)
       and (new.role <> 'owner' or new.is_active = false) then
      if public.count_other_active_owners(old.company_id, old.id) = 0 then
        raise exception 'VALIDATION_FAILED: firma musi mieć co najmniej jednego aktywnego właściciela'
          using errcode = '42501';
      end if;
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    if old.role = 'owner' and old.is_active then
      if public.count_other_active_owners(old.company_id, old.id) = 0 then
        raise exception 'VALIDATION_FAILED: nie można usunąć ostatniego aktywnego właściciela firmy'
          using errcode = '42501';
      end if;
    end if;
    return old;
  end if;
  return new;
end $$;

drop trigger if exists trg_enforce_owner_invariants on public.company_members;
create trigger trg_enforce_owner_invariants
  before insert or update or delete on public.company_members
  for each row execute function public.enforce_owner_invariants();
