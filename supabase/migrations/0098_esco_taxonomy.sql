-- =============================================================================
-- 0098 — taksonomia ESCO v1.2.1 w słownikach occupations/skills (#93).
--
-- Wspólna, wielojęzyczna taksonomia zawodów i umiejętności z przypiętego snapshotu
-- ESCO v1.2.1, tylko w językach portalu (PL/NL/FR/EN — supported_locales). Portal
-- czyta ją lokalnie z PostgreSQL; żadnego API ESCO w ścieżce użytkownika.
--
-- 1. esco_snapshots — metadane źródła: identyfikator, wersja, pliki z SHA-256 i
--    rozmiarem, skrót manifestu, atrybucja, liczba i data importów, ostatni raport.
--    Pierwszy import przypina manifest: ta sama wersja/snapshot z innymi plikami
--    jest odrzucana (ESCO_CHECKSUM_MISMATCH), a pól przypięcia nie da się zmienić.
-- 2. occupations/skills — nowe kolumny: source ('manual' | 'esco'), esco_uri (stabilny
--    klucz zewnętrzny, unikalny), kody ESCO/ISCO, typ i poziom umiejętności, ostatni
--    snapshot. Istniejące wiersze (0010) są 'manual' i import ich nie dotyka.
-- 3. occupation_labels/skill_labels — etykiety preferowane (jedna na język) i
--    alternatywne; język = FK do supported_locales (inny język zostanie odrzucony).
-- 4. occupation_skills — relacje zawód–umiejętność: essential | optional.
-- 5. RPC importu (tylko service_role, SECURITY INVOKER): esco_begin_snapshot,
--    esco_upsert_occupations, esco_upsert_skills, esco_upsert_relations,
--    esco_finish_snapshot. Upsert po esco_uri, etykiety i relacje w trybie
--    replace-all dla koncepcji ESCO — ponowny import tego samego snapshotu nie
--    tworzy duplikatów ani zmian. Koncepcja ESCO nieobecna w nowym snapshocie →
--    is_active = false (bez usuwania: candidate_skills/job_skills mają FK).
--    Wiersz ręczny (source='manual') z tym samym esco_uri: domyślnie błąd
--    ESCO_MANUAL_CONFLICT; nadpisanie lub pominięcie tylko jawną decyzją (p_manual).
-- 6. occupation_label/skill_label(id, locale) — deterministyczny fallback:
--    etykieta preferowana w języku → preferowana 'en' → occupations/skills.name.
--
-- Słowniki: odczyt publiczny (anon/authenticated), zapis wyłącznie service_role.
-- Import nie zmienia profili, ofert, aplikacji ani dopasowań (dowód: rls.sql ESCO93).
--
-- Rollback: supabase/rollback/0098_esco_taxonomy.down.sql (usuwa dane ESCO, tabele,
-- funkcje i kolumny; wiersze ręczne zostają). Dowód rollbacku: rls.sql ESCO93-R.
-- =============================================================================

-- --- 1. Metadane snapshotu --------------------------------------------------------------
create table public.esco_snapshots (
  id               text primary key check (id ~ '^[a-z0-9][a-z0-9.-]{2,62}$'),
  esco_version     text not null check (esco_version = 'v1.2.1'),
  is_sample        boolean not null,
  locales          text[] not null,
  files            jsonb not null check (jsonb_typeof(files) = 'object'),
  manifest_sha256  text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  attribution      text not null default
    'This service uses the ESCO classification of the European Commission. https://esco.ec.europa.eu/',
  first_imported_at timestamptz not null default now(),
  last_imported_at  timestamptz,
  import_count     integer not null default 0 check (import_count >= 0),
  last_report      jsonb,
  constraint esco_snapshots_sample_id check (is_sample = (id like '%-sample'))
);
comment on table public.esco_snapshots is
  'Przypięte snapshoty ESCO (#93): pliki + SHA-256, atrybucja, raport importu.';
-- Jedno realne wydanie danej wersji — drugi, inny zestaw plików tej wersji = odmowa.
create unique index esco_snapshots_one_real_per_version
  on public.esco_snapshots (esco_version) where not is_sample;

create function public.esco_snapshots_pin() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id
     or new.esco_version is distinct from old.esco_version
     or new.is_sample is distinct from old.is_sample
     or new.locales is distinct from old.locales
     or new.files is distinct from old.files
     or new.manifest_sha256 is distinct from old.manifest_sha256 then
    raise exception 'ESCO_CHECKSUM_MISMATCH' using errcode = '23514',
      detail = 'Pola przypięcia snapshotu ESCO są niezmienne.';
  end if;
  return new;
end $$;
revoke execute on function public.esco_snapshots_pin() from public;
create trigger trg_esco_snapshots_pin before update on public.esco_snapshots
  for each row execute function public.esco_snapshots_pin();

-- --- 2. Kolumny ESCO w słownikach ------------------------------------------------------------
alter table public.occupations
  add column source text not null default 'manual' check (source in ('manual', 'esco')),
  add column esco_uri text unique
    check (esco_uri ~ '^http://data\.europa\.eu/esco/occupation/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  add column esco_code text check (char_length(esco_code) <= 64),
  add column isco_group text check (char_length(isco_group) <= 64),
  add column esco_snapshot_id text references public.esco_snapshots(id) on delete set null,
  add constraint occupations_esco_has_uri check (source <> 'esco' or esco_uri is not null);

alter table public.skills
  add column source text not null default 'manual' check (source in ('manual', 'esco')),
  add column esco_uri text unique
    check (esco_uri ~ '^http://data\.europa\.eu/esco/skill/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  add column skill_type text check (skill_type in ('skill/competence', 'knowledge')),
  add column reuse_level text
    check (reuse_level in ('transversal', 'cross-sector', 'sector-specific', 'occupation-specific')),
  add column esco_snapshot_id text references public.esco_snapshots(id) on delete set null,
  add constraint skills_esco_has_uri check (source <> 'esco' or esco_uri is not null);

-- --- 3. Etykiety ---------------------------------------------------------------------------
create table public.occupation_labels (
  occupation_id uuid not null references public.occupations(id) on delete cascade,
  locale        text not null references public.supported_locales(code),
  kind          text not null check (kind in ('preferred', 'alternative')),
  label         text not null check (char_length(label) between 1 and 1000 and label = btrim(label)),
  primary key (occupation_id, locale, kind, label)
);
create unique index occupation_labels_one_preferred
  on public.occupation_labels (occupation_id, locale) where kind = 'preferred';
create index occupation_labels_search
  on public.occupation_labels using gin (label gin_trgm_ops);

create table public.skill_labels (
  skill_id uuid not null references public.skills(id) on delete cascade,
  locale   text not null references public.supported_locales(code),
  kind     text not null check (kind in ('preferred', 'alternative')),
  label    text not null check (char_length(label) between 1 and 1000 and label = btrim(label)),
  primary key (skill_id, locale, kind, label)
);
create unique index skill_labels_one_preferred
  on public.skill_labels (skill_id, locale) where kind = 'preferred';
create index skill_labels_search
  on public.skill_labels using gin (label gin_trgm_ops);

-- --- 4. Relacje zawód–umiejętność ------------------------------------------------------------
create table public.occupation_skills (
  occupation_id    uuid not null references public.occupations(id) on delete cascade,
  skill_id         uuid not null references public.skills(id) on delete cascade,
  relation_type    text not null check (relation_type in ('essential', 'optional')),
  source           text not null default 'esco' check (source in ('manual', 'esco')),
  esco_snapshot_id text references public.esco_snapshots(id) on delete set null,
  primary key (occupation_id, skill_id)
);
create index occupation_skills_skill on public.occupation_skills (skill_id);

-- --- Uprawnienia: odczyt publiczny, zapis tylko service_role -----------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['esco_snapshots', 'occupation_labels', 'skill_labels', 'occupation_skills'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_public_read', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
-- Słowniki z 0002: klient tylko czyta (polityka *_public_read z 0009).
revoke insert, update, delete, truncate on public.occupations, public.skills from anon, authenticated;
grant select on public.occupations, public.skills to anon, authenticated;
grant select, insert, update, delete on public.occupations, public.skills to service_role;

-- --- 5. RPC importu ----------------------------------------------------------------------------

-- Rozpoczęcie importu: walidacja i przypięcie manifestu. 'new' = pierwszy import,
-- 'repeat' = ten sam manifest ponownie (idempotentnie). Blokada serializuje importy.
create function public.esco_begin_snapshot(p_manifest jsonb, p_manifest_sha256 text)
returns text
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_id      text := p_manifest->>'snapshot';
  v_version text := p_manifest->>'escoVersion';
  v_sample  boolean;
  v_locales text[];
  v_row     public.esco_snapshots;
begin
  perform pg_advisory_xact_lock(724031, 98);
  if jsonb_typeof(p_manifest) <> 'object' or jsonb_typeof(p_manifest->'sample') <> 'boolean'
     or jsonb_typeof(p_manifest->'files') <> 'object' or jsonb_typeof(p_manifest->'locales') <> 'array'
     or v_id is null or p_manifest_sha256 is null or p_manifest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'ESCO_INVALID_MANIFEST' using errcode = '22023';
  end if;
  if v_version is distinct from 'v1.2.1' then
    raise exception 'ESCO_VERSION_NOT_PINNED' using errcode = '22023';
  end if;
  v_sample := (p_manifest->>'sample')::boolean;
  select array_agg(x order by x) into v_locales from jsonb_array_elements_text(p_manifest->'locales') x;
  if v_locales is distinct from (select array_agg(code order by code) from public.supported_locales) then
    raise exception 'ESCO_INVALID_MANIFEST' using errcode = '22023', detail = 'Języki ≠ supported_locales.';
  end if;

  select * into v_row from public.esco_snapshots where id = v_id for update;
  if found then
    if v_row.files <> p_manifest->'files' or v_row.manifest_sha256 <> p_manifest_sha256
       or v_row.is_sample <> v_sample or v_row.locales <> v_locales then
      raise exception 'ESCO_CHECKSUM_MISMATCH' using errcode = '23514';
    end if;
    return 'repeat';
  end if;
  if not v_sample and exists (
    select 1 from public.esco_snapshots where esco_version = v_version and not is_sample
  ) then
    raise exception 'ESCO_CHECKSUM_MISMATCH' using errcode = '23514',
      detail = 'Ta wersja ESCO jest już przypięta do innego zestawu plików.';
  end if;
  if v_sample and exists (select 1 from public.esco_snapshots where not is_sample) then
    raise exception 'ESCO_SAMPLE_AFTER_REAL' using errcode = '22023';
  end if;
  insert into public.esco_snapshots (id, esco_version, is_sample, locales, files, manifest_sha256)
  values (v_id, v_version, v_sample, v_locales, p_manifest->'files', p_manifest_sha256);
  return 'new';
end $$;

-- Wspólna synchronizacja etykiet (replace-all) dla koncepcji ESCO z paczki.
-- p_kind z listy dozwolonych → nazwy tabel/kolumn stałe, nie z danych.
create function public.esco_sync_labels(p_kind text, p_rows jsonb)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_parent text;
  v_table  text;
  v_fk     text;
  v_removed integer;
  v_added   integer;
begin
  if p_kind = 'occupation' then
    v_parent := 'occupations'; v_table := 'occupation_labels'; v_fk := 'occupation_id';
  elsif p_kind = 'skill' then
    v_parent := 'skills'; v_table := 'skill_labels'; v_fk := 'skill_id';
  else
    raise exception 'ESCO_INVALID_KIND' using errcode = '22023';
  end if;

  execute format($f$
    with src as (
      select c.id, r.labels
      from jsonb_to_recordset($1) as r(uri text, labels jsonb)
      join public.%1$I c on c.esco_uri = r.uri and c.source = 'esco'
    ), target as (
      select src.id, l.key as locale, 'preferred'::text as kind, l.value->>'preferred' as label
      from src cross join jsonb_each(src.labels) l
      where l.value->>'preferred' is not null
      union
      select src.id, l.key, 'alternative', a.value
      from src cross join jsonb_each(src.labels) l
      cross join jsonb_array_elements_text(coalesce(l.value->'alternative', '[]')) a(value)
    )
    delete from public.%2$I t
    using src
    where t.%3$I = src.id
      and not exists (select 1 from target x
                      where x.id = t.%3$I and x.locale = t.locale and x.kind = t.kind and x.label = t.label)
  $f$, v_parent, v_table, v_fk) using p_rows;
  get diagnostics v_removed = row_count;

  execute format($f$
    with src as (
      select c.id, r.labels
      from jsonb_to_recordset($1) as r(uri text, labels jsonb)
      join public.%1$I c on c.esco_uri = r.uri and c.source = 'esco'
    )
    insert into public.%2$I (%3$I, locale, kind, label)
    select src.id, l.key, 'preferred', l.value->>'preferred'
    from src cross join jsonb_each(src.labels) l
    where l.value->>'preferred' is not null
    union
    select src.id, l.key, 'alternative', a.value
    from src cross join jsonb_each(src.labels) l
    cross join jsonb_array_elements_text(coalesce(l.value->'alternative', '[]')) a(value)
    on conflict do nothing
  $f$, v_parent, v_table, v_fk) using p_rows;
  get diagnostics v_added = row_count;

  return jsonb_build_object('labelsAdded', v_added, 'labelsRemoved', v_removed);
end $$;

-- Konflikty z danymi ręcznymi: wiersz 'manual' z tym samym esco_uri.
-- fail (domyślnie) = błąd; skip = zostaw ręczny wiersz; overwrite = przejmij jako ESCO.
create function public.esco_resolve_manual(p_kind text, p_rows jsonb, p_manual text)
returns integer
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_parent text;
  v_count  integer;
begin
  if p_kind = 'occupation' then v_parent := 'occupations';
  elsif p_kind = 'skill' then v_parent := 'skills';
  else raise exception 'ESCO_INVALID_KIND' using errcode = '22023';
  end if;
  if p_manual is null or p_manual not in ('fail', 'skip', 'overwrite') then
    raise exception 'ESCO_INVALID_MANUAL_POLICY' using errcode = '22023';
  end if;

  -- Wolny slug dla nowych wierszy: kolizja z wierszem bez tego URI = błąd, nie nadpisanie.
  execute format($f$
    select count(*)::int from jsonb_to_recordset($1) as r(uri text)
    join public.%1$I c on c.slug = 'esco-' || split_part(r.uri, '/', 6)
    where c.esco_uri is distinct from r.uri
  $f$, v_parent) into strict v_count using p_rows;
  if v_count > 0 then
    raise exception 'ESCO_SLUG_CONFLICT' using errcode = '23505',
      detail = format('%s wierszy ma slug ESCO bez tego URI.', v_count);
  end if;

  execute format($f$
    select count(*)::int from public.%1$I c
    join jsonb_to_recordset($1) as r(uri text) on r.uri = c.esco_uri
    where c.source = 'manual'
  $f$, v_parent) into v_count using p_rows;
  if v_count > 0 and p_manual = 'fail' then
    raise exception 'ESCO_MANUAL_CONFLICT' using errcode = '23505',
      detail = format('%s ręcznych wierszy ma ten sam esco_uri; wybierz jawnie skip albo overwrite.', v_count);
  end if;
  if v_count > 0 and p_manual = 'overwrite' then
    execute format($f$
      update public.%1$I c set source = 'esco'
      from jsonb_to_recordset($1) as r(uri text)
      where r.uri = c.esco_uri and c.source = 'manual'
    $f$, v_parent) using p_rows;
  end if;
  return case when p_manual = 'skip' then v_count else 0 end;
end $$;

create function public.esco_upsert_occupations(p_snapshot_id text, p_rows jsonb, p_manual text default 'fail')
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_sample   boolean;
  v_skipped  integer;
  v_inserted integer;
  v_changed  integer;
  v_labels   jsonb;
begin
  select is_sample into v_sample from public.esco_snapshots where id = p_snapshot_id;
  if not found then raise exception 'ESCO_SNAPSHOT_NOT_STARTED' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'ESCO_INVALID_ROWS' using errcode = '22023'; end if;
  v_skipped := public.esco_resolve_manual('occupation', p_rows, p_manual);

  with src as (
    select * from jsonb_to_recordset(p_rows)
      as r(uri text, code text, "iscoGroup" text, active boolean, name text)
  ), upserted as (
    insert into public.occupations
      (slug, name, source, esco_uri, esco_code, isco_group, is_active, is_demo, esco_snapshot_id)
    select 'esco-' || split_part(src.uri, '/', 6), src.name, 'esco', src.uri, src.code, src."iscoGroup",
           coalesce(src.active, false), v_sample, p_snapshot_id
    from src
    where not exists (select 1 from public.occupations m where m.esco_uri = src.uri and m.source = 'manual')
    on conflict (esco_uri) do update set
      name = excluded.name, esco_code = excluded.esco_code, isco_group = excluded.isco_group,
      is_active = excluded.is_active, is_demo = excluded.is_demo, esco_snapshot_id = excluded.esco_snapshot_id
    where occupations.source = 'esco'
      and (occupations.name, occupations.esco_code, occupations.isco_group, occupations.is_active,
           occupations.is_demo, occupations.esco_snapshot_id)
          is distinct from
          (excluded.name, excluded.esco_code, excluded.isco_group, excluded.is_active,
           excluded.is_demo, excluded.esco_snapshot_id)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
    into v_inserted, v_changed from upserted;

  v_labels := public.esco_sync_labels('occupation', p_rows);
  return jsonb_build_object('inserted', v_inserted, 'updated', v_changed, 'manualSkipped', v_skipped) || v_labels;
end $$;

create function public.esco_upsert_skills(p_snapshot_id text, p_rows jsonb, p_manual text default 'fail')
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_sample   boolean;
  v_skipped  integer;
  v_inserted integer;
  v_changed  integer;
  v_labels   jsonb;
begin
  select is_sample into v_sample from public.esco_snapshots where id = p_snapshot_id;
  if not found then raise exception 'ESCO_SNAPSHOT_NOT_STARTED' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'ESCO_INVALID_ROWS' using errcode = '22023'; end if;
  v_skipped := public.esco_resolve_manual('skill', p_rows, p_manual);

  with src as (
    select * from jsonb_to_recordset(p_rows)
      as r(uri text, "skillType" text, "reuseLevel" text, active boolean, name text)
  ), upserted as (
    insert into public.skills
      (slug, name, source, esco_uri, skill_type, reuse_level, is_active, is_demo, esco_snapshot_id)
    select 'esco-' || split_part(src.uri, '/', 6), src.name, 'esco', src.uri, src."skillType", src."reuseLevel",
           coalesce(src.active, false), v_sample, p_snapshot_id
    from src
    where not exists (select 1 from public.skills m where m.esco_uri = src.uri and m.source = 'manual')
    on conflict (esco_uri) do update set
      name = excluded.name, skill_type = excluded.skill_type, reuse_level = excluded.reuse_level,
      is_active = excluded.is_active, is_demo = excluded.is_demo, esco_snapshot_id = excluded.esco_snapshot_id
    where skills.source = 'esco'
      and (skills.name, skills.skill_type, skills.reuse_level, skills.is_active, skills.is_demo, skills.esco_snapshot_id)
          is distinct from
          (excluded.name, excluded.skill_type, excluded.reuse_level, excluded.is_active, excluded.is_demo,
           excluded.esco_snapshot_id)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
    into v_inserted, v_changed from upserted;

  v_labels := public.esco_sync_labels('skill', p_rows);
  return jsonb_build_object('inserted', v_inserted, 'updated', v_changed, 'manualSkipped', v_skipped) || v_labels;
end $$;

-- Relacje: tylko między koncepcjami ESCO; ręczne relacje i ręczne koncepcje nietknięte.
create function public.esco_upsert_relations(p_snapshot_id text, p_rows jsonb)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_unknown  integer;
  v_skipped  integer;
  v_inserted integer;
  v_changed  integer;
begin
  perform 1 from public.esco_snapshots where id = p_snapshot_id;
  if not found then raise exception 'ESCO_SNAPSHOT_NOT_STARTED' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'ESCO_INVALID_ROWS' using errcode = '22023'; end if;

  select count(*) filter (where o.id is null or s.id is null),
         count(*) filter (where o.source <> 'esco' or s.source <> 'esco')
    into v_unknown, v_skipped
  from jsonb_to_recordset(p_rows) as r("occupationUri" text, "skillUri" text, "relationType" text)
  left join public.occupations o on o.esco_uri = r."occupationUri"
  left join public.skills s on s.esco_uri = r."skillUri";
  if v_unknown > 0 then
    raise exception 'ESCO_UNKNOWN_CONCEPT' using errcode = '23503',
      detail = format('%s relacji wskazuje nieznane URI.', v_unknown);
  end if;

  with upserted as (
    insert into public.occupation_skills (occupation_id, skill_id, relation_type, source, esco_snapshot_id)
    select o.id, s.id, r."relationType", 'esco', p_snapshot_id
    from jsonb_to_recordset(p_rows) as r("occupationUri" text, "skillUri" text, "relationType" text)
    join public.occupations o on o.esco_uri = r."occupationUri" and o.source = 'esco'
    join public.skills s on s.esco_uri = r."skillUri" and s.source = 'esco'
    on conflict (occupation_id, skill_id) do update set
      relation_type = excluded.relation_type, esco_snapshot_id = excluded.esco_snapshot_id
    where occupation_skills.source = 'esco'
      and (occupation_skills.relation_type, occupation_skills.esco_snapshot_id)
          is distinct from (excluded.relation_type, excluded.esco_snapshot_id)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
    into v_inserted, v_changed from upserted;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_changed, 'manualSkipped', v_skipped);
end $$;

-- Zakończenie: koncepcje ESCO spoza snapshotu → nieaktywne, relacje spoza → usunięte.
create function public.esco_finish_snapshot(p_snapshot_id text, p_report jsonb)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_occ  integer;
  v_sk   integer;
  v_rel  integer;
begin
  perform 1 from public.esco_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'ESCO_SNAPSHOT_NOT_STARTED' using errcode = '22023'; end if;

  update public.occupations set is_active = false
  where source = 'esco' and is_active and esco_snapshot_id is distinct from p_snapshot_id;
  get diagnostics v_occ = row_count;
  update public.skills set is_active = false
  where source = 'esco' and is_active and esco_snapshot_id is distinct from p_snapshot_id;
  get diagnostics v_sk = row_count;
  delete from public.occupation_skills
  where source = 'esco' and esco_snapshot_id is distinct from p_snapshot_id;
  get diagnostics v_rel = row_count;

  update public.esco_snapshots
  set last_imported_at = now(), import_count = import_count + 1, last_report = p_report
  where id = p_snapshot_id;
  return jsonb_build_object('deactivatedOccupations', v_occ, 'deactivatedSkills', v_sk, 'removedRelations', v_rel);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'esco_begin_snapshot(jsonb, text)',
    'esco_sync_labels(text, jsonb)',
    'esco_resolve_manual(text, jsonb, text)',
    'esco_upsert_occupations(text, jsonb, text)',
    'esco_upsert_skills(text, jsonb, text)',
    'esco_upsert_relations(text, jsonb)',
    'esco_finish_snapshot(text, jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- --- 6. Etykieta z fallbackiem ------------------------------------------------------------
-- Deterministycznie: preferowana w języku → preferowana 'en' → name. Nieobsługiwany
-- lub NULL język = od razu 'en'.
create function public.occupation_label(p_occupation_id uuid, p_locale text)
returns text
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(
    (select label from public.occupation_labels
      where occupation_id = p_occupation_id and kind = 'preferred' and locale = p_locale),
    (select label from public.occupation_labels
      where occupation_id = p_occupation_id and kind = 'preferred' and locale = 'en'),
    (select name from public.occupations where id = p_occupation_id));
$$;

create function public.skill_label(p_skill_id uuid, p_locale text)
returns text
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(
    (select label from public.skill_labels
      where skill_id = p_skill_id and kind = 'preferred' and locale = p_locale),
    (select label from public.skill_labels
      where skill_id = p_skill_id and kind = 'preferred' and locale = 'en'),
    (select name from public.skills where id = p_skill_id));
$$;

revoke execute on function public.occupation_label(uuid, text), public.skill_label(uuid, text) from public;
grant execute on function public.occupation_label(uuid, text), public.skill_label(uuid, text)
  to anon, authenticated, service_role;
