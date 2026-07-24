-- =============================================================================
-- 0055_plan_entitlements.sql
-- Remediacja audytu 2026-07-24 (AUDIT_REPORT) — P1-01: limity i uprawnienia płatnych planów
-- nie były egzekwowane (plany różniły się tylko ceną/copy, nie prawami).
--
-- Naprawa: WERSJONOWANY katalog uprawnień per plan + egzekwowanie w bazie:
--   - plan_entitlements: max_active_jobs (limit aktywnych ofert) + candidate_access (dostęp do
--     bazy kandydatów — egzekwowane przy funkcji CV/sourcingu, batch P1-02);
--   - company_plan(company): efektywny plan z AKTYWNEJ/trialowej subskrypcji, inaczej 'free';
--   - publish_job: przed aktywacją sprawdza limit aktywnych ofert planu (ENTITLEMENT_LIMIT);
--   - get_company_entitlements(company): panel czyta limit + zużycie (członek firmy).
-- Katalog seedowany idempotentnie (on conflict do update) — łatwy do korekty cen/limitów.
-- =============================================================================

create table if not exists public.plan_entitlements (
  plan             text primary key,        -- 'free' | 'starter' | 'standard' | 'pro'
  max_active_jobs  integer not null,        -- limit jednocześnie aktywnych ofert
  candidate_access boolean not null default false, -- dostęp do bazy kandydatów (sourcing/CV)
  updated_at       timestamptz not null default now()
);

alter table public.plan_entitlements enable row level security;
revoke insert, update, delete on public.plan_entitlements from anon, authenticated; -- katalog: zapis SR
drop policy if exists plan_entitlements_select_all on public.plan_entitlements;
create policy plan_entitlements_select_all on public.plan_entitlements
  for select using (true); -- publiczny cennik/limity (nie wrażliwe)

-- Seed katalogu (idempotentny). Limity: patrz CLAUDE.md / AUDIT_REPORT P1-01.
insert into public.plan_entitlements (plan, max_active_jobs, candidate_access) values
  ('free',     1,  false),
  ('starter',  3,  false),
  ('standard', 10, true),
  ('pro',      50, true)
on conflict (plan) do update
  set max_active_jobs = excluded.max_active_jobs,
      candidate_access = excluded.candidate_access,
      updated_at = now();

-- --- company_plan: efektywny plan firmy (aktywna/trialowa subskrypcja lub 'free') -----------
create or replace function public.company_plan(p_company_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.plan from public.subscriptions s
       where s.company_id = p_company_id and s.status in ('active', 'trialing')
       order by s.created_at desc limit 1),
    'free'
  );
$$;
revoke all on function public.company_plan(uuid) from public;
grant execute on function public.company_plan(uuid) to authenticated, service_role;

