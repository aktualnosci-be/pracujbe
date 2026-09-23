-- =============================================================================
-- 0072 — przepływ weryfikacji firmy po stronie pracodawcy (#365, #368, #400).
--
-- 1. `create_first_company(p_name, p_slug, p_vat_number)` — zakładanie PIERWSZEJ firmy
--    z panelu (pracodawca, któremu nie udał się bootstrap po rejestracji — #365).
--    Jedna transakcja: firma (status wymuszony 'unverified') + numer VAT/KBO + owner
--    (#368 — koniec osobnego UPDATE, którego błąd dawał „czysty" sukces). Idempotentne:
--    blokada wiersza profilu serializuje równoległe kliknięcia; istniejące AKTYWNE
--    członkostwo zwraca tę firmę (`created = false`), a samo nieaktywne (odebrany dostęp)
--    kończy się PERMISSION_DENIED — nie tworzymy firmy zastępczej. Tylko konto 'employer'.
-- 2. `request_company_reverification(p_company_id)` — owner/admin firmy przestawia
--    'rejected' → 'pending' (firma wraca do kolejki admina `awaiting`). Z innych stanów
--    (verified/suspended/unverified/pending) — COMPANY_STATUS_INVALID. Audyt: trigger 0017
--    (company.status_changed) + wpis `company.reverification_requested`. Limit wynika
--    z maszyny stanów: kolejne zgłoszenie możliwe dopiero po ponownym odrzuceniu przez
--    admina; akcja serwerowa dokłada limit per IP.
-- 3. `protect_company_verification` (0019) rozszerzony:
--    - przepuszcza wyłącznie przejście rejected → pending wykonywane przez RPC z pkt 2
--      (znacznik transakcyjny `pracujbe.company_reverify` = id firmy; bez zmiany
--      verified_at/verified_by) — samodzielne ustawienie 'verified' nadal niemożliwe;
--    - zmiana nazwy lub numeru VAT firmy w statusie 'verified' przez nie-admina
--      przywraca status 'pending' i czyści verified_at/verified_by (ponowna weryfikacja
--      w kolejce admina). Admin i backend (auth.uid() null) bez zmian.
--
-- Rollback: odtworzyć `protect_company_verification` z 0019 oraz
-- `drop function public.request_company_reverification(uuid)` i
-- `drop function public.create_first_company(text, text, text)`. Migracja nie zmienia danych.
-- =============================================================================

create or replace function public.protect_company_verification()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    -- Jedyne przejście statusu dostępne pracodawcy: ponowne zgłoszenie odrzuconej firmy (RPC).
    if coalesce(current_setting('pracujbe.company_reverify', true), '') = old.id::text
       and old.status = 'rejected' and new.status = 'pending'
       and new.verified_at is not distinct from old.verified_at
       and new.verified_by is not distinct from old.verified_by then
      return new;
    end if;

    if new.status is distinct from old.status
       or new.verified_at is distinct from old.verified_at
       or new.verified_by is distinct from old.verified_by then
      raise exception 'PERMISSION_DENIED: status/weryfikacja firmy tylko przez backend/admina'
        using errcode = '42501';
    end if;

    -- Zweryfikowane dane tożsamości firmy zmienione → ponowna weryfikacja przez admina.
    if old.status = 'verified'
       and (new.name is distinct from old.name or new.vat_number is distinct from old.vat_number) then
      new.status := 'pending';
      new.verified_at := null;
      new.verified_by := null;
    end if;
  end if;
  return new;
end $$;

-- --- 1. Pierwsza firma pracodawcy (panel) — atomowo z VAT, idempotentnie ---------------
create function public.create_first_company(
  p_name text,
  p_slug text,
  p_vat_number text default null
) returns table (company_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_deleted timestamptz;
  v_existing uuid;
  v_id uuid;
  v_vat text := nullif(btrim(coalesce(p_vat_number, '')), '');
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  -- Blokada profilu serializuje równoległe wywołania (podwójne kliknięcie, retry).
  select p.role::text, p.is_active, p.deleted_at into v_role, v_active, v_deleted
    from public.profiles p where p.id = v_uid for update;
  if v_role is distinct from 'employer' or v_active is not true or v_deleted is not null then
    raise exception 'PERMISSION_DENIED: firmę zakłada konto pracodawcy' using errcode = '42501';
  end if;

  select cm.company_id into v_existing
    from public.company_members cm
    where cm.profile_id = v_uid and cm.is_active = true
    order by cm.created_at, cm.id limit 1;
  if v_existing is not null then
    return query select v_existing, false;
    return;
  end if;
  -- Odebrany dostęp (tylko nieaktywne członkostwa) nie tworzy firmy zastępczej.
  if exists (select 1 from public.company_members cm where cm.profile_id = v_uid) then
    raise exception 'PERMISSION_DENIED: członkostwo w firmie nieaktywne' using errcode = '42501';
  end if;

  insert into public.companies (name, slug, status, vat_number)
    values (btrim(p_name), p_slug, 'unverified', v_vat)
    returning id into v_id;
  insert into public.company_members (company_id, profile_id, role, is_active)
    values (v_id, v_uid, 'owner', true);
  return query select v_id, true;
end $$;
revoke all on function public.create_first_company(text, text, text) from public;
grant execute on function public.create_first_company(text, text, text) to authenticated;

-- --- 2. Ponowne zgłoszenie odrzuconej firmy do weryfikacji ------------------------------
create function public.request_company_reverification(p_company_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_status public.company_status;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_company_admin(p_company_id) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;

  select c.status into v_status from public.companies c
    where c.id = p_company_id and c.deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_status <> 'rejected' then
    raise exception 'COMPANY_STATUS_INVALID' using errcode = '42501';
  end if;

  perform set_config('pracujbe.company_reverify', p_company_id::text, true);
  update public.companies set status = 'pending', updated_at = now() where id = p_company_id;
  perform set_config('pracujbe.company_reverify', '', true);

  perform public.write_audit('company.reverification_requested', 'company', p_company_id,
                             jsonb_build_object('status', 'rejected'),
                             jsonb_build_object('status', 'pending'));
end $$;
revoke all on function public.request_company_reverification(uuid) from public;
grant execute on function public.request_company_reverification(uuid) to authenticated;
