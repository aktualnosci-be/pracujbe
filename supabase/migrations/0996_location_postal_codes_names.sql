-- =============================================================================
-- 0996_location_postal_codes_names.sql — miasto oferty z dopiskiem i nazwy miejscowości
-- w języku widoku (#1119, #1076/M-4). NUMER TYMCZASOWY — ostateczny nada integrator.
--
-- Problem 1: `jobs.location_id` (0153) rozpoznaje miejscowość po CAŁYM kluczu `city_key`.
-- Oferta zapisana z dopiskiem przy mieście („Bruxelles 1000”, „1000 Bruxelles”,
-- „B-1000 Bruxelles”, „Leuven (3000)”, „Gent, België”) dostawała `location_id = null` i wypadała
-- z filtra rozpoznanego miasta (lista, licznik, landing, facety, zapisane wyszukiwania).
-- Naprawa: `location_lookup_key(text)` — klucz bez belgijskiego kodu pocztowego (4 cyfry,
-- opcjonalnie z prefiksem B/BE) i bez nazwy kraju na końcu. `resolve_location_id` najpierw
-- szuka pełnego klucza (bez zmian dla nazw bez dopisku), dopiero potem klucza bez dopisku;
-- `location_filter_ids` i przez nią `search_city_candidates` korzystają z tej samej reguły,
-- a trigger słownika (`location_aliases_relink_jobs`) dowiązuje oferty także po kluczu bez
-- dopisku. Sam kod pocztowy („1000”) nie wskazuje miejscowości (brak danych kodów w słowniku).
-- Backfill istniejących ofert bez podbicia `updated_at` (token CAS edycji, #325).
--
-- Problem 2: facet lokalizacji spoza 10 miast z plików tłumaczeń pokazywał `locations.name`
-- (nazwa angielska z Wikidata, np. „Aalst” na stronie FR zamiast „Alost”), bo aliasy nie mają
-- języka (jeden alias bywa wspólny dla kilku języków). Naprawa: tabela `location_names`
-- (miejscowość × język serwisu → nazwa; tylko nazwy różne od `locations.name`, dane z migawki
-- Wikidata przez generator) i `location_display_name(nazwa, język)`. Facety NIE są tu
-- redefiniowane (PR #1259 zmienia ich treść) — nazwę podmienia zapytanie aplikacji wokół RPC
-- (`src/lib/db/public-jobs.ts`), a podpowiedź miasta w kreatorze używa tej samej funkcji.
-- Nazwa w języku widoku jest zarazem wartością filtra, więc funkcja zwraca ją tylko, gdy
-- wskazuje tę samą miejscowość (inaczej `locations.name`).
--
-- Rollback: supabase/rollback/0996_location_postal_codes_names.down.sql
-- =============================================================================

-- --- 1. Klucz miasta bez kodu pocztowego i nazwy kraju -----------------------------------------
-- Lustro TS: `cityLookupKey` w src/lib/matching/belgian-cities.ts (te same przypadki w rls.sql
-- sekcja PC1119 i tests/unit/location-postal-names.test.ts).
create or replace function public.location_lookup_key(p_city text)
returns text language sql immutable strict parallel safe as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(public.city_key(p_city), '[(),;/]+', ' ', 'g'),
        '\m(be? ?)?[1-9][0-9]{3}\M', ' ', 'g'),
      '\m(belgie|belgique|belgium|belgia|belgien)\M', ' ', 'g'),
    '[[:space:]]+', ' ', 'g'));
$$;
revoke all on function public.location_lookup_key(text) from public;
grant execute on function public.location_lookup_key(text) to anon, authenticated, service_role;

-- --- 2. Miejscowość: pełny klucz, potem klucz bez dopisku ---------------------------------------
create or replace function public.resolve_location_id(p_city text)
returns uuid language sql stable parallel safe security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select a.location_id
       from public.location_aliases a
       join public.locations l on l.id = a.location_id and l.is_active
      where a.alias_key = public.city_key(left(p_city, 200))
      limit 1),
    (select a.location_id
       from public.location_aliases a
       join public.locations l on l.id = a.location_id and l.is_active
      where a.alias_key = public.location_lookup_key(left(p_city, 200))
        and public.location_lookup_key(left(p_city, 200)) <> ''
      limit 1));
$$;
revoke all on function public.resolve_location_id(text) from public;
grant execute on function public.resolve_location_id(text) to anon, authenticated, service_role;

