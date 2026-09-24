-- =============================================================================
-- 0105_data_retention_rights.sql — #486: retencja danych kandydata, prawo dostępu
-- (eksport JSON) i usunięcie konta, kolejka usuwania obiektów storage oraz rejestr
-- usunięć („tombstone”) do ponownego zastosowania po odtworzeniu kopii.
--
--
-- 1. retention_policies — okresy retencji jako DANE (klucz → interval; null = zadanie
--    wyłączone). Wartości domyślne obejmują tylko sprzątanie techniczne (rekordy już
--    oznaczone jako usunięte). Okresy wymagające decyzji administratora danych startują
--    jako null — patrz docs/legal-drafts/retencja-i-prawa-kandydata.md (PROJEKT).
--    `confirmed_guest_request` to wyłącznie wartość do decyzji właściciela — żadne zadanie
--    jej nie używa; tokeny/linki zgłoszeń gościa czyści purge_guest_application_requests
--    (0095 i osobna zmiana #522), nie ta migracja.
--    Zmiana wyłącznie przez admin_set_retention_policy (is_admin, audyt).
-- 2. data_rights_requests — ślad obsługi wniosku (rodzaj, termin art. 12(3), liczniki),
--    BEZ treści danych i bez FK do profilu, żeby przetrwał usunięcie konta. Kandydat
--    czyta własne wiersze pod RLS; zapis tylko przez funkcje.
-- 3. erasure_tombstones — UUID usuniętych osób (bez e-maila i innych danych). Po
--    odtworzeniu starszej kopii apply_erasure_tombstones usuwa je ponownie
--    (scripts/db/restore-backup.sh, RESTORE_TOMBSTONES_FILE).
-- 4. storage_deletion_queue — obiekt storage do usunięcia po skasowaniu wiersza files
--    (trigger AFTER DELETE — niezależnie od ścieżki usunięcia). Worker w /api/maintenance
--    bierze partię claim_storage_deletions (SKIP LOCKED, dzierżawa) i raportuje wynik
--    complete_storage_deletion (ponowienie z backoffem; sukces usuwa wiersz kolejki).
-- 5. erase_candidate_subject — jedno źródło pełnego usunięcia kandydata: dane procesu
--    widoczne dla firm (aplikacje, propozycje, rozmowy, powiadomienia i e-maile o nich),
--    pliki (→ kolejka storage), zgłoszenie bez konta, konto auth (kaskada FK), tombstone.
--    Sprawy DSA zostają (obowiązek rozpatrzenia), tracą tylko powiązanie z kontem.
-- 6. request_account_erasure(email) — samoobsługowe usunięcie konta kandydata;
--    potwierdzenie = adres e-mail konta wpisany ponownie. Dostęp odcięty w tej samej
--    transakcji (profil i konto auth znikają), storage asynchronicznie z ponowieniami.
-- 7. export_my_data() — prawo dostępu: dane podane (profil, relacje, pliki — metadane),
--    dane procesu (aplikacje, historia, odpowiedzi screeningowe, propozycje, wiadomości),
--    dane pochodne (istniejące wyniki `matches` — nie liczymy nowych), zgody, preferencje,
--    blokady, zapisane wyszukiwania, powiadomienia, e-maile (bez treści), wnioski.
--    Cudze dane: identyfikatory i nazwiska rekruterów pomijane; wiadomość ma tylko
--    stronę (`fromMe`). Limit 10 eksportów na dobę.
-- 8. run_retention_purge(limit) — zadanie /api/maintenance (service_role): każda
--    kategoria z retention_policies, ograniczona partia, SKIP LOCKED, liczniki.
-- 9. apply_erasure_tombstones(uuid[]) — ponowne usunięcie po restore (service_role).
-- 10. report_events_append_only i reports_guard (0076) — dopuszczają wyłącznie odwołanie
--     FK → null (ON DELETE SET NULL: actor_id, reporter_id, resolved_by); wcześniej
--     usunięcie konta autora zgłoszenia lub zdarzenia DSA się wywracało.
--
-- Rollback: drop funkcji z pkt 5–9 i admin_set_retention_policy, triggera
-- trg_files_queue_storage_deletion, tabel storage_deletion_queue, erasure_tombstones,
-- data_rights_requests, retention_policies; report_events_append_only z 0094,
-- reports_guard z 0076.
-- Migracja nie zmienia istniejących danych.
-- =============================================================================

-- --- 1. Okresy retencji ------------------------------------------------------------
create table if not exists public.retention_policies (
  key         text primary key check (key ~ '^[a-z_]{3,60}$'),
  period      interval check (period is null or (period >= interval '1 day' and period <= interval '3650 days')),
  description text not null check (char_length(description) <= 300),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);
comment on table public.retention_policies is
  '#486: okres retencji na kategorię; null = zadanie wyłączone do decyzji administratora danych.';

insert into public.retention_policies (key, period, description) values
  ('deleted_file', interval '30 days',
   'Plik oznaczony jako usunięty (deleted_at): trwałe usunięcie wiersza files i obiektu storage.'),
  ('deleted_profile', interval '30 days',
   'Profil kandydata oznaczony jako usunięty (deleted_at): pełne usunięcie konta i danych procesu.'),
  ('closed_application', null,
   'Aplikacja w stanie końcowym (rejected, withdrawn, offer_declined) od ostatniej zmiany.'),
  ('inactive_candidate_cv', null,
   'CV kandydata bez aktywności konta (last_seen_at): oznaczenie pliku jako usuniętego.'),
  ('confirmed_guest_request', null,
   'Minimalny ślad potwierdzonego zgłoszenia bez konta: cel i okres do decyzji właściciela; bez zadania automatycznego.'),
  ('data_rights_request_log', null,
   'Ślad obsługi wniosku o dostęp/usunięcie (bez treści danych).'),
  ('erasure_tombstone', null,
   'Rejestr usunięć do ponownego zastosowania po restore; musi przekraczać retencję kopii.')
on conflict (key) do nothing;

alter table public.retention_policies enable row level security;
alter table public.retention_policies force row level security;
revoke all on public.retention_policies from public, anon, authenticated;

-- --- 2. Ślad obsługi wniosków ---------------------------------------------------------
create table if not exists public.data_rights_requests (
  id           uuid primary key default gen_random_uuid(),
  subject_id   uuid not null,
  kind         text not null check (kind in ('access', 'erasure')),
  channel      text not null check (channel in ('self_service', 'retention', 'restore_reapply')),
  status       text not null default 'completed' check (status in ('completed')),
  requested_at timestamptz not null default now(),
  due_at       timestamptz not null,
  completed_at timestamptz,
  details      jsonb not null default '{}'::jsonb
                 check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 2048)
);
comment on table public.data_rights_requests is
  '#486: ślad obsługi wniosku (art. 12 RODO) bez treści danych; bez FK — przetrwa usunięcie konta.';
