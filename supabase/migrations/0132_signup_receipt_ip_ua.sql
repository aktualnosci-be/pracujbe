-- =============================================================================
-- 0132_signup_receipt_ip_ua.sql
-- IP i user-agent w receiptach akceptacji przy rejestracji (CLAUDE.md, Etap 3 „Otwarte”).
--
-- Rejestracja Better Auth zapisuje receipty (`document_acceptances`) triggerem
-- `auth.record_signup_receipts` w transakcji konta, dotąd bez adresu i user-agenta (null).
--
--   1. Akcja rejestracji dokłada do metadanych konta `receipt_ip` (wyłącznie zaufany nagłówek
--      proxy, `src/lib/http/trusted-ip.ts`) i `receipt_user_agent` (≤ 512 znaków). Trigger
--      przekazuje je do receiptów i USUWA z `auth.users.raw_user_meta_data` w tej samej
--      transakcji — adres nie zostaje w danych konta.
--   2. Retencja: nowa kategoria `acceptance_ip_user_agent` (7 dni, jak `guest_ip_user_agent`)
--      i krok `retention_purge_receipts_batch` w `run_retention_purge` (harmonogram za
--      RETENTION_MODE, domyślnie wyłączony — bez zmian).
--   3. Receipty zostają niezmienne; jedyny dozwolony UPDATE to wyzerowanie ip_address/
--      user_agent przy niezmienionych pozostałych kolumnach (minimalizacja, nie zmiana treści).
--
-- Treść = wersja triggera z 0126 (v1/v2 #493 + deklaracja wieku #492) + dowód IP/UA.
-- Zmieniając tę funkcję w późniejszej migracji, zachowaj wszystkie części.
--
-- Rollback: przywrócić `auth.record_signup_receipts` i `run_retention_purge` z 0126/0127,
-- trigger `document_acceptances_immutable` na `forbid_consent_receipt_change` (0108), drop
-- `retention_purge_receipts_batch`, `document_acceptances_guard` i wiersza
-- `acceptance_ip_user_agent` w retention_policies. Zapisane IP/UA można wyzerować ręcznie.
-- =============================================================================

-- --- 1. Kategoria retencji -------------------------------------------------------------------
insert into public.retention_policies (key, period, warning_period, enforcement, description) values
  ('acceptance_ip_user_agent', interval '7 days', null, 'job',
   'Adres IP i user-agent receiptu akceptacji przy rejestracji: wyzerowanie po 7 dniach od akceptacji (receipt zostaje).')
on conflict (key) do nothing;

-- --- 2. Receipty: niezmienne poza wyzerowaniem IP/UA -----------------------------------------
create or replace function public.document_acceptances_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Kaskada z usunięcia profilu działa z wnętrza triggera RI (głębokość > 1).
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'CONSENT_RECEIPT_IMMUTABLE' using errcode = '42501';
  end if;
  -- Minimalizacja: wyłącznie wyzerowanie adresu i/lub user-agenta, reszta bez zmian.
  if (new.ip_address is null or new.ip_address is not distinct from old.ip_address)
     and (new.user_agent is null or new.user_agent is not distinct from old.user_agent)
     and (new.ip_address is distinct from old.ip_address or new.user_agent is distinct from old.user_agent)
     and (to_jsonb(new) - 'ip_address' - 'user_agent') = (to_jsonb(old) - 'ip_address' - 'user_agent') then
    return new;
  end if;
  raise exception 'CONSENT_RECEIPT_IMMUTABLE' using errcode = '42501';
end $$;
revoke all on function public.document_acceptances_guard() from public;

drop trigger if exists document_acceptances_immutable on public.document_acceptances;
create trigger document_acceptances_immutable
  before update or delete on public.document_acceptances
  for each row execute function public.document_acceptances_guard();

-- --- 3. Retencja: krok receiptów w run_retention_purge ---------------------------------------
create or replace function public.retention_purge_receipts_batch(p_limit integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_limit  integer := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_period interval := public.retention_period('acceptance_ip_user_agent');
  v_n      integer := 0;
begin
  if v_period is not null then
    update public.document_acceptances d
       set ip_address = null, user_agent = null
     where d.id in (select x.id from public.document_acceptances x
                     where (x.ip_address is not null or x.user_agent is not null)
                       and x.accepted_at < now() - v_period
                     order by x.accepted_at limit v_limit for update skip locked);
    get diagnostics v_n = row_count;
  end if;
  return jsonb_build_object('acceptanceIpCleared', v_n,
                            'fullBatches', case when v_n >= v_limit then 1 else 0 end);
end $$;
revoke all on function public.retention_purge_receipts_batch(integer) from public, anon, authenticated;

-- Jedna partia = kategorie z 0127 + receipty; `fullBatches` sumowane (pętla apply w /api/maintenance).
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

-- --- 4. Rejestracja Better Auth: IP/UA w receiptach, bez śladu w metadanych konta ------------
do $mig$
begin
  if to_regprocedure('auth.record_signup_receipts()') is null then
    return;
  end if;
  execute $ddl$
create or replace function auth.record_signup_receipts()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $fn$
declare
  meta jsonb := new.raw_user_meta_data;
  loc text := meta->>'locale';
  ver jsonb := meta->'signup_receipt_version';
  -- Dowód akceptacji: tekst ograniczony; niepoprawny adres receipt i tak zapisze jako null.
  v_ip text := left(nullif(btrim(coalesce(meta->>'receipt_ip', '')), ''), 64);
  v_ua text := left(nullif(btrim(coalesce(meta->>'receipt_user_agent', '')), ''), 512);
begin
  if not (meta ? 'signup_receipt_version') then return new; end if;
  if coalesce(ver not in ('1'::jsonb, '2'::jsonb), true)
    or meta->'agree_terms' is distinct from 'true'::jsonb
    or coalesce(meta->>'role', '') not in ('candidate', 'employer')
    or not public.is_supported_locale(coalesce(loc, '')) then
    raise exception 'VALIDATION_FAILED' using errcode = '23514';
  end if;
  if ver = '2'::jsonb and (
       meta->'privacy_notice_ack' is distinct from 'true'::jsonb
       or jsonb_typeof(coalesce(meta->'optional_consents', '{}'::jsonb)) <> 'object'
       or jsonb_typeof(coalesce(meta->'consent_wording', '{}'::jsonb)) <> 'object') then
    raise exception 'VALIDATION_FAILED' using errcode = '23514';
  end if;
  -- #492: kandydat deklaruje próg wieku; bez deklaracji konto nie powstaje.
  if meta->>'role' = 'candidate'
     and coalesce(jsonb_typeof(meta->'age_min_attested'), '') <> 'number' then
    raise exception 'AGE_ATTESTATION_REQUIRED' using errcode = '23514';
  end if;

  update public.profiles set preferred_locale = loc where id = new.id;
  if not found then raise exception 'Brak profilu rejestracji.'; end if;
  if ver = '1'::jsonb then
    -- Formularz sprzed #493 (wspólny checkbox) — zapis zachowuje dawne znaczenie.
    perform public.record_document_acceptance(new.id, array['terms','privacy'], loc, v_ip, v_ua);
  else
    perform public.record_signup_consents(new.id, true, true,
      coalesce(meta->'optional_consents', '{}'::jsonb), 'signup', loc,
      coalesce(meta->'consent_wording', '{}'::jsonb), v_ip, v_ua);
  end if;
  if meta->>'role' = 'candidate' then
    perform public.insert_candidate_age_attestation(
      new.id, (meta->>'age_min_attested')::numeric::integer, 'signup', loc);
  end if;
  -- Adres i user-agent żyją wyłącznie w receipcie (retencja 7 dni), nie w metadanych konta.
  if meta ? 'receipt_ip' or meta ? 'receipt_user_agent' then
    update auth.users
       set raw_user_meta_data = raw_user_meta_data - 'receipt_ip' - 'receipt_user_agent'
     where id = new.id;
  end if;
  return new;
end $fn$
  $ddl$;
  execute 'revoke all on function auth.record_signup_receipts() from public, anon, authenticated, '
    || 'pracujbe_app, pracujbe_auth, service_role';
end
$mig$;
