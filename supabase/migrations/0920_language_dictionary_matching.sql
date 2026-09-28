-- =============================================================================
-- 0920_language_dictionary_matching.sql  (numer TYMCZASOWY — ostateczny nada integrator)
--
-- Języki ze słownika `public.languages` zamiast wolnego tekstu (audyt I18N-02 / CF-02,
-- część LIM17-05). Dotąd kandydat w UI PL zapisywał „niderlandzki”, firma w UI NL wymagała
-- „Nederlands”, a dopasowanie porównywało napisy — język trafiał do „brakuje”.
--
-- 1. `language_alias_key(text)` — klucz porównania nazw (NFC, `search_fold`, złożone spacje);
--    lustro `languageAliasKey` w `src/lib/languages.ts`.
-- 2. `language_aliases` — nazwy języków w PL/NL/FR/EN (i nazwy własne) → `languages.id`;
--    odczyt publiczny, zapis tylko service_role. Lista = `LANGUAGE_ALIASES` w kodzie
--    (test `language-dictionary` porównuje 1:1).
-- 3. `language_id_for_label(text)` — pozycja z formularza/RPC → id: dokładny kod (`nl`),
--    potem nazwa ze słownika, potem alias. Nieznana etykieta → null (zostaje tekstem).
-- 4. `job_languages.language_id` (nowa kolumna) + trigger na `job_languages`
--    i `candidate_languages`: każda ścieżka zapisu (kreator, onboarding, import CV,
--    duplikat oferty, seed) uzupełnia id z etykiety, jeśli nie podano.
-- 5. Backfill istniejących wpisów tekstowych. Niedopasowane zostają jako etykieta
--    (`language_id` null) — bez utraty danych; etykieta niczego nie traci.
-- 6. `set_candidate_languages` / `set_job_languages`: pozycja `language` = kod albo etykieta;
--    kod zapisuje nazwę słownikową jako etykietę zastępczą; deduplikacja po języku
--    (dwa warianty tej samej nazwy = jeden wiersz z wyższym poziomem).
-- 7. `get_job_match_profile.language_requirements` i `match_candidate_input.languages`
--    niosą kod — `scoreMatch` dopasowuje po kodzie (lustro w TS dla etykiet bez kodu).
--
-- Rollback (ręczny, dane etykiet nietknięte): odtworzyć set_candidate_languages (0028),
-- set_job_languages (0077), get_job_match_profile (0074), match_candidate_input (0147);
-- drop trigger trg_*_languages_fill_id; drop function fill_language_id(),
-- normalize_language_entries(jsonb, integer), language_id_for_label(text);
-- drop table language_aliases; alter table job_languages drop column language_id;
-- drop function language_alias_key(text).
-- =============================================================================

-- --- 1. Klucz porównania -------------------------------------------------------
create or replace function public.language_alias_key(p_value text)
returns text language sql immutable strict parallel safe set search_path = public, pg_temp as $$
  select pg_catalog.regexp_replace(pg_catalog.btrim(public.search_fold(normalize(p_value, NFC))),
                                   '\s+', ' ', 'g');
$$;
grant execute on function public.language_alias_key(text) to anon, authenticated, service_role;

-- --- 2. Aliasy nazw ------------------------------------------------------------
create table if not exists public.language_aliases (
  alias_key   text primary key
    constraint language_aliases_key_format check (alias_key = public.language_alias_key(alias_key)),
  alias       text not null constraint language_aliases_alias_len check (char_length(alias) between 1 and 80),
  language_id uuid not null references public.languages(id) on delete cascade on update cascade,
  created_at  timestamptz not null default now()
);
create index if not exists language_aliases_language_idx on public.language_aliases (language_id);

alter table public.language_aliases enable row level security;
drop policy if exists language_aliases_public_read on public.language_aliases;
create policy language_aliases_public_read on public.language_aliases
  for select to anon, authenticated using (true);
revoke all on public.language_aliases from anon, authenticated;
grant select on public.language_aliases to anon, authenticated;
grant select, insert, update, delete on public.language_aliases to service_role;

