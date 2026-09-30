-- =============================================================================
-- 0196 — prywatny dziennik aplikacji kandydata (#904; numer tymczasowy, ostateczny nada integrator).
--
-- Decyzja produktowa (portal ogłoszeniowy, #1128): kandydat sam notuje, gdzie aplikował u
-- ogłoszeniodawcy poza portalem. Portal niczego nie przekazuje firmom i nie przyjmuje aplikacji;
-- wpis NIE jest rekordem procesu (brak `job_id`, brak związku z `applications`, `matches`,
-- `offers`, lejkiem ofert ani statystykami) i nie jest widoczny dla nikogo poza właścicielem.
--
-- Model: `candidate_application_journal` (RLS wymuszone, odczyt tylko własnych wierszy, brak
-- grantów zapisu — zapis wyłącznie RPC SECURITY DEFINER pod sesją kandydata):
--   * save_application_journal_entry — nowy wpis (idempotentny po `client_key`, limit 200)
--     albo edycja własnego (`p_entry_id`); pola opcjonalne puste → NULL;
--   * delete_application_journal_entry — usunięcie własnego wpisu.
-- Eksport (#486): `export_my_data` dopisuje klucz `applicationJournal`. Usunięcie konta
-- (`erase_candidate_subject`, kaskada auth.users → profiles) kasuje wpisy kaskadą FK.
--
-- Rollback: supabase/rollback/0196_candidate_application_journal.down.sql.
-- =============================================================================

create table if not exists public.candidate_application_journal (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  client_key   uuid not null,
  job_title    text not null check (char_length(job_title) between 1 and 160),
  company_name text not null check (char_length(company_name) between 1 and 160),
  source_url   text check (source_url is null or (char_length(source_url) <= 500
                                                  and public.public_https_url(source_url) is not null)),
  location     text check (location is null or char_length(location) between 1 and 120),
  applied_on   date,
  stage        text not null default 'sent'
                 check (stage in ('planned', 'sent', 'interview', 'offer', 'closed')),
  note         text check (note is null or char_length(note) between 1 and 2000),
  remind_on    date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (profile_id, client_key)
);
create index if not exists candidate_application_journal_profile_idx
  on public.candidate_application_journal (profile_id, created_at desc, id desc);

drop trigger if exists set_updated_at on public.candidate_application_journal;
create trigger set_updated_at before update on public.candidate_application_journal
  for each row execute function public.set_updated_at();

alter table public.candidate_application_journal enable row level security;
alter table public.candidate_application_journal force row level security;

revoke all on public.candidate_application_journal from public, anon, authenticated;
grant select on public.candidate_application_journal to authenticated;

drop policy if exists candidate_application_journal_select_own on public.candidate_application_journal;
create policy candidate_application_journal_select_own on public.candidate_application_journal
  for select to authenticated
  using (profile_id = auth.uid());

-- --- RPC: zapis --------------------------------------------------------------------------------
create or replace function public.save_application_journal_entry(
  p_client_key   uuid,
  p_entry_id     uuid,
  p_job_title    text,
  p_company_name text,
  p_source_url   text default null,
  p_location     text default null,
  p_applied_on   date default null,
  p_stage        text default 'sent',
  p_note         text default null,
  p_remind_on    date default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := auth.uid();
  v_title text := btrim(coalesce(p_job_title, ''));
  v_comp  text := btrim(coalesce(p_company_name, ''));
  v_url   text := nullif(btrim(coalesce(p_source_url, '')), '');
  v_loc   text := nullif(btrim(coalesce(p_location, '')), '');
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_stage text := coalesce(p_stage, 'sent');
  v_id    uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.role = 'candidate' and p.deleted_at is null
  ) then
    raise exception 'PERMISSION_DENIED: tylko kandydat prowadzi dziennik' using errcode = '42501';
  end if;
  if p_client_key is null then
    raise exception 'VALIDATION_FAILED: brak klucza operacji' using errcode = '22023';
  end if;
  if char_length(v_title) not between 1 and 160 or char_length(v_comp) not between 1 and 160 then
    raise exception 'VALIDATION_FAILED: tytuł i firma (1–160 znaków)' using errcode = '22023';
  end if;
  if v_url is not null and (char_length(v_url) > 500 or public.public_https_url(v_url) is null) then
    raise exception 'VALIDATION_FAILED: adres oferty (https)' using errcode = '22023';
  end if;
  if v_loc is not null and char_length(v_loc) > 120 then
    raise exception 'VALIDATION_FAILED: lokalizacja (do 120 znaków)' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'VALIDATION_FAILED: notatka (do 2000 znaków)' using errcode = '22023';
  end if;
  if v_stage not in ('planned', 'sent', 'interview', 'offer', 'closed') then
    raise exception 'VALIDATION_FAILED: etap' using errcode = '22023';
  end if;

  -- Blokada profilu serializuje równoległe zapisy tego samego kandydata (limit + idempotencja).
  perform 1 from public.profiles where id = v_uid for update;

  if p_entry_id is not null then
    update public.candidate_application_journal j
       set job_title = v_title, company_name = v_comp, source_url = v_url, location = v_loc,
           applied_on = p_applied_on, stage = v_stage, note = v_note, remind_on = p_remind_on
     where j.id = p_entry_id and j.profile_id = v_uid
    returning j.id into v_id;
    if v_id is null then raise exception 'NOT_FOUND: wpis dziennika' using errcode = 'P0002'; end if;
    return v_id;
  end if;

  select j.id into v_id from public.candidate_application_journal j
   where j.profile_id = v_uid and j.client_key = p_client_key;
  if v_id is not null then return v_id; end if;

  if (select count(*) from public.candidate_application_journal j where j.profile_id = v_uid) >= 200 then
    raise exception 'JOURNAL_LIMIT_REACHED: 200' using errcode = '53400';
  end if;

  insert into public.candidate_application_journal
    (profile_id, client_key, job_title, company_name, source_url, location, applied_on, stage, note, remind_on)
  values (v_uid, p_client_key, v_title, v_comp, v_url, v_loc, p_applied_on, v_stage, v_note, p_remind_on)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.save_application_journal_entry(uuid, uuid, text, text, text, text, date, text, text, date)
  from public, anon;
grant execute on function public.save_application_journal_entry(uuid, uuid, text, text, text, text, date, text, text, date)
  to authenticated;

-- --- RPC: usunięcie ----------------------------------------------------------------------------
create or replace function public.delete_application_journal_entry(p_entry_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  delete from public.candidate_application_journal j
   where j.id = p_entry_id and j.profile_id = v_uid
  returning j.id into v_id;
  if v_id is null then raise exception 'NOT_FOUND: wpis dziennika' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.delete_application_journal_entry(uuid) from public, anon;
grant execute on function public.delete_application_journal_entry(uuid) to authenticated;

-- --- Eksport danych kandydata (#486) obejmuje dziennik -----------------------------------------
-- Jak w 0126: dotychczasowa funkcja staje się wewnętrzną częścią, nowa dopisuje klucz.
do $mig$
begin
  if to_regprocedure('public.export_my_data()') is null
     or to_regprocedure('public.export_my_data_pre0196()') is not null then
    return;
  end if;
  alter function public.export_my_data() rename to export_my_data_pre0196;
  revoke all on function public.export_my_data_pre0196() from public, anon, authenticated;
end
$mig$;

create or replace function public.export_my_data()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_out jsonb;
begin
  v_out := public.export_my_data_pre0196();
  return v_out || jsonb_build_object('applicationJournal',
    (select coalesce(jsonb_agg(jsonb_build_object(
              'jobTitle', j.job_title, 'companyName', j.company_name, 'sourceUrl', j.source_url,
              'location', j.location, 'appliedOn', j.applied_on, 'stage', j.stage, 'note', j.note,
              'remindOn', j.remind_on, 'createdAt', j.created_at, 'updatedAt', j.updated_at)
              order by j.created_at, j.id), '[]'::jsonb)
       from public.candidate_application_journal j where j.profile_id = auth.uid()));
end $$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
