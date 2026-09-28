-- =============================================================================
-- Rollback 0174 — tryb ogłoszeniowy: wiadomości i CV (#1134, #1138).
-- Uruchamiać ręcznie jako migrator, w jednej transakcji (psql -1 -f …), i dopiero wtedy
-- usunąć wpis z app_migrations.history. Plik celowo BEZ BEGIN/COMMIT.
-- Przywraca `email_delivery_suppression_reason` z 0124 (treść 1:1), usuwa strażnika plików CV
-- i nakładkę `apply_candidate_cv_proposals` (treść z 0115 wraca pod swoją nazwę).
-- =============================================================================

drop trigger if exists trg_aa_recruitment_mode_cv on public.files;
drop function if exists public.enforce_recruitment_cv_file();

drop function if exists public.apply_candidate_cv_proposals(text[], text[], jsonb, text[], integer);
alter function public.apply_candidate_cv_proposals_impl(text[], text[], jsonb, text[], integer)
  rename to apply_candidate_cv_proposals;
revoke all on function public.apply_candidate_cv_proposals(text[], text[], jsonb, text[], integer) from public, anon;
grant execute on function public.apply_candidate_cv_proposals(text[], text[], jsonb, text[], integer) to authenticated;

create or replace function public.email_delivery_suppression_reason(
  p_profile_id uuid,
  p_template text,
  p_to_email text,
  p_campaign_id uuid,
  p_entity_type text,
  p_entity_id uuid
) returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when public.email_address_suppressed(p_to_email) then 'suppressed_address'
    when public.email_allowed(p_profile_id, p_template) is not true then 'suppressed_opt_out'
    -- 0122 (#503): odbiorca firmowy musi nadal być aktywnym recruiter+ w chwili claimu/wysyłki.
    when public.email_recipient_authorized(p_template, p_entity_type, p_entity_id, p_profile_id)
           is not true then 'suppressed_recipient_unauthorized'
    when p_template = 'jobMatch' and p_entity_type = 'saved_search' and not exists (
           select 1 from public.saved_searches s
            where s.id = p_entity_id
              and s.profile_id is not distinct from p_profile_id
              and s.alerts_enabled) then 'suppressed_alert_disabled'
    when p_campaign_id is not null and not exists (
           select 1 from public.email_campaigns c
            where c.id = p_campaign_id and c.status in ('active', 'completed'))
      then 'suppressed_campaign_inactive'
    else null
  end;
$$;
revoke all on function public.email_delivery_suppression_reason(uuid, text, text, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.email_delivery_suppression_reason(uuid, text, text, uuid, text, uuid)
  to service_role;
