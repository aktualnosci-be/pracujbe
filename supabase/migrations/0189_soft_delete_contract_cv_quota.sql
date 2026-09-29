-- =============================================================================
-- 0189 — numer tymczasowy (nadaje integrator). Audyt 2026-09-28: DC-06 (#1111) i CF-06 (#1101).
--
-- 1. Kontrakt soft-delete (`deleted_at`) dla tabel procesu: applications, offers, conversations,
--    messages. Polityki ODCZYTU (0039 / 0009) nie sprawdzały `deleted_at`, więc logicznie usunięty
--    rekord zostawał widoczny dla uczestników. Zmiana: `deleted_at IS NULL` w warunku odczytu
--    (admin i workery czytają jako service_role, poza RLS — bez zmian). Polityki restrykcyjne
--    trybu (0171) i reszta warunków bez zmian.
--    Strażnik `enforce_soft_delete_contract` na `messages` (BEFORE INSERT/UPDATE, także SECURITY
--    DEFINER RPC i service_role): nowa wiadomość w usuniętej rozmowie i zmiana treści usuniętej
--    wiadomości → `NOT_FOUND`. Zmiany samych kluczy obcych (anonimizacja przy usunięciu konta,
--    retencja) i przywrócenie (zmiana `deleted_at`) nie są blokowane. Zmiany statusu usuniętej
--    aplikacji i propozycji (`applications`, `offers`) odrzuca ten sam strażnik (BEFORE UPDATE, każda
--    ścieżka: `transition_application`, `respond_to_offer`, wycofanie, bezpośredni DML, SECURITY
--    DEFINER i service_role) → `NOT_FOUND` (decyzja właściciela 29.09.2026). Zmiana samego `deleted_at`
--    i kluczy obcych (usuwanie konta `erase_*`, retencja) nie jest blokowana.
-- 2. Limit plików CV na konto (CF-06): najwyżej 10 nieusuniętych plików `candidate_cv` i 50 MB
--    łącznie (`CV_ACCOUNT_LIMIT`, SQLSTATE 54000), serializowane blokadą doradczą właściciela.
--    Lustro TS: `CV_MAX_FILES_PER_ACCOUNT`/`CV_MAX_TOTAL_BYTES_PER_ACCOUNT` (validation/cv-file.ts).
--
-- Rollback: supabase/rollback/0189_soft_delete_contract_cv_quota.down.sql.
-- =============================================================================

-- --- 1. Polityki odczytu -----------------------------------------------------------------------
drop policy if exists applications_select on public.applications;
create policy applications_select on public.applications
  for select to authenticated
  using (deleted_at is null and (candidate_id = auth.uid() or public.is_job_manager(job_id)));

drop policy if exists offers_select on public.offers;
create policy offers_select on public.offers
  for select to authenticated
  using (deleted_at is null and (candidate_id = auth.uid() or public.is_job_manager(job_id)));

drop policy if exists conversations_select_member on public.conversations;
create policy conversations_select_member on public.conversations
  for select to authenticated
  using (deleted_at is null and public.is_conversation_member(id));

drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages
  for select to authenticated
  using (deleted_at is null and public.is_conversation_member(conversation_id));

-- --- 1b. Strażnik zapisu -----------------------------------------------------------------------
create or replace function public.enforce_soft_delete_contract()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'messages' then
    if tg_op = 'INSERT' then
      if exists (select 1 from public.conversations c
                  where c.id = new.conversation_id and c.deleted_at is not null) then
        raise exception 'NOT_FOUND' using errcode = 'P0002';
      end if;
    elsif old.deleted_at is not null and new.deleted_at is not distinct from old.deleted_at
          and new.body is distinct from old.body then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
  elsif tg_table_name in ('applications', 'offers') then
    if tg_op = 'UPDATE' and old.deleted_at is not null and new.status is distinct from old.status then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_soft_delete_contract() from public, anon, authenticated;

drop trigger if exists trg_soft_delete_contract on public.messages;
create trigger trg_soft_delete_contract before insert or update on public.messages
  for each row execute function public.enforce_soft_delete_contract();

drop trigger if exists trg_soft_delete_contract on public.applications;
create trigger trg_soft_delete_contract before update on public.applications
  for each row execute function public.enforce_soft_delete_contract();
drop trigger if exists trg_soft_delete_contract on public.offers;
create trigger trg_soft_delete_contract before update on public.offers
  for each row execute function public.enforce_soft_delete_contract();

-- --- 2. Limit plików CV na konto ---------------------------------------------------------------
create or replace function public.enforce_cv_account_quota()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count integer;
  v_bytes bigint;
begin
  if new.entity_type is distinct from 'candidate_cv' or new.deleted_at is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cv-quota:' || new.owner_id::text, 0));
  select count(*), coalesce(sum(size_bytes), 0) into v_count, v_bytes
    from public.files
   where owner_id = new.owner_id and entity_type = 'candidate_cv' and deleted_at is null;
  if v_count >= 10 or v_bytes + coalesce(new.size_bytes, 0) > 50 * 1024 * 1024 then
    raise exception 'CV_ACCOUNT_LIMIT' using errcode = '54000';
  end if;
  return new;
end $$;
revoke all on function public.enforce_cv_account_quota() from public, anon, authenticated;

drop trigger if exists trg_cv_account_quota on public.files;
create trigger trg_cv_account_quota before insert on public.files
  for each row execute function public.enforce_cv_account_quota();
