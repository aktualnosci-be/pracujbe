-- =============================================================================
-- 0190_matches_pipeline.sql  (numer TYMCZASOWY — ostateczny nada integrator)
-- Materializacja dopasowań `matches` (audyt P1-03 „pipeline materializacji matches”).
--
-- Do tej pory wiersze `matches` wstawiał tylko seed/operator, więc „Top dopasowani”
-- (get_company_top_matches, 0079) i polecane oferty kandydata działały wyłącznie na danych
-- demonstracyjnych. Wynik liczy nadal JEDEN algorytm — `scoreMatch` w TypeScript
-- (`src/lib/matching/score.ts`, bez AI); baza dostarcza wejścia, egzekwuje, KTO może mieć
-- wiersz, i zapisuje wynik wyłącznie jako service_role.
--
--   1. Kolejka `match_recompute_queue` (kind = candidate | job, subject_id, version):
--      jeden wiersz na podmiot (PK), ponowne zgłoszenie podbija `version` i zeruje `attempts`
--      (idempotentne — seria zmian = jedno przeliczenie). Brak grantów (tylko service_role).
--   2. Triggery zgłaszające: oferta (jobs + relacje job_skills/job_languages/job_certificates
--      aktywnej oferty), status firmy, profil kandydata i jego relacje, konto (rola/usunięcie),
--      blokady firm (#97), deklaracje wieku (#492). Triggery tylko kolejkują — liczenie
--      i usuwanie robi worker, a do tego czasu firmom wiersze ukrywa RLS (0100).
--   3. Kwalifikacja pary w bazie (`match_pair_eligible`): kandydat z rolą candidate, konto
--      i profil nieusunięte, profil ukończony i WYSZUKIWALNY (#494), potwierdzone 18+ (#492);
--      oferta active, nieusunięta, niewygasła, firma `verified` i nieusunięta; kandydat nie
--      zablokował firmy oferty (#97). Para bez kwalifikacji nie ma wiersza.
--   4. Worker (`/api/maintenance` → `src/lib/matching/materialize.ts`):
--        match_recompute_claim(limit)    — partia podmiotów FOR UPDATE SKIP LOCKED, dzierżawa
--                                          10 min, najwyżej 50, pomija po 5 nieudanych próbach;
--        match_recompute_inputs(...)     — wejścia scoreMatch dla podmiotu i kwalifikujących się
--                                          stron przeciwnych (limit ≤ 1000; oferta przez
--                                          get_job_match_profile — to samo źródło co live);
--        match_recompute_apply(...)      — w jednej transakcji: upsert wierszy (każda para
--                                          sprawdzana PONOWNIE w bazie), usunięcie wierszy
--                                          podmiotu bez kwalifikacji albo już niepasujących,
--                                          zdjęcie z kolejki tylko przy niezmienionej `version`.
--   5. Backfill: kolejka dostaje wszystkich dziś kwalifikujących się kandydatów oraz
--      kandydatów z istniejącymi wierszami (sprzątnięcie niekwalifikujących się).
--
-- Prywatność: kolejka niesie tylko UUID podmiotu; wejścia i wynik to dane zawodowe
-- (etykiety umiejętności/języków/certyfikatów, miasto, lata doświadczenia) — bez imienia,
-- kontaktu, CV. Odczyt `matches` bez zmian (polityka 0100).
--
-- Rollback: drop triggerów `trg_match_enqueue_*`, funkcji `match_*` z tej migracji
-- i tabeli `match_recompute_queue`. Wiersze `matches` zostają (cache), polityki bez zmian.
-- =============================================================================

-- --- 1. Kolejka ---------------------------------------------------------------------
create table if not exists public.match_recompute_queue (
  kind         text not null check (kind in ('candidate', 'job')),
  subject_id   uuid not null,
  version      bigint not null default 1,
  attempts     integer not null default 0 check (attempts >= 0),
  enqueued_at  timestamptz not null default now(),
  locked_until timestamptz,
  primary key (kind, subject_id)
);
create index if not exists match_recompute_queue_ready_idx
  on public.match_recompute_queue (enqueued_at);

alter table public.match_recompute_queue enable row level security;
alter table public.match_recompute_queue force row level security;
revoke all on public.match_recompute_queue from public, anon, authenticated;

-- Zgłoszenie podmiotu (wewnętrzne — triggery i worker). Idempotentne: istniejący wiersz
-- dostaje nową wersję (przeliczenie w toku nie zdejmie go z kolejki) i czysty licznik prób.
create or replace function public.match_enqueue(p_kind text, p_subject uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.match_recompute_queue as q (kind, subject_id)
  select p_kind, p_subject
  where p_subject is not null and p_kind in ('candidate', 'job')
  on conflict (kind, subject_id) do update
    set version = q.version + 1, attempts = 0, enqueued_at = now();
$$;
revoke all on function public.match_enqueue(text, uuid) from public, anon, authenticated;

-- --- 2. Kwalifikacja (egzekwowana w bazie) ------------------------------------------
create or replace function public.match_candidate_eligible(p_candidate uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.profiles p
    join public.candidate_profiles cp on cp.profile_id = p.id
    where p.id = p_candidate
      and p.role = 'candidate'
      and p.deleted_at is null
      and cp.deleted_at is null
      and cp.is_searchable = true
      and cp.profile_completed = true
      and public.candidate_is_adult(p.id)
  );
$$;
revoke all on function public.match_candidate_eligible(uuid) from public, anon, authenticated;

create or replace function public.match_job_eligible(p_job uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.jobs j
    join public.companies c on c.id = j.company_id
    where j.id = p_job
      and j.status = 'active'
      and j.deleted_at is null
      and (j.expires_at is null or j.expires_at > now())
      and c.status = 'verified'
      and c.deleted_at is null
  );
$$;
revoke all on function public.match_job_eligible(uuid) from public, anon, authenticated;

create or replace function public.match_pair_eligible(p_candidate uuid, p_job uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.match_candidate_eligible(p_candidate)
     and public.match_job_eligible(p_job)
     and not exists (
       select 1
       from public.jobs j
       join public.candidate_company_blocks b on b.company_id = j.company_id
       where j.id = p_job and b.candidate_id = p_candidate
     );
$$;
revoke all on function public.match_pair_eligible(uuid, uuid) from public, anon, authenticated;

-- --- 3. Triggery zgłaszające ---------------------------------------------------------
create or replace function public.trg_match_enqueue_job()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Tylko oferta aktywna teraz albo przed zmianą (szkic nie ma dopasowań).
  if new.status = 'active' or (tg_op = 'UPDATE' and old.status = 'active') then
    perform public.match_enqueue('job', new.id);
  end if;
  return null;
end $$;
revoke all on function public.trg_match_enqueue_job() from public, anon, authenticated;
drop trigger if exists trg_match_enqueue_job on public.jobs;
create trigger trg_match_enqueue_job
  after insert or update on public.jobs
  for each row execute function public.trg_match_enqueue_job();

create or replace function public.trg_match_enqueue_job_relation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job uuid := case when tg_op = 'DELETE' then old.job_id else new.job_id end;
begin
  if exists (select 1 from public.jobs j where j.id = v_job and j.status = 'active') then
    perform public.match_enqueue('job', v_job);
  end if;
  return null;
end $$;
revoke all on function public.trg_match_enqueue_job_relation() from public, anon, authenticated;
drop trigger if exists trg_match_enqueue_job_skills on public.job_skills;
create trigger trg_match_enqueue_job_skills
  after insert or update or delete on public.job_skills
  for each row execute function public.trg_match_enqueue_job_relation();
drop trigger if exists trg_match_enqueue_job_languages on public.job_languages;
create trigger trg_match_enqueue_job_languages
  after insert or update or delete on public.job_languages
  for each row execute function public.trg_match_enqueue_job_relation();
drop trigger if exists trg_match_enqueue_job_certificates on public.job_certificates;
create trigger trg_match_enqueue_job_certificates
  after insert or update or delete on public.job_certificates
  for each row execute function public.trg_match_enqueue_job_relation();

-- Zmiana weryfikacji/usunięcia firmy: przeliczenie jej aktywnych ofert.
create or replace function public.trg_match_enqueue_company()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status or new.deleted_at is distinct from old.deleted_at then
    perform public.match_enqueue('job', j.id)
      from public.jobs j
      where j.company_id = new.id and j.status = 'active' and j.deleted_at is null;
  end if;
  return null;
end $$;
revoke all on function public.trg_match_enqueue_company() from public, anon, authenticated;
drop trigger if exists trg_match_enqueue_company on public.companies;
create trigger trg_match_enqueue_company
  after update on public.companies
  for each row execute function public.trg_match_enqueue_company();

create or replace function public.trg_match_enqueue_candidate_profile()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.match_enqueue('candidate',
    case when tg_op = 'DELETE' then old.profile_id else new.profile_id end);
  return null;
end $$;
revoke all on function public.trg_match_enqueue_candidate_profile() from public, anon, authenticated;
drop trigger if exists trg_match_enqueue_candidate_profile on public.candidate_profiles;
create trigger trg_match_enqueue_candidate_profile
  after insert or update or delete on public.candidate_profiles
  for each row execute function public.trg_match_enqueue_candidate_profile();

create or replace function public.trg_match_enqueue_candidate_relation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cp uuid := case when tg_op = 'DELETE' then old.candidate_profile_id else new.candidate_profile_id end;
begin
  -- Przy kaskadowym usunięciu profilu wiersza już nie ma — zgłasza go trigger profilu.
  perform public.match_enqueue('candidate', cp.profile_id)
    from public.candidate_profiles cp where cp.id = v_cp;
  return null;
end $$;
revoke all on function public.trg_match_enqueue_candidate_relation() from public, anon, authenticated;
drop trigger if exists trg_match_enqueue_candidate_skills on public.candidate_skills;
create trigger trg_match_enqueue_candidate_skills
  after insert or update or delete on public.candidate_skills
  for each row execute function public.trg_match_enqueue_candidate_relation();
drop trigger if exists trg_match_enqueue_candidate_languages on public.candidate_languages;
create trigger trg_match_enqueue_candidate_languages
  after insert or update or delete on public.candidate_languages
  for each row execute function public.trg_match_enqueue_candidate_relation();
drop trigger if exists trg_match_enqueue_candidate_certificates on public.candidate_certificates;
create trigger trg_match_enqueue_candidate_certificates
  after insert or update or delete on public.candidate_certificates
  for each row execute function public.trg_match_enqueue_candidate_relation();

-- Blokada firmy (#97) i deklaracja wieku (#492): kolumna `candidate_id`/`profile_id` = konto.
create or replace function public.trg_match_enqueue_candidate_account()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
begin
  perform public.match_enqueue('candidate',
    coalesce(v_row ->> 'candidate_id', v_row ->> 'profile_id')::uuid);
  return null;
end $$;
revoke all on function public.trg_match_enqueue_candidate_account() from public, anon, authenticated;
drop trigger if exists trg_match_enqueue_company_block on public.candidate_company_blocks;
create trigger trg_match_enqueue_company_block
  after insert or delete on public.candidate_company_blocks
  for each row execute function public.trg_match_enqueue_candidate_account();
drop trigger if exists trg_match_enqueue_age_attestation on public.candidate_age_attestations;
create trigger trg_match_enqueue_age_attestation
  after insert or delete on public.candidate_age_attestations
  for each row execute function public.trg_match_enqueue_candidate_account();

-- Konto: zmiana roli albo usunięcie (soft delete) kandydata.
create or replace function public.trg_match_enqueue_profile()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.role is distinct from old.role or new.deleted_at is distinct from old.deleted_at)
     and (new.role = 'candidate' or old.role = 'candidate') then
    perform public.match_enqueue('candidate', new.id);
  end if;
  return null;
end $$;
revoke all on function public.trg_match_enqueue_profile() from public, anon, authenticated;
drop trigger if exists trg_match_enqueue_profile on public.profiles;
create trigger trg_match_enqueue_profile
  after update on public.profiles
  for each row execute function public.trg_match_enqueue_profile();

-- --- 4. Worker (service_role) ----------------------------------------------------------
create or replace function public.match_recompute_claim(p_limit integer default 20)
returns table (kind text, subject_id uuid, version bigint)
language sql security definer set search_path = public, pg_temp as $$
  with picked as (
    select q.kind, q.subject_id
    from public.match_recompute_queue q
    where (q.locked_until is null or q.locked_until < now())
      and q.attempts < 5
    order by q.enqueued_at, q.kind, q.subject_id
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
    for update skip locked
  )
  update public.match_recompute_queue q
     set locked_until = now() + interval '10 minutes', attempts = q.attempts + 1
    from picked
   where q.kind = picked.kind and q.subject_id = picked.subject_id
  returning q.kind, q.subject_id, q.version;
$$;
revoke all on function public.match_recompute_claim(integer) from public, anon, authenticated;
grant execute on function public.match_recompute_claim(integer) to service_role;

-- Wejścia kandydata dla scoreMatch — te same kolumny i relacje co odczyt live
-- (`src/lib/data/matching.ts`). Tylko dane zawodowe; bez imienia i kontaktu.
create or replace function public.match_candidate_input(p_candidate uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'profile_id', cp.profile_id,
    'occupations', to_jsonb(cp.occupations),
    'categories', to_jsonb(cp.categories),
    'preferred_contract_types', to_jsonb(cp.preferred_contract_types),
    'city', cp.city,
    'region', cp.region,
    'radius_km', cp.radius_km,
    'has_driving_license', cp.has_driving_license,
    'has_car', cp.has_car,
    'experience_years', cp.experience_years,
    'availability', cp.availability::text,
    'skills', coalesce((select jsonb_agg(jsonb_build_object('skill_label', s.skill_label)
                                         order by s.skill_label)
                        from public.candidate_skills s where s.candidate_profile_id = cp.id), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(jsonb_build_object('language_label', l.language_label,
                                                              'level', l.level::text)
                                            order by l.language_label)
                           from public.candidate_languages l where l.candidate_profile_id = cp.id), '[]'::jsonb),
    'certificates', coalesce((select jsonb_agg(jsonb_build_object('certificate_label', c.certificate_label,
                                                                 'expires_at', c.expires_at::text)
                                               order by c.certificate_label)
                              from public.candidate_certificates c where c.candidate_profile_id = cp.id), '[]'::jsonb)
  )
  from public.candidate_profiles cp
  where cp.profile_id = p_candidate;
$$;
revoke all on function public.match_candidate_input(uuid) from public, anon, authenticated;

-- Wejścia oferty: wiersz `get_job_match_profile` (0074) — ten sam co w odczycie live.
create or replace function public.match_job_input(p_job uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(g) || jsonb_build_object('job_id', p_job)
  from public.get_job_match_profile(p_job) g;
$$;
revoke all on function public.match_job_input(uuid) from public, anon, authenticated;

-- Podmiot + kwalifikujące się strony przeciwne. Podmiot bez kwalifikacji → `eligible=false`
-- i puste listy (worker usuwa wtedy jego wiersze). Limit stron przeciwnych ≤ 1000.
create or replace function public.match_recompute_inputs(
  p_kind text, p_subject uuid, p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
begin
  if p_kind = 'candidate' then
    if not public.match_candidate_eligible(p_subject) then
      return jsonb_build_object('eligible', false, 'candidates', '[]'::jsonb, 'jobs', '[]'::jsonb);
    end if;
    return jsonb_build_object(
      'eligible', true,
      'candidates', jsonb_build_array(public.match_candidate_input(p_subject)),
      'jobs', coalesce((
        select jsonb_agg(public.match_job_input(x.id) order by x.published_at desc nulls last, x.id)
        from (
          select j.id, j.published_at
          from public.jobs j
          join public.companies c on c.id = j.company_id
          where j.status = 'active' and j.deleted_at is null
            and (j.expires_at is null or j.expires_at > now())
            and c.status = 'verified' and c.deleted_at is null
            and not exists (select 1 from public.candidate_company_blocks b
                            where b.candidate_id = p_subject and b.company_id = j.company_id)
          order by j.published_at desc nulls last, j.id
          limit v_limit
        ) x), '[]'::jsonb));
  elsif p_kind = 'job' then
    if not public.match_job_eligible(p_subject) then
      return jsonb_build_object('eligible', false, 'candidates', '[]'::jsonb, 'jobs', '[]'::jsonb);
    end if;
    return jsonb_build_object(
      'eligible', true,
      'jobs', jsonb_build_array(public.match_job_input(p_subject)),
      'candidates', coalesce((
        select jsonb_agg(public.match_candidate_input(x.profile_id) order by x.updated_at desc, x.profile_id)
        from (
          select cp.profile_id, cp.updated_at
          from public.candidate_profiles cp
          join public.jobs j on j.id = p_subject
          where public.match_candidate_eligible(cp.profile_id)
            and not exists (select 1 from public.candidate_company_blocks b
                            where b.candidate_id = cp.profile_id and b.company_id = j.company_id)
          order by cp.updated_at desc, cp.profile_id
          limit v_limit
        ) x), '[]'::jsonb));
  end if;
  raise exception 'VALIDATION_FAILED: kind' using errcode = '22023';
end $$;
revoke all on function public.match_recompute_inputs(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.match_recompute_inputs(text, uuid, integer) to service_role;

-- Etykiety wyniku: tablica tekstów, ≤ 60 pozycji po ≤ 200 znaków (limity relacji kreatora).
create or replace function public.match_text_array(p_value jsonb)
returns text[] language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_out text[];
begin
  if p_value is null then return '{}'::text[]; end if;
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 60 then
    raise exception 'VALIDATION_FAILED: labels' using errcode = '22023';
  end if;
  select coalesce(array_agg(e.v order by e.ord), '{}'::text[]) into v_out
    from jsonb_array_elements_text(p_value) with ordinality e(v, ord);
  if exists (select 1 from unnest(v_out) t where length(t) > 200) then
    raise exception 'VALIDATION_FAILED: labels' using errcode = '22023';
  end if;
  return v_out;
end $$;
revoke all on function public.match_text_array(jsonb) from public, anon, authenticated;

-- Zapis wyniku dla podmiotu (jedna transakcja):
--   p_considered — UUID stron przeciwnych, dla których worker policzył wynik (z inputs);
--   p_rows       — [{other_id, score, matched, missing, strengths, mandatory_met,
--                    mandatory_total, summary_key}] tylko pary zapisane (≥ progu workera).
-- Każda para jest sprawdzana ponownie (`match_pair_eligible`) — zmiana w trakcie liczenia
-- (blokada, ukrycie profilu, wycofanie oferty) nie zostawia wiersza. Usuwane są wiersze
-- podmiotu bez kwalifikacji oraz rozważone, a już niezapisane. Kolejka: wiersz znika tylko
-- przy niezmienionej `version`; nowsze zgłoszenie zostaje (dzierżawa zwolniona).
create or replace function public.match_recompute_apply(
  p_kind text, p_subject uuid, p_version bigint, p_considered jsonb, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_considered uuid[];
  v_written uuid[] := '{}';
  v_row jsonb;
  v_other uuid;
  v_candidate uuid;
  v_job uuid;
  v_score integer;
  v_met integer;
  v_total integer;
  v_summary text;
  v_upserted integer := 0;
  v_skipped integer := 0;
  v_deleted integer := 0;
begin
  if p_kind not in ('candidate', 'job') or p_subject is null then
    raise exception 'VALIDATION_FAILED: kind' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_considered, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_considered, '[]'::jsonb)) > 1000
     or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 1000 then
    raise exception 'VALIDATION_FAILED: batch' using errcode = '22023';
  end if;
  select coalesce(array_agg(e::uuid), '{}') into v_considered
    from jsonb_array_elements_text(coalesce(p_considered, '[]'::jsonb)) e;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_other := (v_row ->> 'other_id')::uuid;
    v_score := (v_row ->> 'score')::integer;
    v_met := coalesce((v_row ->> 'mandatory_met')::integer, 0);
    v_total := coalesce((v_row ->> 'mandatory_total')::integer, 0);
    v_summary := v_row ->> 'summary_key';
    if v_other is null or not (v_other = any(v_considered)) or v_other = any(v_written)
       or v_score is null or v_score < 0 or v_score > 100
       or v_met < 0 or v_total < 0 or v_met > v_total or v_total > 1000
       or v_summary is null or v_summary not in ('good', 'partial', 'low') then
      raise exception 'VALIDATION_FAILED: row' using errcode = '22023';
    end if;
    v_candidate := case when p_kind = 'candidate' then p_subject else v_other end;
    v_job := case when p_kind = 'candidate' then v_other else p_subject end;
    v_written := v_written || v_other;
    if not public.match_pair_eligible(v_candidate, v_job) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.matches as m (candidate_id, job_id, score, matched, missing, strengths,
                                     mandatory_met, mandatory_total, summary_key, computed_at, is_demo)
    values (v_candidate, v_job, v_score, public.match_text_array(v_row -> 'matched'),
            public.match_text_array(v_row -> 'missing'), public.match_text_array(v_row -> 'strengths'),
            v_met, v_total, v_summary, now(), false)
    on conflict (candidate_id, job_id) do update
      set score = excluded.score, matched = excluded.matched, missing = excluded.missing,
          strengths = excluded.strengths, mandatory_met = excluded.mandatory_met,
          mandatory_total = excluded.mandatory_total, summary_key = excluded.summary_key,
          computed_at = excluded.computed_at, is_demo = false, updated_at = now();
    v_upserted := v_upserted + 1;
  end loop;

  -- Pary już niekwalifikujące się (wszystkie wiersze podmiotu) i rozważone bez zapisu.
  with gone as (
    delete from public.matches m
    where (case when p_kind = 'candidate' then m.candidate_id else m.job_id end) = p_subject
      and (
        not public.match_pair_eligible(m.candidate_id, m.job_id)
        or (
          (case when p_kind = 'candidate' then m.job_id else m.candidate_id end) = any(v_considered)
          and not ((case when p_kind = 'candidate' then m.job_id else m.candidate_id end) = any(v_written))
        )
      )
    returning 1
  )
  select count(*) into v_deleted from gone;

  delete from public.match_recompute_queue q
   where q.kind = p_kind and q.subject_id = p_subject and q.version = p_version;
  if not found then
    update public.match_recompute_queue q set locked_until = null
     where q.kind = p_kind and q.subject_id = p_subject;
  end if;

  return jsonb_build_object('upserted', v_upserted, 'skipped', v_skipped, 'deleted', v_deleted);
end $$;
revoke all on function public.match_recompute_apply(text, uuid, bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.match_recompute_apply(text, uuid, bigint, jsonb, jsonb) to service_role;

-- --- 5. Backfill ----------------------------------------------------------------------
insert into public.match_recompute_queue (kind, subject_id)
select 'candidate', s.id
from (
  select cp.profile_id as id from public.candidate_profiles cp
  where public.match_candidate_eligible(cp.profile_id)
  union
  select distinct m.candidate_id from public.matches m where m.is_demo = false
) s
on conflict (kind, subject_id) do nothing;