insert into public.language_aliases (alias_key, alias, language_id)
select public.language_alias_key(v.alias), v.alias, l.id
  from (values
  ('pl', 'polski'),
  ('pl', 'Pools'),
  ('pl', 'polonais'),
  ('pl', 'Polish'),
  ('pl', 'język polski'),
  ('nl', 'niderlandzki'),
  ('nl', 'holenderski'),
  ('nl', 'flamandzki'),
  ('nl', 'Nederlands'),
  ('nl', 'Vlaams'),
  ('nl', 'néerlandais'),
  ('nl', 'flamand'),
  ('nl', 'Dutch'),
  ('nl', 'Flemish'),
  ('nl', 'język niderlandzki'),
  ('fr', 'francuski'),
  ('fr', 'Frans'),
  ('fr', 'français'),
  ('fr', 'French'),
  ('fr', 'język francuski'),
  ('en', 'angielski'),
  ('en', 'Engels'),
  ('en', 'anglais'),
  ('en', 'English'),
  ('en', 'język angielski'),
  ('de', 'niemiecki'),
  ('de', 'Duits'),
  ('de', 'allemand'),
  ('de', 'German'),
  ('de', 'Deutsch'),
  ('de', 'język niemiecki'),
  ('ro', 'rumuński'),
  ('ro', 'Roemeens'),
  ('ro', 'roumain'),
  ('ro', 'Romanian'),
  ('ro', 'română'),
  ('bg', 'bułgarski'),
  ('bg', 'Bulgaars'),
  ('bg', 'bulgare'),
  ('bg', 'Bulgarian'),
  ('uk', 'ukraiński'),
  ('uk', 'Oekraïens'),
  ('uk', 'ukrainien'),
  ('uk', 'Ukrainian'),
  ('ru', 'rosyjski'),
  ('ru', 'Russisch'),
  ('ru', 'russe'),
  ('ru', 'Russian'),
  ('es', 'hiszpański'),
  ('es', 'Spaans'),
  ('es', 'espagnol'),
  ('es', 'Spanish'),
  ('es', 'español'),
  ('it', 'włoski'),
  ('it', 'Italiaans'),
  ('it', 'italien'),
  ('it', 'Italian'),
  ('it', 'italiano'),
  ('pt', 'portugalski'),
  ('pt', 'Portugees'),
  ('pt', 'portugais'),
  ('pt', 'Portuguese'),
  ('pt', 'português'),
  ('tr', 'turecki'),
  ('tr', 'Turks'),
  ('tr', 'turc'),
  ('tr', 'Turkish'),
  ('tr', 'Türkçe'),
  ('ar', 'arabski'),
  ('ar', 'Arabisch'),
  ('ar', 'arabe'),
  ('ar', 'Arabic')
  ) as v(code, alias)
  join public.languages l on l.code = v.code
on conflict (alias_key) do update set alias = excluded.alias, language_id = excluded.language_id;

-- --- 3. Etykieta/kod → id ------------------------------------------------------
create or replace function public.language_id_for_label(p_value text)
returns uuid language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    (select l.id from public.languages l
      where l.is_active and l.code = pg_catalog.btrim(p_value) limit 1),
    (select l.id from public.languages l
      where l.is_active and public.language_alias_key(l.name) = public.language_alias_key(p_value)
      order by l.sort_order limit 1),
    (select a.language_id from public.language_aliases a
       join public.languages l on l.id = a.language_id and l.is_active
      where a.alias_key = public.language_alias_key(p_value)));
$$;
revoke all on function public.language_id_for_label(text) from public;
grant execute on function public.language_id_for_label(text) to anon, authenticated, service_role;

-- --- 4. Kolumna i trigger uzupełniający ----------------------------------------
alter table public.job_languages
  add column if not exists language_id uuid references public.languages(id) on delete set null on update cascade;
create index if not exists idx_job_languages_language on public.job_languages (language_id);

-- candidate_languages.language_id (0004) bez ON UPDATE — seed demo podmienia id słownika.
alter table public.candidate_languages drop constraint if exists candidate_languages_language_id_fkey;
alter table public.candidate_languages
  add constraint candidate_languages_language_id_fkey
  foreign key (language_id) references public.languages(id) on delete set null on update cascade;

create or replace function public.fill_language_id()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.language_id is null then
      new.language_id := public.language_id_for_label(new.language_label);
    end if;
  elsif new.language_label is distinct from old.language_label
        and new.language_id is not distinct from old.language_id then
    new.language_id := public.language_id_for_label(new.language_label);
  end if;
  return new;
end $$;

drop trigger if exists trg_job_languages_fill_id on public.job_languages;
create trigger trg_job_languages_fill_id
  before insert or update of language_label, language_id on public.job_languages
  for each row execute function public.fill_language_id();
drop trigger if exists trg_candidate_languages_fill_id on public.candidate_languages;
create trigger trg_candidate_languages_fill_id
  before insert or update of language_label, language_id on public.candidate_languages
  for each row execute function public.fill_language_id();

