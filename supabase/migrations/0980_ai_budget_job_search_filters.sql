-- 0980 (numer tymczasowy — nadaje integrator): budżet AI dla wyszukiwania opisem (#711).
--
-- Nowa funkcja AI `job_search_filters` (src/lib/ai-search/, inwentarz src/lib/ai/inventory.ts)
-- przechodzi przez globalny budżet kosztów (#36, `withAiBudget`). Lista funkcji w CHECK-u rejestru
-- i w `ai_budget_reserve` = `AI_FEATURE_IDS` (test `ai-budget.test.ts` czyta najnowszą migrację).
-- Definicja `ai_budget_reserve` = 0176 + nowy identyfikator; nic poza listą się nie zmienia.
-- Lista zawiera też `job_offer_explain` (#773, PR #1304 — wcześniejsza migracja tej samej listy),
-- żeby ta migracja, stosowana po niej, nie usunęła tamtej funkcji z budżetu.
-- Rollback: supabase/rollback/0980_ai_budget_job_search_filters.down.sql.

alter table public.ai_usage_ledger drop constraint if exists ai_usage_ledger_feature;
alter table public.ai_usage_ledger add constraint ai_usage_ledger_feature
  check (feature in ('job_listing_import', 'content_translation', 'job_offer_assist', 'cv_profile_import', 'job_fraud_check', 'candidate_profile_translation', 'job_offer_explain', 'job_search_filters'));

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
  if p_feature is null or p_feature not in ('job_listing_import', 'content_translation', 'job_offer_assist', 'cv_profile_import', 'job_fraud_check', 'candidate_profile_translation', 'job_offer_explain', 'job_search_filters') then
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
