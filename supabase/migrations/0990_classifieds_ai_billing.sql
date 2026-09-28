-- =============================================================================
-- 0990 — tryb ogłoszeniowy: AI tylko na treści ogłoszenia i katalog planów bez dostępu do
-- kandydatów (#1152, #1153; epik #1128). NUMER TYMCZASOWY — ostateczny nada integrator.
--
-- Decyzja produktowa: portal ogłoszeniowy.
--
-- 1. Kolejka tłumaczeń (0145) — encja `candidate_profile` w trybie ogłoszeniowym:
--    * strażnik BEFORE INSERT na `translation_sources`, `translation_source_revisions` i
--      `translation_jobs` odrzuca nowe wiersze tej encji (`RECRUITMENT_DISABLED`), więc
--      `record_translation_source('candidate_profile', …)` nie tworzy źródła, rewizji ani zadań
--      (całe wywołanie jest wycofywane; strażnik na tabeli nie znika, gdy późniejsza migracja
--      podmieni treść RPC). Wyjątek seedu/testów = `recruitment_write_allowed()` z 0171
--      (tylko superuser z jawnym znacznikiem);
--    * `claim_translation_jobs` nie wydaje workerowi zadań tej encji, dopóki
--      `recruitment_enabled()` = false (także zadań zakolejkowanych wcześniej; błąd odczytu
--      trybu = false, fail-closed). Treść = 0145 poza tym jednym warunkiem.
--    Oferty (`job`) bez zmian.
-- 2. Budżet AI (0120/0167): nowy identyfikator funkcji `candidate_profile_translation`
--    (tłumaczenie profilu rozliczane osobno od ofert; lista = AI_FEATURE_IDS w
--    src/lib/ai/inventory.ts, test ai-budget). Treść `ai_budget_reserve` = 0167 poza listą.
-- 3. Katalog planów (0055): `candidate_access = false` dla każdego planu i CHECK, który nie
--    pozwala ustawić `true` (także service_role i migracjom) — żaden plan nie sprzedaje dostępu
--    do kandydatów, dopasowań ani profili. Kolumna zostaje (czyta ją get_company_entitlements).
--
-- Rollback: supabase/rollback/0990_classifieds_ai_billing.down.sql.
-- =============================================================================

-- --- 1a. Strażnik zapisu kolejki tłumaczeń --------------------------------------------------
create or replace function public.enforce_translation_entity_mode()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.entity_type = 'candidate_profile' and not public.recruitment_write_allowed() then
    raise exception 'RECRUITMENT_DISABLED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.enforce_translation_entity_mode() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['translation_sources', 'translation_source_revisions', 'translation_jobs'] loop
    execute format('drop trigger if exists trg_aa_recruitment_mode on public.%I', t);
    execute format('create trigger trg_aa_recruitment_mode before insert on public.%I
                    for each row execute function public.enforce_translation_entity_mode()', t);
  end loop;
end $$;

-- --- 1b. Claim bez zadań profili kandydatów w trybie ogłoszeniowym ------------------------------
create or replace function public.claim_translation_jobs(
  p_limit integer default 10,
  p_lease_seconds integer default 300
) returns table (
  job_id uuid,
  lease_id uuid,
  lease_expires_at timestamptz,
  attempt integer,
  entity_type text,
  entity_id uuid,
  revision_id uuid,
  revision_no integer,
  source_locale text,
  target_locale text,
  pipeline_version text,
  fields jsonb
) language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_lease interval := make_interval(secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 1800));
  v_recruitment boolean := public.recruitment_enabled();
begin
  -- Wygasłe dzierżawy bez prób do wykorzystania kończą się trwałym błędem.
  update public.translation_jobs j
     set status = 'failed', last_error_code = 'lease_expired', lease_id = null,
         lease_expires_at = null, completed_at = now(), updated_at = now()
   where j.status = 'leased' and j.lease_expires_at < now() and j.attempts >= j.max_attempts;

  return query
  with picked as (
    select j.id
      from public.translation_jobs j
      join public.translation_sources s
        on s.entity_type = j.entity_type and s.entity_id = j.entity_id
     where ((j.status in ('queued', 'retry') and j.next_attempt_at <= now())
            or (j.status = 'leased' and j.lease_expires_at < now()))
       and s.is_active and s.current_revision_id = j.revision_id
       and j.attempts < j.max_attempts
       -- #1152: profil kandydata tylko w trybie RECRUITMENT (zadania czekają bez kosztu).
       and (j.entity_type <> 'candidate_profile' or v_recruitment)
     order by j.next_attempt_at, j.created_at
     for update of j skip locked
     limit least(greatest(coalesce(p_limit, 10), 0), 100)
  ), leased as (
    update public.translation_jobs j
       set status = 'leased', lease_id = gen_random_uuid(), lease_expires_at = now() + v_lease,
           attempts = j.attempts + 1, updated_at = now()
      from picked p
     where j.id = p.id
    returning j.*
  )
  select l.id, l.lease_id, l.lease_expires_at, l.attempts, l.entity_type, l.entity_id,
         r.id, r.revision_no, r.source_locale, l.target_locale, l.pipeline_version, r.fields
    from leased l
    join public.translation_source_revisions r on r.id = l.revision_id;
end $$;
revoke all on function public.claim_translation_jobs(integer, integer) from public;
grant execute on function public.claim_translation_jobs(integer, integer) to service_role;

-- --- 2. Budżet AI: funkcja `candidate_profile_translation` -------------------------------------
alter table public.ai_usage_ledger drop constraint if exists ai_usage_ledger_feature;
alter table public.ai_usage_ledger add constraint ai_usage_ledger_feature
  check (feature in ('job_listing_import', 'content_translation', 'job_offer_assist', 'cv_profile_import', 'job_fraud_check', 'candidate_profile_translation'));

create or replace function public.ai_budget_reserve(
  p_feature text,
  p_model text,
  p_estimate_micro_usd bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := public.ai_budget_day();
  v_month date := date_trunc('month', v_day)::date;
  v_day_limit bigint;
  v_month_limit bigint;
  v_id uuid;
begin
  if p_feature is null or p_feature not in ('job_listing_import', 'content_translation', 'job_offer_assist', 'cv_profile_import', 'job_fraud_check', 'candidate_profile_translation') then
    raise exception 'VALIDATION_FAILED: feature' using errcode = '22023';
  end if;
  if p_model is null or p_model !~ '^[a-z0-9][a-z0-9.-]{2,63}$' then
    raise exception 'VALIDATION_FAILED: model' using errcode = '22023';
  end if;
  -- Szacunek musi być dodatni: rezerwacja zerowa nie chroniłaby budżetu.
  if p_estimate_micro_usd is null or p_estimate_micro_usd <= 0 or p_estimate_micro_usd > 100000000 then
    raise exception 'VALIDATION_FAILED: estimate' using errcode = '22023';
  end if;

  -- Jedna rezerwacja naraz: równoległe wywołania nie przekroczą limitu wspólnie.
  perform pg_advisory_xact_lock(hashtext('pracujbe.ai_budget'));

  select limit_micro_usd into v_day_limit from public.ai_budget_limits where period = 'day';
  select limit_micro_usd into v_month_limit from public.ai_budget_limits where period = 'month';
  if v_day_limit is null or v_month_limit is null then
    raise exception 'AI_BUDGET_UNCONFIGURED' using errcode = 'P0001';
  end if;

  if public.ai_budget_spent(v_day, v_day) + p_estimate_micro_usd > v_day_limit
     or public.ai_budget_spent(v_month, v_day) + p_estimate_micro_usd > v_month_limit then
    raise exception 'AI_BUDGET_EXCEEDED' using errcode = 'P0001';
  end if;

  insert into public.ai_usage_ledger (feature, model, reserved_micro_usd, usage_day)
  values (p_feature, p_model, p_estimate_micro_usd, v_day)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.ai_budget_reserve(text, text, bigint) from public, anon, authenticated;
grant execute on function public.ai_budget_reserve(text, text, bigint) to service_role;

-- --- 3. Katalog planów bez dostępu do kandydatów -----------------------------------------------
update public.plan_entitlements set candidate_access = false, updated_at = now()
 where candidate_access;
alter table public.plan_entitlements drop constraint if exists plan_entitlements_no_candidate_access;
alter table public.plan_entitlements add constraint plan_entitlements_no_candidate_access
  check (candidate_access = false);
comment on column public.plan_entitlements.candidate_access is
  'Zawsze false (#1153 — decyzja produktowa: portal ogłoszeniowy). Żaden plan nie daje dostępu do kandydatów; CHECK plan_entitlements_no_candidate_access.';