-- Wartości filtra → miejscowości (ta sama reguła co zapis oferty) + ich części (stan 0183).
create or replace function public.location_filter_ids(p_values text[])
returns uuid[] language sql stable parallel safe security definer set search_path = public, pg_temp as $$
  with matched as (
    select distinct public.resolve_location_id(v) as location_id
    from unnest(p_values[1:100]) v
    where public.resolve_location_id(v) is not null
  )
  select coalesce(array_agg(distinct x.location_id), '{}'::uuid[])
  from (
    select m.location_id from matched m
    union
    select s.id from matched m
    join public.locations s on s.parent_location_id = m.location_id and s.is_active
  ) x;
$$;
revoke all on function public.location_filter_ids(text[]) from public;
grant execute on function public.location_filter_ids(text[]) to anon, authenticated, service_role;

-- Nowy alias dowiązuje oferty bez miejscowości także zapisane z dopiskiem (stan 0153 + klucz).
create or replace function public.location_aliases_relink_jobs()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.jobs j
     set location_id = public.resolve_location_id(j.city)
   where j.location_id is null
     and (public.city_key(j.city) in (select n.alias_key from new_aliases n)
          or public.location_lookup_key(j.city) in (select n.alias_key from new_aliases n));
  return null;
end $$;
revoke all on function public.location_aliases_relink_jobs() from public, anon, authenticated;

-- --- 3. Nazwy miejscowości w językach serwisu --------------------------------------------------
create table if not exists public.location_names (
  location_id uuid not null references public.locations(id) on delete cascade on update cascade,
  locale      text not null references public.supported_locales(code) on update cascade,
  name        text not null constraint location_names_name_len check (char_length(name) between 1 and 120),
  created_at  timestamptz not null default now(),
  primary key (location_id, locale)
);
comment on table public.location_names is
  'Nazwa miejscowości w języku serwisu (#1119, 0996). Brak wiersza = locations.name. Dane z migawki Wikidata (generator scripts/locations/build-migration.mjs).';

alter table public.location_names enable row level security;
drop policy if exists location_names_public_read on public.location_names;
create policy location_names_public_read on public.location_names
  for select to anon, authenticated using (true);
revoke all on public.location_names from anon, authenticated;
grant select on public.location_names to anon, authenticated;
grant select, insert, update, delete on public.location_names to service_role;

