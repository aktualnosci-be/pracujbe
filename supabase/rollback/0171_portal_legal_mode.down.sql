-- =============================================================================
-- Rollback 0171 — tryb portalu w bazie (#1140, #1143).
-- Uruchamiać ręcznie jako migrator, w jednej transakcji (psql -1 -f …), i dopiero wtedy
-- usunąć wpis z app_migrations.history. Plik celowo BEZ BEGIN/COMMIT
-- (supabase/tests/portal-legal-mode-rollback.sql wykonuje go w transakcji i cofa).
--
-- UWAGA: wycofanie ZDEJMUJE blokadę danych rekrutacyjnych w bazie — po nim jedyną ochroną
-- jest flaga aplikacji `PORTAL_LEGAL_MODE`. Wymaga decyzji właściciela (#1143).
-- Przywraca helpery z 0078/0165/0119/0168 i ops_metrics z 0127 (treść 1:1), usuwa
-- triggery, polityki, RPC i tabelę trybu. Dane procesu bez zmian.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array['applications', 'offers', 'matches', 'conversations', 'messages',
                           'message_attachments', 'application_screening_answers',
                           'guest_application_requests'] loop
    execute format('drop trigger if exists trg_aa_recruitment_mode on public.%I', t);
  end loop;
end $$;
drop trigger if exists trg_aa_recruitment_mode_update on public.applications;
drop trigger if exists trg_aa_recruitment_mode_update on public.offers;

drop policy if exists applications_recruitment_mode on public.applications;
drop policy if exists offers_recruitment_mode on public.offers;
drop policy if exists matches_recruitment_mode on public.matches;
drop policy if exists application_screening_answers_recruitment_mode on public.application_screening_answers;
drop policy if exists application_status_history_recruitment_mode on public.application_status_history;
drop policy if exists offer_status_history_recruitment_mode on public.offer_status_history;
drop policy if exists candidate_profiles_recruitment_mode on public.candidate_profiles;
drop policy if exists candidate_skills_recruitment_mode on public.candidate_skills;
drop policy if exists candidate_languages_recruitment_mode on public.candidate_languages;
drop policy if exists candidate_certificates_recruitment_mode on public.candidate_certificates;

-- 0078
create or replace function public.company_can_view_candidate(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.applications a
    join public.company_members cm on cm.company_id = a.company_id
    where a.candidate_id = p_profile_id
      and a.deleted_at is null
      and cm.profile_id = auth.uid()
      and cm.is_active = true
      and cm.role in ('owner', 'admin', 'recruiter')
      and not public.candidate_blocked_company(p_profile_id, a.company_id)
  ) or exists (
    select 1
    from public.offers o
    join public.company_members cm on cm.company_id = o.company_id
    where o.candidate_id = p_profile_id
      and o.deleted_at is null
      and cm.profile_id = auth.uid()
      and cm.is_active = true
      and cm.role in ('owner', 'admin', 'recruiter')
      and not public.candidate_blocked_company(p_profile_id, o.company_id)
  );
$$;

create or replace function public.candidate_profile_is_searchable(p_candidate_profile_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.candidate_profiles cp
    where cp.id = p_candidate_profile_id
      and cp.is_searchable = true
      and cp.profile_completed = true
      and cp.deleted_at is null
      and not public.candidate_blocks_viewer(cp.profile_id)
  ) and public.current_user_has_verified_company();
$$;

-- 0165
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

-- 0119
create or replace function public.can_attach_in_conversation(p_conversation_id uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid; v_candidate uuid;
begin
  if auth.uid() is null or not public.is_conversation_member(p_conversation_id) then
    return false;
  end if;
  select c.company_id, public.conversation_candidate(c.application_id, c.offer_id)
    into v_company, v_candidate
    from public.conversations c where c.id = p_conversation_id and c.deleted_at is null;
  if not found then return false; end if;
  if v_company is not null and v_candidate is not null
     and auth.uid() is distinct from v_candidate
     and public.candidate_blocked_company(v_candidate, v_company) then
    return false;
  end if;
  return true;
end $$;

-- 0168
create or replace function public.get_job_match_profile(p_job_id uuid)
returns table (
  occupation text,
  category text,
  city text,
  region text,
  remote boolean,
  min_experience_years integer,
  requires_driving_license boolean,
  contract_type text,
  start_immediately boolean,
  skills text[],
  mandatory_skills text[],
  languages text[],
  certificates text[],
  language_requirements jsonb
) language sql stable security definer set search_path = public, pg_temp as $$
  select
    j.occupation,
    j.category::text,
    j.city,
    j.region,
    j.remote,
    j.min_experience_years,
    j.requires_driving_license,
    j.contract_type::text,
    j.start_immediately,
    coalesce(array(select js.skill_label from public.job_skills js
                   where js.job_id = j.id order by js.skill_label), '{}'::text[]),
    coalesce(array(select js.skill_label from public.job_skills js
                   where js.job_id = j.id and js.is_mandatory order by js.skill_label), '{}'::text[]),
    coalesce(array(select jl.language_label from public.job_languages jl
                   where jl.job_id = j.id order by jl.language_label), '{}'::text[]),
    coalesce(array(select jc.certificate_label from public.job_certificates jc
                   where jc.job_id = j.id order by jc.certificate_label), '{}'::text[]),
    coalesce((select jsonb_agg(jsonb_build_object('label', jl.language_label, 'level', jl.level::text,
                                                  'code', lg.code)
                               order by jl.language_label)
              from public.job_languages jl
              left join public.languages lg on lg.id = jl.language_id
             where jl.job_id = j.id), '[]'::jsonb)
  from public.jobs j
  join public.companies c on c.id = j.company_id
  where j.id = p_job_id
    and j.status = 'active'
    and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified'
    and c.deleted_at is null
  limit 1;
$$;

-- 0127
create or replace function public.ops_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_email jsonb;
  v_auth_email jsonb := null;
  v_webhooks jsonb;
  v_maintenance jsonb;
  v_connections jsonb;
  v_mail jsonb;
  v_storage jsonb;
begin
  select jsonb_build_object(
    'ready', count(*) filter (where status = 'queued' and next_attempt_at <= now()),
    'oldestReadyAgeSeconds', coalesce(floor(extract(epoch from now() - min(next_attempt_at)
      filter (where status = 'queued' and next_attempt_at <= now())))::bigint, 0),
    'abandonedLeases', count(*) filter (where status = 'queued' and locked_at is not null
      and locked_at < now() - interval '300 seconds'),
    'failedLast24h', count(*) filter (where status = 'failed' and updated_at > now() - interval '24 hours')
  ) into v_email
  from public.email_deliveries
  where status in ('queued', 'failed');

  if to_regclass('auth.email_outbox') is not null then
    execute $q$
      select jsonb_build_object(
        'ready', count(*) filter (where status = 'queued' and next_attempt_at <= now()),
        'oldestReadyAgeSeconds', coalesce(floor(extract(epoch from now() - min(next_attempt_at)
          filter (where status = 'queued' and next_attempt_at <= now())))::bigint, 0),
        'abandonedLeases', count(*) filter (where status = 'leased' and lease_expires_at < now()),
        'failedLast24h', count(*) filter (where status = 'failed' and created_at > now() - interval '24 hours'))
      from auth.email_outbox where status in ('queued', 'leased', 'failed')
    $q$ into v_auth_email;
  end if;

  select jsonb_build_object(
    'stuckProcessing', count(*) filter (where status = 'processing' and updated_at < now() - interval '15 minutes'),
    'failedLast24h', count(*) filter (where status = 'failed' and updated_at > now() - interval '24 hours')
  ) into v_webhooks
  from public.processed_webhooks
  where status in ('processing', 'failed');

  select jsonb_build_object(
    'overdueActiveJobs', (select count(*) from public.jobs
      where status = 'active' and expires_at is not null and expires_at <= now() - interval '2 hours'),
    'staleDiscountReservations', (select count(*) from public.discount_redemptions
      where status = 'reserved' and created_at < now() - interval '26 hours'),
    'staleCheckoutIntents', (select count(*) from public.checkout_intents
      where status = 'pending' and created_at < now() - interval '150 minutes')
  ) into v_maintenance;

  select jsonb_build_object(
    'used', (select count(*) from pg_stat_activity where backend_type = 'client backend'),
    'max', current_setting('max_connections')::integer,
    'reserved', current_setting('superuser_reserved_connections')::integer
  ) into v_connections;

  -- #44: jakość doręczeń. Kohorta = listy przyjęte przez dostawcę (sent_at) w oknie;
  -- odbicie trwałe (bounce_type = 'permanent') i skarga liczone dla tej samej kohorty,
  -- niezależnie od tego, kiedy przyszło zdarzenie. Okno bazowe = 7 dób przed bieżącą
  -- dobą (wzrost odsetka porównuje aplikacja). Progi i minimalna próba — w aplikacji.
  select jsonb_build_object(
    'sentLast24h', count(*) filter (where sent_at > now() - interval '24 hours'),
    'hardBouncesLast24h', count(*) filter (where sent_at > now() - interval '24 hours'
      and bounce_type = 'permanent'),
    'complaintsLast24h', count(*) filter (where sent_at > now() - interval '24 hours'
      and complained_at is not null),
    'sentBaseline7d', count(*) filter (where sent_at <= now() - interval '24 hours'),
    'hardBouncesBaseline7d', count(*) filter (where sent_at <= now() - interval '24 hours'
      and bounce_type = 'permanent'),
    'complaintsBaseline7d', count(*) filter (where sent_at <= now() - interval '24 hours'
      and complained_at is not null),
    'activeSuppressions', (select count(*) from public.email_suppressions where lifted_at is null),
    'newSuppressionsLast24h', (select count(*) from public.email_suppressions
      where created_at > now() - interval '24 hours')
  ) into v_mail
  from public.email_deliveries
  where sent_at > now() - interval '8 days';

  -- #574: obiekty czekające na fizyczne usunięcie (wiek od usunięcia wiersza) i dead-letter.
  select jsonb_build_object(
    'pending', count(*) filter (where dead_lettered_at is null),
    'oldestPendingAgeSeconds', coalesce(floor(extract(epoch from now() - min(created_at)
      filter (where dead_lettered_at is null)))::bigint, 0),
    'deadLetters', count(*) filter (where dead_lettered_at is not null)
  ) into v_storage
  from public.storage_deletion_queue;

  return jsonb_build_object(
    'email', v_email,
    'authEmail', v_auth_email,
    'webhooks', v_webhooks,
    'maintenance', v_maintenance,
    'connections', v_connections,
    'mail', v_mail,
    'storageDeletion', v_storage
  );
end $$;
revoke all on function public.ops_metrics() from public, anon, authenticated;
grant execute on function public.ops_metrics() to pracujbe_ops, service_role;

drop function if exists public.admin_set_portal_legal_mode(text, text, text);
drop table if exists public.portal_legal_mode;
drop function if exists public.guard_portal_legal_mode_write();
drop function if exists public.enforce_recruitment_insert();
drop function if exists public.enforce_recruitment_application_update();
drop function if exists public.enforce_recruitment_offer_update();
drop function if exists public.recruitment_write_allowed();
drop function if exists public.assert_recruitment_enabled();
drop function if exists public.recruitment_enabled();
