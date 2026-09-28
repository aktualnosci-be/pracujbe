-- =============================================================================
-- 0165 — kolumny tożsamości członkostwa firmy niezmienne poza RPC
--        + dostęp do rozmów firmy tylko dla bieżących członków albo kandydata relacji.
--
-- 1. `enforce_owner_invariants` (ostatnia definicja: 0086) przy UPDATE sprawdzał tylko
--    zmianę `role`/`is_active`. Pozostałe kolumny wiersza (firma, konto, dane zaproszenia,
--    daty) mogła zmienić każda rola klienta, której polityka `company_members_update_admin`
--    (0009) przepuszcza UPDATE. Teraz dla ról klienta (poza zaufanymi: postgres,
--    service_role, supabase_admin — definer RPC i seed) zmiana którejkolwiek z kolumn
--    `id`, `company_id`, `profile_id`, `invited_by`, `invited_at`, `joined_at`,
--    `created_at` = PERMISSION_DENIED. Zmiana roli i aktywności działa jak w 0086
--    (hierarchia + ostatni aktywny owner). RPC `set_company_member_role`,
--    `set_company_member_active`, `respond_to_company_invitation` (SECURITY DEFINER)
--    — bez zmian.
--
-- 2. `is_conversation_member` (ostatnia definicja: 0039) traktował jako „stronę kandydata”
--    każde konto BEZ wiersza w `company_members` tej firmy — także konto, którego
--    członkostwo usunięto (DELETE), a wiersz `conversation_members` został. Strona
--    niefirmowa to teraz wyłącznie kandydat relacji rozmowy
--    (`conversation_candidate(application_id, offer_id)`, 0078). Rozmowy zakłada tylko
--    `get_or_create_conversation` (0016/0025) z dokładnie jedną relacją, więc kandydat
--    rozmowy zawsze ma ten dostęp; strona firmowa — jak w 0039 (aktywny recruiter+).
--
-- Rollback: odtworzyć `enforce_owner_invariants` z 0086 i `is_conversation_member` z 0039.
-- Migracja nie zmienia danych.
-- =============================================================================

create or replace function public.enforce_owner_invariants()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Zaufane role (bootstrap/RPC definer=postgres, admin=service_role, seed) — pomijamy.
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'owner' and not public.is_company_owner(new.company_id) then
      raise exception 'PERMISSION_DENIED: rolę owner nadaje wyłącznie właściciel firmy'
        using errcode = '42501';
    end if;
    if not public.can_manage_company_role(new.company_id, new.role) then
      raise exception 'PERMISSION_DENIED: brak uprawnień do tej roli' using errcode = '42501';
    end if;
    return new;

  elsif tg_op = 'UPDATE' then
    -- 0165: tożsamość wiersza (firma, konto, zaproszenie, daty) tylko przez RPC.
    if new.id is distinct from old.id
       or new.company_id is distinct from old.company_id
       or new.profile_id is distinct from old.profile_id
       or new.invited_by is distinct from old.invited_by
       or new.invited_at is distinct from old.invited_at
       or new.joined_at is distinct from old.joined_at
       or new.created_at is distinct from old.created_at then
      raise exception 'PERMISSION_DENIED: kolumny tożsamości członkostwa są niezmienne'
        using errcode = '42501';
    end if;
    -- Nadanie lub odebranie roli owner tylko przez aktywnego ownera.
    if (new.role = 'owner') is distinct from (old.role = 'owner') then
      if not public.is_company_owner(new.company_id) then
        raise exception 'PERMISSION_DENIED: zmianę roli owner wykonuje wyłącznie właściciel firmy'
          using errcode = '42501';
      end if;
    end if;
    -- #403: zmiana roli/aktywności wymaga uprawnień do starej i nowej roli.
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      if not public.can_manage_company_role(old.company_id, old.role)
         or not public.can_manage_company_role(old.company_id, new.role) then
        raise exception 'PERMISSION_DENIED: brak uprawnień do tej roli' using errcode = '42501';
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
    -- Usunięcie cudzego członkostwa tylko w granicach hierarchii (własne = opuszczenie firmy).
    if old.profile_id is distinct from auth.uid()
       and not public.can_manage_company_role(old.company_id, old.role) then
      raise exception 'PERMISSION_DENIED: brak uprawnień do tej roli' using errcode = '42501';
    end if;
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

-- Dostęp do rozmowy: rozmowa bez firmy, strona firmowa = aktywny recruiter+ (0039),
-- strona niefirmowa = wyłącznie kandydat relacji rozmowy (aplikacja albo propozycja).
create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
    where m.conversation_id = p_conversation_id
      and m.profile_id = auth.uid()
      and (
        c.company_id is null
        or public.can_manage_jobs(c.company_id)
        or m.profile_id = public.conversation_candidate(c.application_id, c.offer_id)
      )
  );
$$;
