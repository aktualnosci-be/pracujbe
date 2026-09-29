-- =============================================================================
-- 0961 (numer TYMCZASOWY — ostateczny nada integrator) — utwardzenie warstwy danych:
--      usuwanie ofert, niezmienność pól firmy, kontrola zapisu plików, sesje i tokeny konta.
--
-- Issues (audyt 2026-09-28): #1033 (AUTHZ-03), #1034 (AUTHZ-04), #1089 (AUTHZ-05/06),
-- #1091 (PRIV-05, tylko sesje i tokeny), #1090 (AUTH-05, unieważnianie linków resetu hasła).
--
-- 1. #1033 — twarde usunięcie oferty (`DELETE`, polityka `jobs_delete_member` z 0033) było
--    dozwolone recruiter+ dla każdej oferty, a kaskada kluczy obcych (aplikacje, propozycje,
--    dopasowania, zgłoszenia gościa, zapisane oferty) kasowała historię bez śladu. Teraz rola
--    klienta usuwa WYŁĄCZNIE szkic bez decyzji moderacyjnej i bez powiązanych rekordów procesu
--    (`job_has_process_records`, SECURITY DEFINER — kaskada i tak omija RLS dzieci). Cykl życia
--    opublikowanej oferty = zamknięcie/wygaśnięcie, nie DELETE. Każde usunięcie oferty (także
--    przez service_role/migrację) zostawia wpis audytu `job.deleted` (bez treści oferty).
-- 2. #1034 — `protect_company_verification` (0084) traktuje numer rejestrowy (KBO) jak VAT:
--    zmiana zweryfikowanej firmy wraca do `pending`. Nowy strażnik `guard_company_immutable_fields`:
--    `slug`, `is_demo`, `deleted_at`, `created_at` są niezmienne dla ról
--    klienta (anon/authenticated); definer RPC, service_role i migracje bez zmian. Bramki blokady
--    moderacyjnej (oferta i firma, 0099) nie ufają już samej fladze sesji `pracujbe.moderation`:
--    flaga działa tylko poza rolą klienta (RPC decyzji są SECURITY DEFINER, więc ich wykonawcą
--    nie jest `authenticated`).
-- 3. #1089 — (a) tabela `files`: dla ról klienta ścieżka musi zaczynać się od identyfikatora
--    właściciela, plik jest prywatny i ze statusem skanu `pending`/`skipped` (`clean`/`infected`
--    ustawia tylko serwer); po utworzeniu niezmienne: właściciel, bucket, ścieżka, typ i id encji,
--    widoczność, status skanu, suma kontrolna, typ MIME i rozmiar; (b) `is_admin()` wymaga
--    aktywnego, nieusuniętego profilu; (c) `count_other_active_owners` bez EXECUTE dla ról klienta —
--    strażnik `enforce_owner_invariants` (jedyny wołający w roli klienta) liczy właścicieli
--    zapytaniem inline (członek firmy widzi wszystkich jej członków pod RLS), definer RPC
--    z 0086/0161 wołają funkcję jako właściciel.
-- 4. #1091 — retencja: dwie kategorie (`expired_auth_session`, `expired_auth_verification`,
--    7 dni po wygaśnięciu) czyszczone krokiem `retention_purge_auth_batch` w `run_retention_purge`
--    (jak pozostałe za `RETENTION_MODE`); usunięcie konta (`auth.users`) usuwa też tokeny resetu
--    hasła zapisane pod identyfikatorem konta (`value`) i wiersze weryfikacji po adresie e-mail.
-- 5. #1090 — ustawienie/zmiana hasła (`auth.accounts`, konto `credential`) unieważnia pozostałe
--    linki resetu hasła tego konta (wiersze `reset-password:*` w `auth.verifications`) i wycofuje
--    niewysłane listy resetu z `auth.email_outbox`.
--
-- Nie zmienia danych istniejących poza definicjami i wierszami retencji. Tryb ogłoszeniowy
-- (0171–0176) bez zmian.
--
-- Rollback: `supabase/rollback/0961_rls_data_hardening.down.sql` (przywraca definicje z 0033, 0084,
-- 0099, 0165, 0019, 0132 i usuwa nowe obiekty).
-- =============================================================================