-- --- 5. Backfill (niedopasowane zostają etykietą) ------------------------------
update public.job_languages
   set language_id = public.language_id_for_label(language_label)
 where language_id is null and public.language_id_for_label(language_label) is not null;
update public.candidate_languages
   set language_id = public.language_id_for_label(language_label)
 where language_id is null and public.language_id_for_label(language_label) is not null;

-- --- 6. RPC zapisu -------------------------------------------------------------
-- Wspólna normalizacja listy {language, level}: kod albo etykieta → (id, etykieta, poziom),
-- jedna pozycja na język (wyższy poziom wygrywa), limit jak dotąd.
create or replace function public.normalize_language_entries(p_entries jsonb, p_limit integer)
returns table (language_id uuid, label text, lvl public.language_level)
language sql stable set search_path = public, pg_temp as $$
  select q.language_id, q.label, q.lvl from (
    select distinct on (coalesce(r.language_id::text, 'label:' || public.language_alias_key(r.label)))
           r.language_id, r.label, r.lvl, r.ord
      from (
        select public.language_id_for_label(e.v ->> 'language') as language_id,
               case when exists (select 1 from public.languages l
                                  where l.is_active and l.code = pg_catalog.btrim(e.v ->> 'language'))
                    then (select l.name from public.languages l where l.code = pg_catalog.btrim(e.v ->> 'language'))
                    else left(pg_catalog.btrim(e.v ->> 'language'), 80) end as label,
               nullif(e.v ->> 'level', '')::public.language_level as lvl,
               e.ord
          from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) with ordinality as e(v, ord)
         where pg_catalog.btrim(coalesce(e.v ->> 'language', '')) <> ''
         limit p_limit
      ) r
     order by coalesce(r.language_id::text, 'label:' || public.language_alias_key(r.label)),
              r.lvl desc nulls last, r.ord
  ) q
  order by q.ord;
$$;
revoke all on function public.normalize_language_entries(jsonb, integer) from public, anon, authenticated;

create or replace function public.set_candidate_languages(p_languages jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cp uuid := public.ensure_candidate_profile();
begin
  delete from public.candidate_languages where candidate_profile_id = v_cp;
  insert into public.candidate_languages (candidate_profile_id, language_id, language_label, level)
    select v_cp, n.language_id, n.label, n.lvl
      from public.normalize_language_entries(p_languages, 30) n
  on conflict (candidate_profile_id, language_label) do nothing;
end $$;
revoke all on function public.set_candidate_languages(jsonb) from public;
grant execute on function public.set_candidate_languages(jsonb) to authenticated;

create or replace function public.set_job_languages(
  p_job_id uuid, p_languages jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_job_manager(p_job_id) then
    raise exception 'PERMISSION_DENIED: zapis języków wymaga roli recruiter+' using errcode = '42501';
  end if;
  perform public.assert_job_draft_or_editing(p_job_id);
  delete from public.job_languages where job_id = p_job_id;
  insert into public.job_languages (job_id, language_id, language_label, level)
    select p_job_id, n.language_id, n.label, n.lvl
      from public.normalize_language_entries(p_languages, 30) n
  on conflict (job_id, language_label) do nothing;
end $$;
revoke all on function public.set_job_languages(uuid, jsonb) from public;
grant execute on function public.set_job_languages(uuid, jsonb) to authenticated;

-- --- 7. Wejścia dopasowania z kodem --------------------------------------------
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
revoke all on function public.get_job_match_profile(uuid) from public;
grant execute on function public.get_job_match_profile(uuid) to authenticated;

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
                                                              'level', l.level::text,
                                                              'language_code', lg.code)
                                            order by l.language_label)
                           from public.candidate_languages l
                           left join public.languages lg on lg.id = l.language_id
                          where l.candidate_profile_id = cp.id), '[]'::jsonb),
    'certificates', coalesce((select jsonb_agg(jsonb_build_object('certificate_label', c.certificate_label,
                                                                 'expires_at', c.expires_at::text)
                                               order by c.certificate_label)
                              from public.candidate_certificates c where c.candidate_profile_id = cp.id), '[]'::jsonb)
  )
  from public.candidate_profiles cp
  where cp.profile_id = p_candidate;
$$;
revoke all on function public.match_candidate_input(uuid) from public, anon, authenticated;

-- Istniejące dopasowania liczone po starych etykietach: backfill kolumn relacji zgłasza
-- podmioty triggerami 0147 (UPDATE na *_languages), więc worker przeliczy je sam.