create index if not exists idx_data_rights_requests_subject
  on public.data_rights_requests (subject_id, requested_at desc);

alter table public.data_rights_requests enable row level security;
alter table public.data_rights_requests force row level security;
revoke all on public.data_rights_requests from public, anon, authenticated;
grant select on public.data_rights_requests to authenticated;
drop policy if exists data_rights_requests_select_own on public.data_rights_requests;
create policy data_rights_requests_select_own on public.data_rights_requests
  for select to authenticated using (subject_id = auth.uid());

-- --- 3. Rejestr usunięć -----------------------------------------------------------------
create table if not exists public.erasure_tombstones (
  subject_id   uuid primary key,
  request_id   uuid references public.data_rights_requests(id) on delete set null,
  channel      text not null check (channel in ('self_service', 'retention', 'restore_reapply')),
  erased_at    timestamptz not null default now(),
  reapplied_at timestamptz
);
comment on table public.erasure_tombstones is
  '#486: UUID usuniętych kandydatów (bez innych danych) — ponowne usunięcie po odtworzeniu kopii.';

alter table public.erasure_tombstones enable row level security;
alter table public.erasure_tombstones force row level security;
revoke all on public.erasure_tombstones from public, anon, authenticated;

-- --- 4. Kolejka usuwania obiektów storage -------------------------------------------------
create table if not exists public.storage_deletion_queue (
  id              uuid primary key default gen_random_uuid(),
  bucket          text not null check (char_length(bucket) between 1 and 100),
  path            text not null check (char_length(path) between 1 and 500),
  attempts        integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until    timestamptz,
  last_error      text check (last_error is null or char_length(last_error) <= 40),
  created_at      timestamptz not null default now(),
  unique (bucket, path)
);
create index if not exists idx_storage_deletion_queue_due
  on public.storage_deletion_queue (next_attempt_at);