-- BEGIN GENERATED location_names (node scripts/locations/build-migration.mjs)
-- 153 nazw (PL/NL/FR/EN) z migawki Wikidata (CC0 1.0), tylko różne od locations.name.
insert into public.location_names (location_id, locale, name)
select l.id, v.locale, v.name
from (values
  ('namur', 'nl', 'Namen'),
  ('mons', 'nl', 'Bergen'),
  ('aalst', 'fr', 'Alost'),
  ('ostend', 'pl', 'Ostenda'),
  ('ostend', 'nl', 'Oostende'),
  ('ostend', 'fr', 'Ostende'),
  ('roeselare', 'fr', 'Roulers'),
  ('tournai', 'nl', 'Doornik'),
  ('mouscron', 'nl', 'Moeskroen'),
  ('dendermonde', 'fr', 'Termonde'),
  ('vilvoorde', 'fr', 'Vilvorde'),
  ('wavre', 'nl', 'Waver'),
  ('halle', 'fr', 'Hal'),
  ('lier', 'fr', 'Lierre'),
  ('sint-truiden', 'fr', 'Saint-Trond'),
  ('tongeren', 'fr', 'Tongres'),
  ('ypres', 'pl', 'Ieper'),
  ('ypres', 'nl', 'Ieper'),
  ('nivelles', 'nl', 'Nijvel'),
  ('knokke-heist', 'fr', 'Knocke-Heyst'),
  ('arlon', 'nl', 'Aarlen'),
  ('bastogne', 'nl', 'Bastenaken'),
  ('wommelgem', 'fr', 'Wommelghem'),
  ('nijlen', 'fr', 'Nylen'),
  ('sint-amands', 'fr', 'Saint-Amand'),
  ('sint-katelijne-waver', 'fr', 'Wavre-Sainte-Catherine'),
  ('willebroek', 'fr', 'Willebroeck'),
  ('puurs-sint-amands', 'fr', 'Puers-Saint-Amand'),
  ('baarle-hertog', 'fr', 'Baerle-Duc'),
  ('hoogstraten', 'fr', 'Hogstrate'),
  ('oud-turnhout', 'fr', 'Vieux-Turnhout'),
  ('retie', 'fr', 'Réthy'),
  ('auderghem', 'nl', 'Oudergem'),
  ('berchem-sainte-agathe', 'nl', 'Sint-Agatha-Berchem'),
  ('forest', 'nl', 'Vorst'),
  ('elsene', 'fr', 'Ixelles'),
  ('sint-jans-molenbeek', 'pl', 'Molenbeek-Saint-Jean'),
  ('sint-jans-molenbeek', 'fr', 'Molenbeek-Saint-Jean'),
  ('saint-gilles', 'pl', 'Sint-Gillis'),
  ('saint-gilles', 'nl', 'Sint-Gillis'),
  ('saint-josse-ten-noode', 'nl', 'Sint-Joost-ten-Node'),
  ('schaarbeek', 'fr', 'Schaerbeek'),
  ('uccle', 'pl', 'Ukkel'),
  ('uccle', 'nl', 'Ukkel'),
  ('watermael-boitsfort', 'nl', 'Watermaal-Bosvoorde'),
  ('woluwe-saint-lambert', 'pl', 'Sint-Lambrechts-Woluwe'),
  ('woluwe-saint-lambert', 'nl', 'Sint-Lambrechts-Woluwe'),
  ('woluwe-saint-pierre', 'nl', 'Sint-Pieters-Woluwe'),
  ('bever', 'fr', 'Biévène'),
  ('galmaarden', 'fr', 'Gammerages'),
  ('herne', 'fr', 'Hérinnes'),
  ('hoeilaart', 'fr', 'Hoeilaert'),
  ('kapelle-op-den-bos', 'fr', 'Capelle-au-Bois'),
  ('sint-pieters-leeuw', 'fr', 'Leeuw-Saint-Pierre'),
  ('sint-genesius-rode', 'fr', 'Rhode-Saint-Genèse'),
  ('affligem', 'fr', 'Afflighem'),
  ('aarschot', 'fr', 'Aerschot'),
  ('haacht', 'fr', 'Haecht'),
  ('kortenberg', 'fr', 'Cortenbergh'),
  ('rotselaar', 'fr', 'Rotselaer'),
  ('tienen', 'fr', 'Tirlemont'),
  ('zoutleeuw', 'fr', 'Léau'),
  ('scherpenheuvel-zichem', 'fr', 'Montaigu-Zichem'),
  ('beauvechain', 'nl', 'Bevekom'),
  ('braine-lalleud', 'nl', 'Eigenbrakel'),
  ('braine-le-chateau', 'nl', 'Kasteelbrakel'),
  ('genappe', 'nl', 'Genepiën'),
  ('grez-doiceau', 'nl', 'Graven'),
  ('ittre', 'nl', 'Itter'),
  ('jodoigne', 'nl', 'Geldenaken'),
  ('la-hulpe', 'nl', 'Terhulpen'),
  ('perwez', 'nl', 'Perwijs'),
  ('tubize', 'nl', 'Tubeke'),
  ('helecine', 'nl', 'Heilissem'),
  ('blankenberge', 'fr', 'Blanckenberghe'),
  ('torhout', 'fr', 'Thourout'),
  ('zedelgem', 'fr', 'Zedelghem'),
  ('zuienkerke', 'fr', 'Zuyenkerque'),
  ('diksmuide', 'fr', 'Dixmude'),
  ('mesen', 'fr', 'Messines'),
  ('wervik', 'fr', 'Wervicq'),
  ('anzegem', 'fr', 'Anseghem'),
  ('avelgem', 'fr', 'Avelghem'),
  ('kuurne', 'fr', 'Cuerne'),
  ('menen', 'fr', 'Menin'),
  ('spiere-helkijn', 'fr', 'Espierres-Helchin'),
  ('ghistelles', 'pl', 'Gistel'),
  ('ichtegem', 'fr', 'Ichteghem'),
  ('oudenburg', 'fr', 'Audembourg'),
  ('de-haan', 'fr', 'Le Coq'),
  ('izegem', 'fr', 'Iseghem'),
  ('ledegem', 'fr', 'Ledeghem'),
  ('dentergem', 'fr', 'Denterghem'),
  ('ardooie', 'fr', 'Ardoye'),
  ('de-panne', 'fr', 'La Panne'),
  ('koksijde', 'fr', 'Coxyde'),
  ('nieuwpoort', 'fr', 'Nieuport'),
  ('veurne', 'fr', 'Furnes'),
  ('geraardsbergen', 'fr', 'Grammont'),
  ('sint-lievens-houtem', 'fr', 'Hautem-Saint-Liévin'),
  ('laarne', 'fr', 'Laerne'),
  ('waasmunster', 'fr', 'Waesmunster'),
  ('maldegem', 'fr', 'Maldeghem'),
  ('sint-laureins', 'fr', 'Saint-Laurent'),
  ('de-pinte', 'fr', 'La Pinte'),
  ('evergem', 'fr', 'Everghem'),
  ('gavere', 'fr', 'Gavre'),
  ('sint-martens-latem', 'fr', 'Laethem-Saint-Martin'),
  ('nazareth-de-pinte', 'fr', 'Nazareth-La Pinte'),
  ('oudenaarde', 'fr', 'Audenarde'),
  ('ronse', 'fr', 'Renaix'),
  ('maarkedal', 'fr', 'Markedal'),
  ('zwalm', 'fr', 'Zwalin'),
  ('sint-gillis-waas', 'fr', 'Saint-Gilles-Waes'),
  ('temse', 'fr', 'Tamise'),
  ('ath', 'nl', 'Aat'),
  ('bel-il', 'nl', 'Belle'),
  ('ellezelles', 'nl', 'Elzele'),
  ('flobecq', 'nl', 'Vloesberg'),
  ('enghien', 'nl', 'Edingen'),
  ('silly', 'nl', 'Opzullik'),
  ('lessines', 'nl', 'Lessen'),
  ('fontaine-leveque', 'pl', 'Fontaine-l’Évêque'),
  ('jurbise', 'nl', 'Jurbeke'),
  ('braine-le-comte', 'nl', '''s-Gravenbrakel'),
  ('soignies', 'nl', 'Zinnik'),
  ('comines-warneton', 'nl', 'Komen-Waasten'),
  ('huy', 'nl', 'Hoei'),
  ('bassenge', 'nl', 'Bitsingen'),
  ('comblain-au-pont', 'pl', 'Comblain-au-Point'),
  ('vise', 'nl', 'Wezet'),
  ('amel', 'fr', 'Amblève'),
  ('bullingen', 'fr', 'Bullange'),
  ('butgenbach', 'fr', 'Butgenbach'),
  ('kelmis', 'fr', 'La Calamine'),
  ('limbourg', 'nl', 'Limburg'),
  ('sankt-vith', 'pl', 'St. Vith'),
  ('sankt-vith', 'fr', 'Saint-Vith'),
  ('waimes', 'nl', 'Weismes'),
  ('hannut', 'nl', 'Hannuit'),
  ('lincent', 'nl', 'Lijsem'),
  ('oreye', 'nl', 'Oerle'),
  ('waremme', 'nl', 'Borgworm'),
  ('beringen', 'fr', 'Béringue'),
  ('herk-de-stad', 'fr', 'Herck-la-Ville'),
  ('leopoldsburg', 'fr', 'Bourg-Léopold'),
  ('bree', 'fr', 'Brée'),
  ('maaseik', 'fr', 'Maseyk'),
  ('dilsen-stokkem', 'fr', 'Dilsen-Stockem'),
  ('borgloon', 'fr', 'Looz'),
  ('voeren', 'fr', 'Fourons'),
  ('tongeren-borgloon', 'fr', 'Tongres-Looz'),
  ('gembloux', 'nl', 'Gembloers')
) as v(slug, locale, name)
join public.locations l on l.slug = v.slug
on conflict (location_id, locale) do nothing;
-- END GENERATED location_names

-- Nazwa do wyświetlenia: wartość rozpoznana jako miejscowość → jej nazwa w języku widoku, gdy
-- ta nazwa wskazuje TĘ SAMĄ miejscowość (jest też wartością filtra); inaczej wartość bez zmian.
create or replace function public.location_display_name(p_value text, p_locale text)
returns text language sql stable parallel safe security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select n.name
       from public.location_names n
      where n.location_id = public.resolve_location_id(p_value)
        and n.locale = p_locale
        and public.resolve_location_id(n.name) = n.location_id),
    p_value);
$$;
revoke all on function public.location_display_name(text, text) from public;
grant execute on function public.location_display_name(text, text) to anon, authenticated, service_role;

-- --- 4. Backfill: oferty bez miejscowości zapisane z dopiskiem ----------------------------------
-- Bez podbicia updated_at (token CAS edycji opublikowanej oferty, #325) i bez ścisłej wersji.
alter table public.jobs disable trigger trg_set_updated_at;
alter table public.jobs disable trigger trg_strict_job_version;
update public.jobs
   set location_id = public.resolve_location_id(city)
 where location_id is null
   and public.resolve_location_id(city) is not null;
alter table public.jobs enable trigger trg_set_updated_at;
alter table public.jobs enable trigger trg_strict_job_version;
