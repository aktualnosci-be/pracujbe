-- =============================================================================
-- Rollback 0961 (#1033, #1034, #1089, #1091, #1090) — przywraca definicje sprzed migracji
-- (0019, 0033, 0084, 0099, 0132, 0165) i usuwa obiekty 0961. Dane bez zmian; wpisy audytu
-- `job.deleted` i wiersze retencji `expired_auth_*` (jeśli nie usunięte) zostają/są kasowane
-- jawnie poniżej. Uruchamiany w teście scripts/test-rls.sh (transakcja cofana).
-- =============================================================================

-- 1. Usuwanie ofert: polityka z 0033 (recruiter+ dla dowolnej oferty), bez audytu usunięcia.
drop trigger if exists trg_audit_job_delete on public.jobs;
drop function if exists public.audit_job_delete();
drop policy if exists jobs_delete_member on public.jobs;
create policy jobs_delete_member on public.jobs
  for delete to authenticated
  using (public.can_manage_jobs(company_id));
drop function if exists public.job_has_process_records(uuid);

-- 2. Pola firmy i bramki moderacyjne.
drop trigger if exists trg_guard_company_immutable_fields on public.companies;
drop function if exists public.guard_company_immutable_fields();
create or replace function public.protect_company_verification()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    -- Jedyne przejście statusu dostępne pracodawcy: ponowne zgłoszenie odrzuconej firmy (RPC).
    if coalesce(current_setting('pracujbe.company_reverify', true), '') = old.id::text
       and old.status = 'rejected' and new.status = 'pending'
       and new.verified_at is not distinct from old.verified_at
       and new.verified_by is not distinct from old.verified_by
       and new.status_reason is not distinct from old.status_reason then
      return new;
    end if;

    if new.status is distinct from old.status
       or new.verified_at is distinct from old.verified_at
       or new.verified_by is distinct from old.verified_by
       or new.status_reason is distinct from old.status_reason then
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
create or replace function public.guard_job_moderation_lock()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('pracujbe.moderation', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      if new.moderation_decision_id is not null then
        raise exception 'PERMISSION_DENIED: blokadę moderacyjną ustawia tylko decyzja' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.moderation_decision_id is distinct from old.moderation_decision_id then
      raise exception 'PERMISSION_DENIED: blokadę moderacyjną zmienia tylko decyzja' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.moderation_decision_id is not null
     and new.moderation_decision_id is not null
     and new.status is distinct from old.status then
    raise exception 'MODERATION_LOCKED: oferta wycofana decyzją moderacyjną' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_job_moderation_lock() from public;

create or replace function public.guard_company_moderation_lock()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('pracujbe.moderation', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      if new.moderation_decision_id is not null then
        raise exception 'PERMISSION_DENIED: blokadę moderacyjną ustawia tylko decyzja' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.moderation_decision_id is distinct from old.moderation_decision_id then
      raise exception 'PERMISSION_DENIED: blokadę moderacyjną zmienia tylko decyzja' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.moderation_decision_id is not null
     and new.moderation_decision_id is not null
     and (new.status is distinct from old.status or new.status_reason is distinct from old.status_reason) then
    raise exception 'MODERATION_LOCKED: firma zawieszona decyzją moderacyjną' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_company_moderation_lock() from public;

-- 3. Pliki, is_admin, licznik właścicieli.
drop trigger if exists trg_files_guard_client_write on public.files;
drop function if exists public.guard_files_client_write();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

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
grant execute on function public.count_other_active_owners(uuid, uuid) to public, anon, authenticated;

-- 4. Sesje i tokeny konta: run_retention_purge z 0132, bez kroku `retention_purge_auth_batch`.
create or replace function public.run_retention_purge(p_limit integer default 200, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_out jsonb; v_receipts jsonb;
begin
  if coalesce(p_dry_run, false) then
    begin
      v_out := public.retention_purge_batch(p_limit);
      v_receipts := public.retention_purge_receipts_batch(p_limit);
      raise exception 'RETENTION_DRY_RUN_ROLLBACK' using errcode = 'P0001';
    exception when raise_exception then
      if sqlerrm <> 'RETENTION_DRY_RUN_ROLLBACK' then raise; end if;
    end;
  else
    v_out := public.retention_purge_batch(p_limit);
    v_receipts := public.retention_purge_receipts_batch(p_limit);
  end if;
  v_out := v_out || jsonb_build_object(
    'acceptanceIpCleared', v_receipts->'acceptanceIpCleared',
    'fullBatches', coalesce((v_out->>'fullBatches')::integer, 0)
                   + coalesce((v_receipts->>'fullBatches')::integer, 0));
  if coalesce(p_dry_run, false) then
    v_out := v_out || jsonb_build_object('dryRun', 1);
  end if;
  return v_out;
end $$;
revoke all on function public.run_retention_purge(integer, boolean) from public, anon, authenticated;
grant execute on function public.run_retention_purge(integer, boolean) to service_role;
drop function if exists public.retention_purge_auth_batch(integer);
delete from public.retention_policies where key in ('expired_auth_session', 'expired_auth_verification');

-- 5. Trigger czyszczenia tokenów konta i unieważniania linków resetu hasła.
do $$
begin
  if to_regclass('auth.users') is not null then
    execute 'drop trigger if exists trg_auth_users_delete_cleanup on auth.users';
  end if;
  if to_regclass('auth.accounts') is not null then
    execute 'drop trigger if exists trg_auth_accounts_invalidate_reset_links on auth.accounts';
  end if;
  if to_regclass('auth.verifications') is not null then
    execute 'drop index if exists auth.auth_verifications_reset_value_idx';
  end if;
end $$;
drop function if exists public.auth_user_delete_cleanup();
drop function if exists public.auth_invalidate_reset_links();