alter table public.storage_deletion_queue enable row level security;
alter table public.storage_deletion_queue force row level security;
revoke all on public.storage_deletion_queue from public, anon, authenticated;

create or replace function public.queue_storage_deletion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.storage_deletion_queue (bucket, path)
  values (old.bucket, old.path)
  on conflict (bucket, path) do update
    set next_attempt_at = now(), locked_until = null, attempts = 0, last_error = null;
  return old;
end $$;
revoke all on function public.queue_storage_deletion() from public, anon, authenticated;

drop trigger if exists trg_files_queue_storage_deletion on public.files;
create trigger trg_files_queue_storage_deletion
  after delete on public.files
  for each row execute function public.queue_storage_deletion();

-- Partia dla workera. Obiekt, który znów ma wiersz files (ponowne użycie ścieżki),
-- wypada z kolejki zamiast zostać skasowany.
create or replace function public.claim_storage_deletions(p_limit integer default 50)
returns table (id uuid, bucket text, path text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.storage_deletion_queue q
   where exists (select 1 from public.files f where f.bucket = q.bucket and f.path = q.path);
  return query
  with due as (
    select q.id from public.storage_deletion_queue q
     where q.next_attempt_at <= now()
       and (q.locked_until is null or q.locked_until < now())
       and q.attempts < 20
     order by q.next_attempt_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked
  )
  update public.storage_deletion_queue q
     set locked_until = now() + interval '5 minutes', attempts = q.attempts + 1
    from due where q.id = due.id
  returning q.id, q.bucket, q.path;
end $$;
revoke all on function public.claim_storage_deletions(integer) from public, anon, authenticated;
grant execute on function public.claim_storage_deletions(integer) to service_role;

create or replace function public.complete_storage_deletion(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_ok then
    delete from public.storage_deletion_queue where id = p_id;
  else
    update public.storage_deletion_queue
       set locked_until = null,
           last_error = left(coalesce(nullif(p_error, ''), 'unknown'), 40),
           next_attempt_at = now() + least(interval '1 day', interval '1 minute' * power(2, least(attempts, 12)))
     where id = p_id;
  end if;
end $$;
revoke all on function public.complete_storage_deletion(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.complete_storage_deletion(uuid, boolean, text) to service_role;

-- --- 10. Historia DSA: odwołanie autora przez ON DELETE SET NULL ----------------------------
create or replace function public.report_events_append_only()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Usunięcie przez kaskadę FK (pg_trigger_depth > 1) jest dozwolone; sprawy DSA i tak
  -- nie da się usunąć (reports_notice_immutable).
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  -- #486: jedyna dozwolona zmiana to actor_id → null (usunięcie konta autora zdarzenia).
  -- Ten sam trigger chroni też dsa_retention_runs (0104) — tabela bez actor_id: wyjątek jej nie dotyczy.
  if tg_op = 'UPDATE' and to_jsonb(old) ? 'actor_id' and to_jsonb(new)->>'actor_id' is null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;
  raise exception 'PERMISSION_DENIED: historia sprawy jest tylko do dopisywania' using errcode = '42501';
end $$;

-- 0076 bez zmian poza pierwszym warunkiem UPDATE: odwołanie konta (FK → null) przechodzi
-- także pod sesją usuwanego użytkownika (samoobsługowe usunięcie konta).
create or replace function public.reports_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array['reporter_id', 'resolved_by', 'updated_at'])
         = (to_jsonb(old) - array['reporter_id', 'resolved_by', 'updated_at'])
     and (new.reporter_id is null or new.reporter_id = old.reporter_id)
     and (new.resolved_by is null or new.resolved_by = old.resolved_by) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.reporter_id := auth.uid();
    new.status := 'open';
    new.resolved_by := null;
    new.resolved_at := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if not public.is_admin() then
    raise exception 'PERMISSION_DENIED: zgłoszenie zmienia tylko administrator'
      using errcode = '42501';
  end if;
  if new.reporter_id is distinct from old.reporter_id
     or new.target_type is distinct from old.target_type
     or new.target_id is distinct from old.target_id
     or new.reason is distinct from old.reason
     or new.details is distinct from old.details
     or new.created_at is distinct from old.created_at then
    raise exception 'PERMISSION_DENIED: treść zgłoszenia jest niezmienna'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.reports_guard() from public;

-- --- 5. Pełne usunięcie kandydata ---------------------------------------------------------
-- Funkcja wewnętrzna (bez EXECUTE dla ról klienta). Zwraca liczniki (bez treści).
create or replace function public.erase_candidate_subject(p_subject uuid, p_channel text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role    public.user_role;
  v_email   text;
  v_apps    uuid[];
  v_offers  uuid[];
  v_convs   uuid[];
  v_msgs    uuid[];
  v_ids     uuid[];
  v_files   integer := 0;
  v_mails   integer := 0;
  v_notifs  integer := 0;
begin
  if p_subject is null then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;

  select p.role, p.email::text into v_role, v_email from public.profiles p where p.id = p_subject for update;
  if found and v_role <> 'candidate' then
    raise exception 'PERMISSION_DENIED: usunięcie dotyczy wyłącznie konta kandydata' using errcode = '42501';
  end if;
  if v_email is null then
    select u.email::text into v_email from auth.users u where u.id = p_subject;
  end if;

  select coalesce(array_agg(a.id), '{}') into v_apps from public.applications a where a.candidate_id = p_subject;
  select coalesce(array_agg(o.id), '{}') into v_offers from public.offers o where o.candidate_id = p_subject;
  -- Rozmowy procesu (firma ↔ kandydat), w których kandydat jest stroną.
  select coalesce(array_agg(distinct c.id), '{}') into v_convs
    from public.conversations c
    join public.conversation_members m on m.conversation_id = c.id and m.profile_id = p_subject
   where c.company_id is not null or c.application_id = any(v_apps) or c.offer_id = any(v_offers);
  select coalesce(array_agg(ms.id), '{}') into v_msgs from public.messages ms where ms.conversation_id = any(v_convs);
  v_ids := v_apps || v_offers || v_convs || v_msgs;

  -- Powiadomienia i e-maile firm o procesie kandydata (mogą zawierać jego imię).
  delete from public.notifications n where n.entity_id = any(v_ids);
  get diagnostics v_notifs = row_count;
  delete from public.email_deliveries e where e.profile_id = p_subject or e.entity_id = any(v_ids);
  get diagnostics v_mails = row_count;

  delete from public.conversations c where c.id = any(v_convs);
  delete from public.guest_application_requests g
   where g.claimed_by = p_subject or g.application_id = any(v_apps);
  -- Obiekty storage trafiają do kolejki triggerem files.
  delete from public.files f where f.owner_id = p_subject;
  get diagnostics v_files = row_count;

  update public.audit_logs set ip_address = null, user_agent = null where actor_id = p_subject;
  if v_email is not null and to_regclass('auth.verifications') is not null then
    execute 'delete from auth.verifications where identifier = $1' using v_email;
  end if;
  -- Konto auth → kaskada: profil, profil kandydata, relacje, aplikacje, propozycje, zgody,
  -- zapisane oferty/wyszukiwania, blokady, sesje i konta logowania.
  delete from auth.users u where u.id = p_subject;
  delete from public.profiles p where p.id = p_subject;

  insert into public.erasure_tombstones (subject_id, request_id, channel)
  values (p_subject, p_request, p_channel)
  on conflict (subject_id) do update
    set reapplied_at = case when p_channel = 'restore_reapply' then now() else erasure_tombstones.reapplied_at end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after_data)
  values (null, 'account.erased', 'profile', p_subject, jsonb_build_object('channel', p_channel));

  return jsonb_build_object(
    'applications', coalesce(array_length(v_apps, 1), 0),
    'offers', coalesce(array_length(v_offers, 1), 0),
    'conversations', coalesce(array_length(v_convs, 1), 0),
    'files', v_files,
    'notifications', v_notifs,
    'emails', v_mails);
end $$;
revoke all on function public.erase_candidate_subject(uuid, text, uuid) from public, anon, authenticated;

-- --- 6. Samoobsługowe usunięcie konta ------------------------------------------------------
create or replace function public.request_account_erasure(p_confirm_email text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid     uuid := auth.uid();
  v_role    public.user_role;
  v_email   text;
  v_request uuid;
  v_counts  jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select p.role, p.email::text into v_role, v_email
    from public.profiles p
   where p.id = v_uid and p.is_active and p.deleted_at is null
   for update;
  if not found or v_role <> 'candidate' then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if v_email is null or p_confirm_email is null
     or lower(btrim(p_confirm_email)) <> lower(btrim(v_email)) then
    raise exception 'VALIDATION_FAILED: CONFIRMATION_MISMATCH' using errcode = '22023';
  end if;

  insert into public.data_rights_requests (subject_id, kind, channel, due_at)
  values (v_uid, 'erasure', 'self_service', now() + interval '1 month')
  returning id into v_request;

  v_counts := public.erase_candidate_subject(v_uid, 'self_service', v_request);

  update public.data_rights_requests
     set completed_at = now(), details = v_counts
   where id = v_request;
  return jsonb_build_object('requestId', v_request, 'erased', true);
end $$;
revoke all on function public.request_account_erasure(text) from public, anon;
grant execute on function public.request_account_erasure(text) to authenticated;

-- --- 7. Eksport danych kandydata -------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid     uuid := auth.uid();
  v_role    public.user_role;
  v_cp      uuid;
  v_request uuid;
  v_apps    uuid[];
  v_offers  uuid[];
  v_convs   uuid[];
  v_out     jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select p.role into v_role from public.profiles p
   where p.id = v_uid and p.is_active and p.deleted_at is null;
  if not found or v_role <> 'candidate' then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if (select count(*) from public.data_rights_requests r
       where r.subject_id = v_uid and r.kind = 'access' and r.requested_at > now() - interval '1 day') >= 10 then
    raise exception 'RATE_LIMITED' using errcode = '42501';
  end if;

  select cp.id into v_cp from public.candidate_profiles cp where cp.profile_id = v_uid;
  select coalesce(array_agg(a.id), '{}') into v_apps from public.applications a where a.candidate_id = v_uid;
  select coalesce(array_agg(o.id), '{}') into v_offers from public.offers o where o.candidate_id = v_uid;
  select coalesce(array_agg(m.conversation_id), '{}') into v_convs
    from public.conversation_members m where m.profile_id = v_uid;

  insert into public.data_rights_requests (subject_id, kind, channel, due_at, completed_at)
  values (v_uid, 'access', 'self_service', now() + interval '1 month', now())
  returning id into v_request;

  v_out := jsonb_build_object(
    'format', 'pracujbe-export/1',
    'generatedAt', now(),
    'requestId', v_request,
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'createdAt', u.created_at)
                  from auth.users u where u.id = v_uid),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid),
    'candidateProfile', (select to_jsonb(cp) from public.candidate_profiles cp where cp.id = v_cp),
    'skills', (select coalesce(jsonb_agg(to_jsonb(s) - 'candidate_profile_id' order by s.created_at), '[]')
                 from public.candidate_skills s where s.candidate_profile_id = v_cp),
    'languages', (select coalesce(jsonb_agg(to_jsonb(l) - 'candidate_profile_id' order by l.created_at), '[]')
                    from public.candidate_languages l where l.candidate_profile_id = v_cp),
    'certificates', (select coalesce(jsonb_agg(to_jsonb(c) - 'candidate_profile_id' order by c.created_at), '[]')
                       from public.candidate_certificates c where c.candidate_profile_id = v_cp),
    'files', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', f.id, 'fileName', f.file_name, 'mimeType', f.mime_type, 'sizeBytes', f.size_bytes,
                  'kind', f.entity_type, 'createdAt', f.created_at, 'deletedAt', f.deleted_at) order by f.created_at), '[]')
                from public.files f where f.owner_id = v_uid),
    'applications', (select coalesce(jsonb_agg(
                         (to_jsonb(a) - array['idempotency_key', 'candidate_id', 'guest_request_id'])
                         || jsonb_build_object(
                           'jobTitle', (select j.title from public.jobs j where j.id = a.job_id),
                           'companyName', (select co.name from public.companies co where co.id = a.company_id),
                           'statusHistory', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'from', h.from_status, 'to', h.to_status, 'at', h.created_at) order by h.created_at), '[]')
                               from public.application_status_history h where h.application_id = a.id),
                           'screeningAnswers', (select coalesce(jsonb_agg(to_jsonb(sa) - 'application_id' order by sa.position), '[]')
                               from public.application_screening_answers sa where sa.application_id = a.id))
                         order by a.created_at), '[]')
                       from public.applications a where a.id = any(v_apps)),
    'offers', (select coalesce(jsonb_agg(
                   (to_jsonb(o) - array['idempotency_key', 'candidate_id', 'sender_id'])
                   || jsonb_build_object(
                     'companyName', (select co.name from public.companies co where co.id = o.company_id),
                     'statusHistory', (select coalesce(jsonb_agg(jsonb_build_object(
                           'from', h.from_status, 'to', h.to_status, 'at', h.created_at) order by h.created_at), '[]')
                         from public.offer_status_history h where h.offer_id = o.id))
                   order by o.created_at), '[]')
                 from public.offers o where o.id = any(v_offers)),
    -- Dane pochodne: wyłącznie już zapisane wyniki dopasowania (nie liczymy nowych).
    'matches', (select coalesce(jsonb_agg(to_jsonb(mt) - 'candidate_id' order by mt.computed_at), '[]')
                  from public.matches mt where mt.candidate_id = v_uid),
    'conversations', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', c.id, 'subject', c.subject, 'createdAt', c.created_at,
                          'companyName', (select co.name from public.companies co where co.id = c.company_id),
                          'messages', (select coalesce(jsonb_agg(jsonb_build_object(
                                'body', ms.body, 'sentAt', ms.created_at, 'fromMe', ms.sender_id = v_uid,
                                'system', ms.is_system) order by ms.created_at), '[]')
                              from public.messages ms where ms.conversation_id = c.id and ms.deleted_at is null))
                          order by c.created_at), '[]')
                        from public.conversations c where c.id = any(v_convs)),
    'savedJobs', (select coalesce(jsonb_agg(jsonb_build_object('jobId', sj.job_id, 'savedAt', sj.created_at)
                    order by sj.created_at), '[]') from public.saved_jobs sj where sj.candidate_id = v_uid),
    'savedSearches', (select coalesce(jsonb_agg(to_jsonb(ss) - 'profile_id' order by ss.created_at), '[]')
                        from public.saved_searches ss where ss.profile_id = v_uid),
    'companyBlocks', (select coalesce(jsonb_agg(jsonb_build_object(
                          'companyName', (select co.name from public.companies co where co.id = b.company_id),
                          'blockedAt', b.created_at) order by b.created_at), '[]')
                        from public.candidate_company_blocks b where b.candidate_id = v_uid),
    'notificationPreferences', (select to_jsonb(np) - 'profile_id' from public.notification_preferences np
                                  where np.profile_id = v_uid),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n) - 'profile_id' order by n.created_at), '[]')
                        from public.notifications n where n.profile_id = v_uid),
    'consents', (select coalesce(jsonb_agg(to_jsonb(cs) - 'profile_id' order by cs.created_at), '[]')
                   from public.consents cs where cs.profile_id = v_uid),
    'emailConsentEvents', (select coalesce(jsonb_agg(to_jsonb(ec) - 'profile_id' order by ec.created_at), '[]')
                             from public.email_consent_events ec where ec.profile_id = v_uid),
    'documentAcceptances', (select coalesce(jsonb_agg(to_jsonb(d) - 'profile_id' order by d.accepted_at), '[]')
                              from public.document_acceptances d where d.profile_id = v_uid),
    'emails', (select coalesce(jsonb_agg(jsonb_build_object(
                   'template', e.template, 'locale', e.locale, 'status', e.status, 'toEmail', e.to_email,
                   'queuedAt', e.queued_at, 'sentAt', e.sent_at) order by e.created_at), '[]')
                 from public.email_deliveries e where e.profile_id = v_uid),
    'guestApplications', (select coalesce(jsonb_agg(jsonb_build_object(
                              'fullName', g.full_name, 'email', g.email, 'locale', g.locale, 'status', g.status,
                              'createdAt', g.created_at, 'confirmedAt', g.confirmed_at, 'claimedAt', g.claimed_at,
                              'consentDocumentVersion', g.consent_document_version,
                              'consentAcceptedAt', g.consent_accepted_at) order by g.created_at), '[]')
                            from public.guest_application_requests g where g.claimed_by = v_uid),
    'moderationAppeals', (select coalesce(jsonb_agg(jsonb_build_object(
                              'reference', ap.reference, 'role', ap.appellant_role, 'status', ap.status,
                              'grounds', ap.grounds, 'submittedAt', ap.submitted_at, 'dueAt', ap.due_at,
                              'decidedAt', ap.decided_at, 'outcomeReasoning', ap.outcome_reasoning)
                              order by ap.submitted_at), '[]')
                            from public.moderation_appeals ap where ap.appellant_id = v_uid),
    'dataRightsRequests', (select coalesce(jsonb_agg(jsonb_build_object(
                               'id', r.id, 'kind', r.kind, 'requestedAt', r.requested_at, 'completedAt', r.completed_at)
                               order by r.requested_at), '[]')
                             from public.data_rights_requests r where r.subject_id = v_uid)
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id)
  values (v_uid, 'data.exported', 'profile', v_uid);
  return v_out;