-- --- 1. #1033: usuwanie ofert ----------------------------------------------------------------
create or replace function public.job_has_process_records(p_job_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.applications a where a.job_id = p_job_id)
      or exists (select 1 from public.offers o where o.job_id = p_job_id)
      or exists (select 1 from public.matches m where m.job_id = p_job_id)
      or exists (select 1 from public.guest_application_requests g where g.job_id = p_job_id)
      or exists (select 1 from public.saved_jobs s where s.job_id = p_job_id);
$$;
revoke all on function public.job_has_process_records(uuid) from public, anon;
grant execute on function public.job_has_process_records(uuid) to authenticated;

drop policy if exists jobs_delete_member on public.jobs;
create policy jobs_delete_member on public.jobs
  for delete to authenticated
  using (
    public.can_manage_jobs(company_id)
    and status = 'draft'
    and moderation_decision_id is null
    and not public.job_has_process_records(id)
  );

create or replace function public.audit_job_delete()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data)
  values (auth.uid(), 'job.deleted', 'job', old.id,
          jsonb_build_object('status', old.status, 'company_id', old.company_id, 'slug', old.slug));
  return old;
end $$;
revoke all on function public.audit_job_delete() from public, anon, authenticated;

drop trigger if exists trg_audit_job_delete on public.jobs;
create trigger trg_audit_job_delete
  after delete on public.jobs
  for each row execute function public.audit_job_delete();

-- --- 2. #1034: pola firmy --------------------------------------------------------------------
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

    -- Zweryfikowane dane tożsamości firmy (nazwa, VAT, numer rejestrowy) zmienione → ponowna
    -- weryfikacja przez admina.
    if old.status = 'verified'
       and (new.name is distinct from old.name
            or new.vat_number is distinct from old.vat_number
            or new.registration_number is distinct from old.registration_number) then
      new.status := 'pending';
      new.verified_at := null;
      new.verified_by := null;
    end if;
  end if;
  return new;
end $$;

create or replace function public.guard_company_immutable_fields()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Tylko role klienta; definer RPC (właściciel funkcji), service_role i migracje bez zmian.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.slug is distinct from old.slug
     or new.is_demo is distinct from old.is_demo
     or new.deleted_at is distinct from old.deleted_at
     or new.created_at is distinct from old.created_at then
    raise exception 'PERMISSION_DENIED: pola techniczne firmy są niezmienne' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_company_immutable_fields() from public, anon, authenticated;

drop trigger if exists trg_guard_company_immutable_fields on public.companies;
create trigger trg_guard_company_immutable_fields
  before update on public.companies
  for each row execute function public.guard_company_immutable_fields();

create or replace function public.guard_job_moderation_lock()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Flaga sesji `pracujbe.moderation` działa tylko poza rolą klienta (RPC decyzji = definer).
  if coalesce(current_setting('pracujbe.moderation', true), '') <> 'on'
     or current_user in ('anon', 'authenticated') then
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
  if coalesce(current_setting('pracujbe.moderation', true), '') <> 'on'
     or current_user in ('anon', 'authenticated') then
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

-- --- 3. #1089: pliki, is_admin, licznik właścicieli --------------------------------------------
create or replace function public.guard_files_client_write()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Tylko role klienta; kod serwera (definer, service_role) ustawia status skanu i załączniki.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.owner_id is null
       or split_part(new.path, '/', 1) <> new.owner_id::text
       or new.visibility is distinct from 'private'
       or new.scan_status not in ('pending', 'skipped')
       or new.deleted_at is not null then
      raise exception 'PERMISSION_DENIED: nowy plik tylko prywatny, w folderze właściciela, bez wyniku skanu'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.id is distinct from old.id
     or new.owner_id is distinct from old.owner_id
     or new.bucket is distinct from old.bucket
     or new.path is distinct from old.path
     or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.visibility is distinct from old.visibility
     or new.scan_status is distinct from old.scan_status
     or new.checksum_sha256 is distinct from old.checksum_sha256
     or new.mime_type is distinct from old.mime_type
     or new.size_bytes is distinct from old.size_bytes
     or new.created_at is distinct from old.created_at then
    raise exception 'PERMISSION_DENIED: metadane pliku są niezmienne po utworzeniu' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_files_client_write() from public, anon, authenticated;

