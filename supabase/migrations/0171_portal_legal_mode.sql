-- =============================================================================
-- 0171 — tryb portalu w bazie (#1140, #1143; epik #1128).
--
-- Decyzja produktowa: portal ogłoszeniowy. Funkcje rekrutacyjne (aplikacje, aplikacje
-- gości, propozycje, pytania screeningowe, dopasowania, wyszukiwanie profili przez firmy,
-- wiadomości i załączniki) są wyłączone. Baza sama odrzuca NOWE dane procesu rekrutacyjnego,
-- niezależnie od ścieżki wywołania (server action, RPC pod sesją, service_role, stary deploy,
-- pominięta flaga aplikacji). Tabele i funkcje zostają (bez DROP) — są tylko wyłączone.
--
-- 1. `portal_legal_mode` — jeden wiersz: `CLASSIFIEDS_ONLY` (domyślnie) albo `RECRUITMENT`,
--    kto/kiedy/dlaczego zmienił. RLS bez polityk (deny), brak grantów dla klientów.
-- 2. `recruitment_enabled()` — `true` WYŁĄCZNIE przy `mode = 'RECRUITMENT'`; brak wiersza
--    albo błąd odczytu = `false` (fail-closed). `assert_recruitment_enabled()` rzuca
--    `RECRUITMENT_DISABLED`.
-- 3. Zapis (druga linia obrony, także dla service_role i migracji danych):
--    * BEFORE INSERT na `applications`, `offers`, `matches`, `conversations`, `messages`,
--      `message_attachments`, `application_screening_answers`, `guest_application_requests`
--      → `RECRUITMENT_DISABLED`. Każde RPC procesu pisze do co najmniej jednej z tych tabel
--      (apply_to_job, submit/confirm_guest_application, send_offer, record_screening_answers,
--      get_or_create_conversation, send_message, stage_message_attachment,
--      match_recompute_apply), więc całe wywołanie jest wycofywane i nie zostaje żaden wiersz
--      (także powiadomienia i kolejka e-mail z tej samej transakcji). Strażnik na tabeli nie
--      znika, gdy późniejsza migracja podmieni treść RPC przez CREATE OR REPLACE.
--    * BEFORE UPDATE na `applications`: zmiana statusu (transition_application,
--      respond_to_offer) i przejęcie aplikacji gościa (claim_guest_application,
--      candidate_id NULL → konto) odrzucone. Wyjątek (propozycja do akceptacji właściciela):
--      kandydat może WYCOFAĆ istniejącą aplikację (status → withdrawn).
--    * BEFORE UPDATE na `offers`: odpowiedź na propozycję (accepted/declined) odrzucona.
--    * Wyjątek dla seedu demo i testów: `set_config('pracujbe.allow_recruitment_write',
--      'on', true)` — uwzględniany TYLKO, gdy `session_user` jest superuserem (migrator/seed),
--      nigdy dla loginów aplikacji.
-- 4. Odczyt dla firm w trybie ogłoszeniowym (kandydat nadal widzi własną historię):
--    * polityki RESTRICTIVE (AND z istniejącymi) na `applications`, `offers`, `matches`,
--      `application_screening_answers`, `application_status_history`,
--      `offer_status_history`, `candidate_profiles`, `candidate_skills`,
--      `candidate_languages`, `candidate_certificates`;
--    * `company_can_view_candidate` i `candidate_profile_is_searchable` = false (profile
--      i kontakt z `profiles`);
--    * `is_conversation_member` (ostatnio 0165): strona firmowa traci dostęp do rozmów,
--      kandydat relacji zachowuje odczyt (RLS rozmów/wiadomości, get_conversation_summaries,
--      send_message, oznaczanie przeczytanych); nowych wiadomości nie wyśle (trigger);
--    * `can_attach_in_conversation` (0119) = false; `get_job_match_profile` (0168) = brak
--      wiersza (karta dopasowania się nie pokazuje).
-- 5. `admin_set_portal_legal_mode(p_mode, p_reason, p_expected_mode)` (#1143) — jedyna droga
--    zmiany trybu: tylko service_role (bez EXECUTE dla authenticated/anon, bez panelu),
--    uzasadnienie 1–1000 znaków, CAS po `p_expected_mode` (`STALE_STATE`), audyt
--    `portal_legal_mode.changed`. Bezpośredni INSERT/UPDATE/DELETE/TRUNCATE wiersza (także
--    jako service_role) blokuje trigger — przepuszcza tylko lokalny znacznik ustawiany przez
--    RPC (`pracujbe.portal_legal_mode_rpc`). Tryb efektywny aplikacji = env
--    `PORTAL_LEGAL_MODE=RECRUITMENT` ORAZ `recruitment_enabled()` w bazie (#1136).
-- 6. `ops_metrics()` (ostatnio 0127) + sekcja `portalLegalMode.recruitmentEnabled` (0/1) —
--    czujka `portal_legal_mode_mismatch` w `/api/health/ops` porównuje ją z env.
--
-- Rollback: supabase/rollback/0171_portal_legal_mode.down.sql. Migracja nie zmienia danych
-- procesu (portal nie ma danych produkcyjnych, #1150: tylko blokada nowych danych).
-- =============================================================================

-- --- 1. Tryb jako dane ---------------------------------------------------------------------
create table if not exists public.portal_legal_mode (
  id         boolean primary key default true check (id),
  mode       text not null default 'CLASSIFIEDS_ONLY' check (mode in ('CLASSIFIEDS_ONLY', 'RECRUITMENT')),
  reason     text check (reason is null or char_length(reason) <= 1000),
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles(id) on delete set null
);
insert into public.portal_legal_mode (id, mode, reason)
  values (true, 'CLASSIFIEDS_ONLY', 'Decyzja produktowa: portal ogłoszeniowy (#1128).')
  on conflict (id) do nothing;

alter table public.portal_legal_mode enable row level security;
alter table public.portal_legal_mode force row level security;
revoke all on public.portal_legal_mode from public, anon, authenticated;

create or replace function public.recruitment_enabled()
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce((select m.mode = 'RECRUITMENT' from public.portal_legal_mode m where m.id), false);
exception when others then
  return false;
end $$;
revoke all on function public.recruitment_enabled() from public;
-- Wołana w politykach RLS (prawa wywołującego) — EXECUTE dla wszystkich ról klienta.
grant execute on function public.recruitment_enabled() to anon, authenticated, service_role, pracujbe_ops;

create or replace function public.assert_recruitment_enabled()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.recruitment_enabled() then
    raise exception 'RECRUITMENT_DISABLED' using errcode = '42501';
  end if;
end $$;
revoke all on function public.assert_recruitment_enabled() from public;
grant execute on function public.assert_recruitment_enabled() to anon, authenticated, service_role;

-- Zapis danych procesu: tryb RECRUITMENT albo jawny wyjątek seedu/testów superusera.
create or replace function public.recruitment_write_allowed()
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if public.recruitment_enabled() then return true; end if;
  return coalesce(current_setting('pracujbe.allow_recruitment_write', true), '') = 'on'
     and exists (select 1 from pg_catalog.pg_roles r where r.rolname = session_user and r.rolsuper);
end $$;
revoke all on function public.recruitment_write_allowed() from public, anon, authenticated;

-- --- 2. Strażnik zapisu -----------------------------------------------------------------------
create or replace function public.enforce_recruitment_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.recruitment_write_allowed() then
    raise exception 'RECRUITMENT_DISABLED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.enforce_recruitment_insert() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['applications', 'offers', 'matches', 'conversations', 'messages',
                           'message_attachments', 'application_screening_answers',
                           'guest_application_requests'] loop
    -- Nazwa `trg_aa_*`: BEFORE-triggery tej samej tabeli idą alfabetycznie — strażnik pierwszy.
    execute format('drop trigger if exists trg_aa_recruitment_mode on public.%I', t);
    execute format('create trigger trg_aa_recruitment_mode before insert on public.%I
                    for each row execute function public.enforce_recruitment_insert()', t);
  end loop;
end $$;

create or replace function public.enforce_recruitment_application_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.recruitment_write_allowed() then return new; end if;
  -- Wycofanie istniejącej aplikacji przez kandydata zostaje (decyzja do akceptacji właściciela).
  if (new.status is distinct from old.status and new.status <> 'withdrawn')
     or (old.candidate_id is null and new.candidate_id is not null) then
    raise exception 'RECRUITMENT_DISABLED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.enforce_recruitment_application_update() from public, anon, authenticated;
drop trigger if exists trg_aa_recruitment_mode_update on public.applications;
create trigger trg_aa_recruitment_mode_update before update on public.applications
  for each row execute function public.enforce_recruitment_application_update();

create or replace function public.enforce_recruitment_offer_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.recruitment_write_allowed() then return new; end if;
  if new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    raise exception 'RECRUITMENT_DISABLED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.enforce_recruitment_offer_update() from public, anon, authenticated;
drop trigger if exists trg_aa_recruitment_mode_update on public.offers;
create trigger trg_aa_recruitment_mode_update before update on public.offers
  for each row execute function public.enforce_recruitment_offer_update();

-- --- 3. Odczyt dla firm: polityki RESTRICTIVE (kandydat widzi własne) ---------------------------
-- `(select …)` = jedno wyliczenie na zapytanie (initplan), nie na wiersz.
drop policy if exists applications_recruitment_mode on public.applications;
create policy applications_recruitment_mode on public.applications
  as restrictive for select to authenticated
  using ((select public.recruitment_enabled()) or candidate_id = auth.uid());

drop policy if exists offers_recruitment_mode on public.offers;
create policy offers_recruitment_mode on public.offers
  as restrictive for select to authenticated
  using ((select public.recruitment_enabled()) or candidate_id = auth.uid());

drop policy if exists matches_recruitment_mode on public.matches;
create policy matches_recruitment_mode on public.matches
  as restrictive for select to authenticated
  using ((select public.recruitment_enabled()) or candidate_id = auth.uid());

drop policy if exists application_screening_answers_recruitment_mode on public.application_screening_answers;
create policy application_screening_answers_recruitment_mode on public.application_screening_answers
  as restrictive for select to authenticated
  using ((select public.recruitment_enabled()) or exists (
    select 1 from public.applications a
     where a.id = application_screening_answers.application_id and a.candidate_id = auth.uid()));

drop policy if exists application_status_history_recruitment_mode on public.application_status_history;
create policy application_status_history_recruitment_mode on public.application_status_history
  as restrictive for select to authenticated
  using ((select public.recruitment_enabled()) or exists (
    select 1 from public.applications a
     where a.id = application_status_history.application_id and a.candidate_id = auth.uid()));

drop policy if exists offer_status_history_recruitment_mode on public.offer_status_history;
create policy offer_status_history_recruitment_mode on public.offer_status_history
  as restrictive for select to authenticated
  using ((select public.recruitment_enabled()) or exists (
    select 1 from public.offers o
     where o.id = offer_status_history.offer_id and o.candidate_id = auth.uid()));

drop policy if exists candidate_profiles_recruitment_mode on public.candidate_profiles;
create policy candidate_profiles_recruitment_mode on public.candidate_profiles
  as restrictive for select to authenticated
  using ((select public.recruitment_enabled()) or profile_id = auth.uid());

drop policy if exists candidate_skills_recruitment_mode on public.candidate_skills;
create policy candidate_skills_recruitment_mode on public.candidate_skills
  as restrictive for select to authenticated
  using ((select public.recruitment_enabled()) or public.owns_candidate_profile(candidate_profile_id));

drop policy if exists candidate_languages_recruitment_mode on public.candidate_languages;
create policy candidate_languages_recruitment_mode on public.candidate_languages
  as restrictive for select to authenticated
  using ((select public.recruitment_enabled()) or public.owns_candidate_profile(candidate_profile_id));

drop policy if exists candidate_certificates_recruitment_mode on public.candidate_certificates;
create policy candidate_certificates_recruitment_mode on public.candidate_certificates
  as restrictive for select to authenticated
  using ((select public.recruitment_enabled()) or public.owns_candidate_profile(candidate_profile_id));

-- --- 4. Helpery dostępu firm (treść z 0078/0165/0119/0168 + warunek trybu) ---------------------
-- 0078 + tryb: relacja aplikacja/propozycja nie daje firmie profilu ani kontaktu.
create or replace function public.company_can_view_candidate(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.recruitment_enabled() and (exists (
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
  ));
$$;

-- 0078 + tryb: wyszukiwanie profili przez firmy wyłączone.
create or replace function public.candidate_profile_is_searchable(p_candidate_profile_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.recruitment_enabled() and exists (
    select 1
    from public.candidate_profiles cp
    where cp.id = p_candidate_profile_id
      and cp.is_searchable = true
      and cp.profile_completed = true
      and cp.deleted_at is null
      and not public.candidate_blocks_viewer(cp.profile_id)
  ) and public.current_user_has_verified_company();
$$;

-- 0165 + tryb: strona firmowa bez dostępu do rozmów; kandydat relacji zachowuje odczyt.
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
      and (
        public.recruitment_enabled()
        or m.profile_id = public.conversation_candidate(c.application_id, c.offer_id)
      )
  );
$$;

-- 0119 + tryb: brak uploadu załączników (przed zapisem obiektu w buckecie).
create or replace function public.can_attach_in_conversation(p_conversation_id uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid; v_candidate uuid;
begin
  if not public.recruitment_enabled() then
    return false;
  end if;
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

-- 0168 + tryb: bez profilu dopasowania (karta dopasowania na szczególe oferty znika).
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
    and public.recruitment_enabled()
    and j.status = 'active'
    and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified'
    and c.deleted_at is null
  limit 1;
$$;

-- --- 5. Zmiana trybu (#1143): tylko service_role, uzasadnienie, CAS, audyt ------------------------
create or replace function public.guard_portal_legal_mode_write()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('pracujbe.portal_legal_mode_rpc', true), '') <> 'on' then
    raise exception 'PERMISSION_DENIED: tryb portalu zmienia tylko admin_set_portal_legal_mode'
      using errcode = '42501';
  end if;
  return case tg_op when 'DELETE' then old when 'TRUNCATE' then null else new end;
end $$;
revoke all on function public.guard_portal_legal_mode_write() from public, anon, authenticated;
drop trigger if exists trg_portal_legal_mode_guard on public.portal_legal_mode;
create trigger trg_portal_legal_mode_guard before insert or update or delete on public.portal_legal_mode
  for each row execute function public.guard_portal_legal_mode_write();
drop trigger if exists trg_portal_legal_mode_guard_truncate on public.portal_legal_mode;
create trigger trg_portal_legal_mode_guard_truncate before truncate on public.portal_legal_mode
  for each statement execute function public.guard_portal_legal_mode_write();

create or replace function public.admin_set_portal_legal_mode(
  p_mode          text,
  p_reason        text,
  p_expected_mode text
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_current text;
begin
  if p_mode is null or p_mode not in ('CLASSIFIEDS_ONLY', 'RECRUITMENT')
     or p_expected_mode is null or p_expected_mode not in ('CLASSIFIEDS_ONLY', 'RECRUITMENT')
     or v_reason is null or char_length(v_reason) > 1000 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  -- Brak wiersza = tryb ogłoszeniowy (jak recruitment_enabled()).
  select m.mode into v_current from public.portal_legal_mode m where m.id for update;
  if coalesce(v_current, 'CLASSIFIEDS_ONLY') <> p_expected_mode then
    raise exception 'STALE_STATE' using errcode = '40001';
  end if;

  perform set_config('pracujbe.portal_legal_mode_rpc', 'on', true);
  insert into public.portal_legal_mode (id, mode, reason, changed_at, changed_by)
    values (true, p_mode, v_reason, now(), auth.uid())
    on conflict (id) do update
      set mode = excluded.mode, reason = excluded.reason,
          changed_at = excluded.changed_at, changed_by = excluded.changed_by;
  perform set_config('pracujbe.portal_legal_mode_rpc', '', true);

  perform public.write_audit('portal_legal_mode.changed', 'portal_legal_mode', null,
    jsonb_build_object('mode', coalesce(v_current, 'CLASSIFIEDS_ONLY'), 'row_present', v_current is not null),
    jsonb_build_object('mode', p_mode, 'reason', v_reason));
  return p_mode;
end $$;
revoke all on function public.admin_set_portal_legal_mode(text, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_portal_legal_mode(text, text, text) to service_role;

-- --- 6. ops_metrics (0127) + tryb portalu --------------------------------------------------------
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
    'storageDeletion', v_storage,
    -- #1143: sam tryb bazy (1 = RECRUITMENT); porównanie z env robi czujka w aplikacji.
    'portalLegalMode', jsonb_build_object(
      'recruitmentEnabled', case when public.recruitment_enabled() then 1 else 0 end)
  );
end $$;
revoke all on function public.ops_metrics() from public, anon, authenticated;
grant execute on function public.ops_metrics() to pracujbe_ops, service_role;