-- --- company_max_active_jobs: limit ofert dla efektywnego planu (fallback 'free') -----------
create or replace function public.company_max_active_jobs(p_company_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(
    (select pe.max_active_jobs from public.plan_entitlements pe
       where pe.plan = public.company_plan(p_company_id)),
    (select pe.max_active_jobs from public.plan_entitlements pe where pe.plan = 'free'),
    1
  );
$$;
revoke all on function public.company_max_active_jobs(uuid) from public;
grant execute on function public.company_max_active_jobs(uuid) to authenticated, service_role;

-- --- get_company_entitlements: dla panelu (członek firmy) — limit + zużycie -----------------
create or replace function public.get_company_entitlements(p_company_id uuid)
returns table (plan text, max_active_jobs integer, candidate_access boolean, active_jobs_used integer)
language plpgsql stable security definer set search_path = public as $$
declare v_plan text;
begin
  -- Tylko aktywny członek firmy widzi jej plan/limit.
  if not exists (
    select 1 from public.company_members cm
    where cm.company_id = p_company_id and cm.profile_id = auth.uid() and cm.is_active = true
  ) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;

  v_plan := public.company_plan(p_company_id);
  return query
    select v_plan,
           coalesce((select pe.max_active_jobs from public.plan_entitlements pe where pe.plan = v_plan),
                    (select pe.max_active_jobs from public.plan_entitlements pe where pe.plan = 'free'), 1),
           coalesce((select pe.candidate_access from public.plan_entitlements pe where pe.plan = v_plan), false),
           (select count(*)::integer from public.jobs j
              where j.company_id = p_company_id and j.status = 'active' and j.deleted_at is null);
end $$;
revoke all on function public.get_company_entitlements(uuid) from public;
grant execute on function public.get_company_entitlements(uuid) to authenticated;

-- --- publish_job: egzekwowanie limitu aktywnych ofert (P1-01) --------------------------------
-- Wierna kopia z 0042 + guard entitlement PRZED aktywacją (koniec darmowego obchodzenia limitu).
create or replace function public.publish_job(p_job_id uuid, p_slug text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_company uuid; v_cstatus text; v_status text;
  v_title text; v_city text; v_region text; v_slug text; v_new_slug text;
  v_has_translation boolean; v_has_mandatory boolean;
  v_max integer; v_active integer;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  select j.company_id, c.status::text, j.status::text, j.title, j.city, j.region, j.slug
    into v_company, v_cstatus, v_status, v_title, v_city, v_region, v_slug
    from public.jobs j join public.companies c on c.id = j.company_id
    where j.id = p_job_id and j.deleted_at is null;

  if v_company is null then raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002'; end if;
  if not public.can_manage_jobs(v_company) then
    raise exception 'PERMISSION_DENIED: publikacja wymaga roli recruiter+' using errcode = '42501';
  end if;
  if v_cstatus <> 'verified' then
    raise exception 'COMPANY_NOT_VERIFIED: firma nie jest zweryfikowana' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'VALIDATION_FAILED: publikować można tylko szkic' using errcode = '42501';
  end if;

  if v_title is null or btrim(v_title) = '' or v_title ilike 'draft%' or v_title ilike '%placeholder%'
     or v_city is null or btrim(v_city) = ''
     or v_region is null or btrim(v_region) = '' then
    raise exception 'VALIDATION_FAILED: oferta niekompletna (tytuł/miasto/region)' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.job_translations t
    where t.job_id = p_job_id
      and coalesce(btrim(t.title), '') <> ''
      and coalesce(btrim(t.description), '') <> ''
      and coalesce(array_length(t.responsibilities, 1), 0) > 0
  ) into v_has_translation;
  if not v_has_translation then
    raise exception 'VALIDATION_FAILED: oferta niekompletna (opis i obowiązki w tłumaczeniu)'
      using errcode = '42501';
  end if;

  select exists (
    select 1 from public.job_requirements r
    where r.job_id = p_job_id and r.kind = 'mandatory' and coalesce(btrim(r.content), '') <> ''
  ) into v_has_mandatory;
  if not v_has_mandatory then
    raise exception 'VALIDATION_FAILED: brak wymagań obowiązkowych' using errcode = '42501';
  end if;

  -- P1-01: limit aktywnych ofert wg planu (entitlement). Free=1, starter=3, standard=10, pro=50.
  v_max := public.company_max_active_jobs(v_company);
  select count(*) into v_active from public.jobs
    where company_id = v_company and status = 'active' and deleted_at is null;
  if v_active >= v_max then
    raise exception 'ENTITLEMENT_LIMIT: limit aktywnych ofert w planie (%)', v_max using errcode = '42501';
  end if;

  v_new_slug := case
    when v_slug is null or v_slug like 'draft-%'
      then left(coalesce(nullif(btrim(p_slug), ''), 'oferta'), 120)
    else v_slug
  end;

  update public.jobs
    set status = 'active', published_at = now(), slug = v_new_slug
    where id = p_job_id;

  return v_new_slug;
end $$;
revoke all on function public.publish_job(uuid, text) from public;
grant execute on function public.publish_job(uuid, text) to authenticated;