drop trigger if exists trg_files_guard_client_write on public.files;
create trigger trg_files_guard_client_write
  before insert or update on public.files
  for each row execute function public.guard_files_client_write();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'admin' and is_active and deleted_at is null);
$$;

-- `enforce_owner_invariants` (0165): licznik właścicieli zapytaniem inline zamiast wywołania
-- `count_other_active_owners` — trigger działa z prawami roli klienta, której odbieramy EXECUTE.
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
      if not exists (
        select 1 from public.company_members cm
         where cm.company_id = old.company_id and cm.role = 'owner' and cm.is_active
           and cm.id <> old.id) then
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
      if not exists (
        select 1 from public.company_members cm
         where cm.company_id = old.company_id and cm.role = 'owner' and cm.is_active
           and cm.id <> old.id) then
        raise exception 'VALIDATION_FAILED: nie można usunąć ostatniego aktywnego właściciela firmy'
          using errcode = '42501';
      end if;
    end if;
    return old;
  end if;
  return new;
end $$;

revoke all on function public.count_other_active_owners(uuid, uuid) from public, anon, authenticated;

-- --- 4. #1091: sesje i tokeny konta ----------------------------------------------------------
insert into public.retention_policies (key, period, warning_period, enforcement, description) values
  ('expired_auth_session', interval '7 days', null, 'job',
   'Wygasła sesja logowania (z adresem IP i user-agentem): usunięcie wiersza 7 dni po wygaśnięciu.'),
  ('expired_auth_verification', interval '7 days', null, 'job',
   'Wygasły token weryfikacji (potwierdzenie e-maila, reset hasła): usunięcie wiersza 7 dni po wygaśnięciu.')
on conflict (key) do nothing;

-- Tabele `auth.*` pochodzą z database/auth (0057); zestaw bez schematu Better Auth pomija krok.
create or replace function public.retention_purge_auth_batch(p_limit integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_limit    integer := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_period   interval;
  v_sessions integer := 0;
  v_verif    integer := 0;
  v_full     integer := 0;
begin
  v_period := public.retention_period('expired_auth_session');
  if v_period is not null and to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where id in (
               select x.id from auth.sessions x where x.expires_at < now() - $1
                order by x.expires_at limit $2 for update skip locked)'
      using v_period, v_limit;
    get diagnostics v_sessions = row_count;
    if v_sessions >= v_limit then v_full := v_full + 1; end if;
  end if;

  v_period := public.retention_period('expired_auth_verification');
  if v_period is not null and to_regclass('auth.verifications') is not null then
    execute 'delete from auth.verifications where id in (
               select x.id from auth.verifications x where x.expires_at < now() - $1
                order by x.expires_at limit $2 for update skip locked)'
      using v_period, v_limit;
    get diagnostics v_verif = row_count;
    if v_verif >= v_limit then v_full := v_full + 1; end if;
  end if;

  return jsonb_build_object('expiredAuthSessions', v_sessions,
                            'expiredAuthVerifications', v_verif,
                            'fullBatches', v_full);
end $$;
revoke all on function public.retention_purge_auth_batch(integer) from public, anon, authenticated;