end $$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- --- 8. Zadanie retencji (/api/maintenance) ------------------------------------------------
create or replace function public.retention_period(p_key text)
returns interval language sql stable security definer set search_path = public, pg_temp as $$
  select period from public.retention_policies where key = p_key
$$;
revoke all on function public.retention_period(text) from public, anon, authenticated;

create or replace function public.run_retention_purge(p_limit integer default 200)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_limit   integer := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_period  interval;
  v_ids     uuid[];
  v_subject uuid;
  v_request uuid;
  v_out     jsonb := '{}'::jsonb;
  v_n       integer;
begin
  -- Pliki oznaczone jako usunięte → wiersz (trigger kolejkuje obiekt storage).
  v_period := public.retention_period('deleted_file');
  v_n := 0;
  if v_period is not null then
    delete from public.files f
     where f.id in (select x.id from public.files x
                     where x.deleted_at is not null and x.deleted_at < now() - v_period
                     order by x.deleted_at limit v_limit for update skip locked);
    get diagnostics v_n = row_count;
  end if;
  v_out := v_out || jsonb_build_object('deletedFiles', v_n);

  -- Profile kandydatów oznaczone jako usunięte → pełne usunięcie.
  v_period := public.retention_period('deleted_profile');
  v_n := 0;
  if v_period is not null then
    for v_subject in
      select p.id from public.profiles p
       where p.role = 'candidate' and p.deleted_at is not null and p.deleted_at < now() - v_period
       order by p.deleted_at limit least(v_limit, 50) for update skip locked
    loop
      insert into public.data_rights_requests (subject_id, kind, channel, due_at)
      values (v_subject, 'erasure', 'retention', now()) returning id into v_request;
      update public.data_rights_requests
         set details = public.erase_candidate_subject(v_subject, 'retention', v_request), completed_at = now()
       where id = v_request;
      v_n := v_n + 1;
    end loop;
  end if;
  v_out := v_out || jsonb_build_object('erasedProfiles', v_n);

  -- Aplikacje w stanie końcowym (razem z powiadomieniami/e-mailami o nich).
  v_period := public.retention_period('closed_application');
  v_n := 0;
  if v_period is not null then
    select coalesce(array_agg(x.id), '{}') into v_ids
      from (select a.id from public.applications a
             where a.status in ('rejected', 'withdrawn', 'offer_declined')
               and a.updated_at < now() - v_period
             order by a.updated_at limit v_limit for update skip locked) x;
    delete from public.notifications n where n.entity_id = any(v_ids);
    delete from public.email_deliveries e where e.entity_id = any(v_ids);
    -- Ślad zgłoszenia bez konta zostaje (FK application_id → null) — jego okres ustala
    -- właściciel (confirmed_guest_request); tokeny gościa czyści purge_guest_application_requests.
    delete from public.applications a where a.id = any(v_ids);
    get diagnostics v_n = row_count;
  end if;
  v_out := v_out || jsonb_build_object('closedApplications', v_n);

  -- CV nieaktywnych kandydatów → oznaczenie jako usunięte (kolejny etap: deleted_file).
  v_period := public.retention_period('inactive_candidate_cv');
  v_n := 0;
  if v_period is not null then
    update public.files f set deleted_at = now()
     where f.id in (select x.id from public.files x
                      join public.profiles p on p.id = x.owner_id
                     where x.entity_type = 'candidate_cv' and x.deleted_at is null and p.role = 'candidate'
                       and coalesce(p.last_seen_at, p.created_at) < now() - v_period
                     order by x.created_at limit v_limit for update of x skip locked);
    get diagnostics v_n = row_count;
  end if;
  v_out := v_out || jsonb_build_object('inactiveCvMarked', v_n);

  -- confirmed_guest_request: celowo bez zadania — wartość konfigurowalna, cel i okres
  -- minimalnego śladu potwierdzonego zgłoszenia gościa ustala właściciel (#486/#522).

  v_period := public.retention_period('data_rights_request_log');
  v_n := 0;
  if v_period is not null then
    delete from public.data_rights_requests r
     where r.id in (select x.id from public.data_rights_requests x
                     where x.completed_at is not null and x.completed_at < now() - v_period
                     order by x.completed_at limit v_limit for update skip locked);
    get diagnostics v_n = row_count;
  end if;
  v_out := v_out || jsonb_build_object('dataRightsRequests', v_n);

  v_period := public.retention_period('erasure_tombstone');
  v_n := 0;
  if v_period is not null then
    delete from public.erasure_tombstones t
     where t.subject_id in (select x.subject_id from public.erasure_tombstones x
                             where greatest(x.erased_at, coalesce(x.reapplied_at, x.erased_at)) < now() - v_period
                             order by x.erased_at limit v_limit for update skip locked);
    get diagnostics v_n = row_count;
  end if;
  return v_out || jsonb_build_object('erasureTombstones', v_n);
end $$;
revoke all on function public.run_retention_purge(integer) from public, anon, authenticated;
grant execute on function public.run_retention_purge(integer) to service_role;

-- --- 9. Ponowne usunięcie po restore ---------------------------------------------------------
create or replace function public.apply_erasure_tombstones(p_subjects uuid[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_subject uuid;
  v_request uuid;
  v_reapplied integer := 0;
  v_absent integer := 0;
begin
  if p_subjects is null or coalesce(array_length(p_subjects, 1), 0) > 100000 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  foreach v_subject in array p_subjects loop
    if exists (select 1 from public.profiles where id = v_subject)
       or exists (select 1 from auth.users where id = v_subject) then
      insert into public.data_rights_requests (subject_id, kind, channel, due_at)
      values (v_subject, 'erasure', 'restore_reapply', now()) returning id into v_request;
      update public.data_rights_requests
         set details = public.erase_candidate_subject(v_subject, 'restore_reapply', v_request), completed_at = now()
       where id = v_request;
      v_reapplied := v_reapplied + 1;
    else
      insert into public.erasure_tombstones (subject_id, channel)
      values (v_subject, 'restore_reapply')
      on conflict (subject_id) do nothing;
      v_absent := v_absent + 1;
    end if;
  end loop;
  return jsonb_build_object('reapplied', v_reapplied, 'alreadyAbsent', v_absent);
end $$;
revoke all on function public.apply_erasure_tombstones(uuid[]) from public, anon, authenticated;
grant execute on function public.apply_erasure_tombstones(uuid[]) to service_role;

-- --- 1b. Zmiana okresu przez admina -----------------------------------------------------------
create or replace function public.admin_set_retention_policy(p_key text, p_days integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_before interval;
begin
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select period into v_before from public.retention_policies where key = p_key for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_days is not null and (p_days < 1 or p_days > 3650) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  -- Rejestr usunięć musi przeżyć najstarszą kopię (BACKUP_RETENTION ≤ 365 kopii dziennych).
  if p_key = 'erasure_tombstone' and p_days is not null and p_days < 400 then
    raise exception 'VALIDATION_FAILED: rejestr usunięć krótszy niż retencja kopii' using errcode = '22023';
  end if;
  update public.retention_policies
     set period = case when p_days is null then null else make_interval(days => p_days) end,
         updated_at = now(), updated_by = auth.uid()
   where key = p_key;
  insert into public.audit_logs (actor_id, action, entity_type, before_data, after_data)
  values (auth.uid(), 'retention.policy_changed', 'retention_policy',
          jsonb_build_object('key', p_key, 'days', extract(day from v_before)),
          jsonb_build_object('key', p_key, 'days', p_days));
end $$;
revoke all on function public.admin_set_retention_policy(text, integer) from public, anon;
grant execute on function public.admin_set_retention_policy(text, integer) to authenticated;