-- Jedna partia = kategorie z 0127 + receipty (0132) + sesje i tokeny; `fullBatches` sumowane.
create or replace function public.run_retention_purge(p_limit integer default 200, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_out jsonb; v_receipts jsonb; v_auth jsonb;
begin
  if coalesce(p_dry_run, false) then
    begin
      v_out := public.retention_purge_batch(p_limit);
      v_receipts := public.retention_purge_receipts_batch(p_limit);
      v_auth := public.retention_purge_auth_batch(p_limit);
      raise exception 'RETENTION_DRY_RUN_ROLLBACK' using errcode = 'P0001';
    exception when raise_exception then
      if sqlerrm <> 'RETENTION_DRY_RUN_ROLLBACK' then raise; end if;
    end;
  else
    v_out := public.retention_purge_batch(p_limit);
    v_receipts := public.retention_purge_receipts_batch(p_limit);
    v_auth := public.retention_purge_auth_batch(p_limit);
  end if;
  v_out := v_out || jsonb_build_object(
    'acceptanceIpCleared', v_receipts->'acceptanceIpCleared',
    'expiredAuthSessions', v_auth->'expiredAuthSessions',
    'expiredAuthVerifications', v_auth->'expiredAuthVerifications',
    'fullBatches', coalesce((v_out->>'fullBatches')::integer, 0)
                   + coalesce((v_receipts->>'fullBatches')::integer, 0)
                   + coalesce((v_auth->>'fullBatches')::integer, 0));
  if coalesce(p_dry_run, false) then
    v_out := v_out || jsonb_build_object('dryRun', 1);
  end if;
  return v_out;
end $$;
revoke all on function public.run_retention_purge(integer, boolean) from public, anon, authenticated;
grant execute on function public.run_retention_purge(integer, boolean) to service_role;

-- Usunięcie konta: tokeny resetu hasła (wartość = identyfikator konta, identyfikator
-- `reset-password:<token>`) i weryfikacje po adresie e-mail znikają razem z kontem —
-- niezależnie od ścieżki usunięcia (kandydat, pracodawca, retencja, przywrócenie tombstone).
create or replace function public.auth_user_delete_cleanup()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from auth.verifications v
   where (v.identifier like 'reset-password:%' and v.value = old.id::text)
      or v.identifier = old.email::text;
  return null;
end $$;
revoke all on function public.auth_user_delete_cleanup() from public, anon, authenticated;

-- --- 5. #1090: linki resetu hasła po ustawieniu hasła -----------------------------------------
create or replace function public.auth_invalidate_reset_links()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.provider_id is distinct from 'credential' or new.password is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.password is not distinct from old.password then
    return null;
  end if;
  -- Wykorzystany link został zużyty przed zapisem hasła; usuwamy wszystkie pozostałe.
  delete from auth.verifications v
   where v.identifier like 'reset-password:%' and v.value = new.user_id::text;
  -- Niewysłane listy resetu (kolejka) nie wyjdą z martwym tokenem.
  update auth.email_outbox e
     set status = 'expired', token = null
   where e.user_id = new.user_id and e.kind = 'password_reset' and e.status = 'queued';
  return null;
end $$;
revoke all on function public.auth_invalidate_reset_links() from public, anon, authenticated;

do $$
begin
  if to_regclass('auth.users') is not null then
    execute 'drop trigger if exists trg_auth_users_delete_cleanup on auth.users';
    execute 'create trigger trg_auth_users_delete_cleanup
               after delete on auth.users
               for each row execute function public.auth_user_delete_cleanup()';
  end if;
  if to_regclass('auth.accounts') is not null then
    execute 'drop trigger if exists trg_auth_accounts_invalidate_reset_links on auth.accounts';
    execute 'create trigger trg_auth_accounts_invalidate_reset_links
               after insert or update of password on auth.accounts
               for each row execute function public.auth_invalidate_reset_links()';
  end if;
  if to_regclass('auth.verifications') is not null then
    -- Wyszukiwanie tokenów resetu po koncie (usunięcie konta, ustawienie hasła).
    execute 'create index if not exists auth_verifications_reset_value_idx
               on auth.verifications (value) where identifier like ''reset-password:%''';
  end if;
end $$;
