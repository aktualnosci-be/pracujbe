#!/usr/bin/env node
// Generator migracji słownika `locations` (#194): kanoniczna lista miast z kodu
// (src/lib/matching/belgian-cities.ts — współrzędne i aliasy mają pierwszeństwo)
// + gminy Belgii z migawki Wikidata (data/locations/be-municipalities.wikidata.json, CC0 1.0).
// Bez sieci i bez geokodowania: ten sam wejściowy plik = ten sam SQL (test porównuje go
// z migracją w repozytorium). Uruchomienie: node scripts/locations/build-migration.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { cityKey } from './city-key.mjs';

export const MIGRATION_FILE = 'supabase/migrations/0112_locations_be_municipalities.sql';
const SNAPSHOT_FILE = 'data/locations/be-municipalities.wikidata.json';
const CURATED_FILE = 'src/lib/matching/belgian-cities.ts';
/** Slugi z 0010 — ich nazw, współrzędnych i kolejności migracja nie zmienia. */
export const SEEDED_0010 = ['brussels', 'antwerp', 'ghent', 'leuven', 'mechelen', 'hasselt', 'liege', 'charleroi', 'bruges', 'kortrijk'];
const ALIAS_MAX = 120;
const OTHER_SORT_ORDER = 1000;

/** Region i prowincja z kodu NIS (pierwsze cyfry = prowincja; 21 = Region Stołeczny). */
export function regionFromRefnis(refnis) {
  const p2 = refnis.slice(0, 2);
  if (p2 === '21') return ['Brussels-Capital', 'Brussels-Capital'];
  if (p2 === '23' || p2 === '24') return ['Flanders', 'Flemish Brabant'];
  if (p2 === '25') return ['Wallonia', 'Walloon Brabant'];
  const byDigit = {
    1: ['Flanders', 'Antwerp'], 3: ['Flanders', 'West Flanders'], 4: ['Flanders', 'East Flanders'],
    5: ['Wallonia', 'Hainaut'], 6: ['Wallonia', 'Liège'], 7: ['Flanders', 'Limburg'],
    8: ['Wallonia', 'Luxembourg'], 9: ['Wallonia', 'Namur'],
  };
  const hit = byDigit[refnis[0]];
  if (!hit) throw new Error(`Nieznany prefiks NIS: ${refnis}`);
  return hit;
}

/** Kanoniczne miasta z kodu TS — prosty parser literałów (format pilnuje test porównujący SQL). */
export function parseCuratedCities(source) {
  const cities = [];
  const re = /\{\s*slug:\s*'([^']+)',\s*lat:\s*([\d.]+),\s*lng:\s*([\d.]+),\s*aliases:\s*\[([^\]]*)\]\s*\}/g;
  for (const m of source.matchAll(re)) {
    const aliases = [...m[4].matchAll(/'([^']+)'/g)].map((a) => a[1]);
    cities.push({ slug: m[1], lat: Number(m[2]), lng: Number(m[3]), aliases });
  }
  return cities;
}

/** Etykieta Wikidata → nazwa miejscowości (bez dopisków „(Belgia)”, „Gemeente …”). */
export function cleanLabel(label) {
  return label
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/^(gemeente|commune de|municipality of)\s+/i, '')
    .trim();
}

export function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function labelsOf(item) {
  const out = [];
  for (const locale of ['en', 'nl', 'fr', 'pl', 'mul']) {
    const label = item.labels[locale];
    if (!label) continue;
    for (const part of label.split(' / ')) {
      const clean = cleanLabel(part);
      if (clean) out.push(clean);
    }
  }
  return out;
}

function primaryName(item, region) {
  const pick = (locale) => item.labels[locale] && cleanLabel(item.labels[locale].split(' / ')[0]);
  return pick('en') || (region === 'Wallonia' ? pick('fr') : pick('nl')) || pick('nl') || pick('fr')
    || pick('mul') || pick('pl');
}

/**
 * Łączy listę kanoniczną z migawką. Zwraca wiersze `locations` i aliasy z kluczem `cityKey`.
 * Konflikt aliasu między miejscowościami: wygrywa własna nazwa miejscowości, potem lista
 * kanoniczna, gmina obecna, zniesiona; równorzędny konflikt = alias niejednoznaczny, pomijany.
 */
export function buildLocations({ curated, snapshot }) {
  const items = snapshot.items.map((item) => ({ ...item, names: labelsOf(item) }));
  const keysOf = (names) => new Set(names.map(cityKey));
  const used = new Set();
  const rows = [];

  curated.forEach((city, index) => {
    const wanted = keysOf([city.slug, ...city.aliases]);
    const candidates = items.filter((item) => !used.has(item.qid) && [...keysOf(item.names)].some((k) => wanted.has(k)));
    const match = candidates.find((item) => !item.formerUntil) ?? candidates[0];
    if (match) used.add(match.qid);
    const [region, province] = match ? regionFromRefnis(match.refnis) : regionFromCurated(city.slug);
    rows.push({
      slug: city.slug,
      name: city.aliases[0],
      region,
      province,
      lat: city.lat,
      lng: city.lng,
      sortOrder: (index + 1) * 10,
      kind: match ? (match.formerUntil ? 'former_municipality' : 'municipality') : 'locality',
      refnis: match?.refnis ?? null,
      tier: 0,
      names: [city.slug, ...city.aliases, ...(match?.names ?? [])],
    });
  });

  const slugs = new Set(rows.map((r) => r.slug));
  const currentKeys = new Set(items.filter((i) => !i.formerUntil).flatMap((i) => [...keysOf(i.names)]));
  for (const item of items) {
    if (used.has(item.qid)) continue;
    const [region, province] = regionFromRefnis(item.refnis);
    const name = primaryName(item, region);
    if (!name) throw new Error(`Brak nazwy: ${item.qid}`);
    // Gmina zniesiona o tej samej nazwie co obecna (np. Lokeren po fuzji) — zostaje obecna.
    if (item.formerUntil && currentKeys.has(cityKey(name))) continue;
    let slug = slugify(name);
    if (slugs.has(slug)) slug = `${slug}-${item.refnis.toLowerCase()}`;
    slugs.add(slug);
    rows.push({
      slug, name, region, province, lat: item.lat, lng: item.lng, sortOrder: OTHER_SORT_ORDER,
      kind: item.formerUntil ? 'former_municipality' : 'municipality',
      refnis: item.refnis,
      tier: item.formerUntil ? 2 : 1,
      names: [slug, name, ...item.names],
    });
  }

  // Kod NIS jednoznaczny: przy duplikacie w migawce (np. nowy kod gminy po fuzji zapisany też
  // przy gminie zniesionej) kod zostaje przy miejscowości o wyższym priorytecie.
  const byRefnis = new Map();
  for (const row of [...rows].sort((a, b) => a.tier - b.tier)) {
    if (!row.refnis) continue;
    if (byRefnis.has(row.refnis)) row.refnis = null;
    else byRefnis.set(row.refnis, row);
  }

  // Aliasy: jeden klucz = jedna miejscowość.
  const owners = new Map();
  for (const row of rows) {
    for (const alias of row.names) {
      const key = cityKey(alias);
      if (!key || alias.length > ALIAS_MAX) continue;
      const list = owners.get(key) ?? [];
      if (!list.some((o) => o.row === row)) list.push({ row, alias });
      owners.set(key, list);
    }
  }
  const aliases = [];
  const ambiguous = [];
  for (const [key, list] of owners) {
    // Własna nazwa miejscowości wygrywa z egzonimem innej (Saint-Nicolas = gmina w prowincji
    // Liège, nie francuska nazwa Sint-Niklaas); dalej priorytet listy kanonicznej.
    const own = list.filter((o) => cityKey(o.row.name) === key || cityKey(o.row.slug) === key);
    const pool = own.length > 0 ? own : list;
    const best = Math.min(...pool.map((o) => o.row.tier));
    const top = pool.filter((o) => o.row.tier === best);
    if (top.length > 1) { ambiguous.push(`${key}: ${top.map((o) => o.row.slug).join(', ')}`); continue; }
    aliases.push({ slug: top[0].row.slug, alias: top[0].alias, key });
  }
  const withAlias = new Set(aliases.map((a) => a.slug));
  const orphans = rows.filter((r) => !withAlias.has(r.slug)).map((r) => r.slug);
  if (orphans.length) throw new Error(`Miejscowości bez aliasu: ${orphans.join(', ')}`);
  const order = new Map(rows.map((r, i) => [r.slug, i]));
  aliases.sort((a, b) => order.get(a.slug) - order.get(b.slug) || a.key.localeCompare(b.key));
  return { rows, aliases, ambiguous };
}

/** Miejscowości kanoniczne, które nie są gminą (np. Zeebrugge — część Brugii). */
function regionFromCurated(slug) {
  const known = { zeebrugge: ['Flanders', 'West Flanders'] };
  if (!known[slug]) throw new Error(`Miasto kanoniczne bez gminy w migawce: ${slug}`);
  return known[slug];
}

const q = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const coord = (n) => n.toFixed(6);

export function renderMigrationSql({ rows, aliases }, snapshot) {
  const rowsSql = rows.map((r) =>
    `  (${q(r.slug)}, ${q(r.name)}, ${q(r.region)}, ${q(r.province)}, ${coord(r.lat)}, ${coord(r.lng)}, ${r.sortOrder}, ${q(r.kind)}, ${q(r.refnis)})`,
  ).join(',\n');
  const aliasSql = aliases.map((a) => `  (${q(a.slug)}, ${q(a.alias)}, ${q(a.key)})`).join(',\n');
  const counts = {
    all: rows.length,
    curated: rows.filter((r) => r.tier === 0).length,
    former: rows.filter((r) => r.kind === 'former_municipality').length,
  };
  return `-- =============================================================================
-- 0112_locations_be_municipalities.sql — #194: współrzędne miejscowości w bazie.
-- PLIK GENEROWANY: node scripts/locations/build-migration.mjs (nie edytuj ręcznie).
--
-- 1. locations: kolumny \`kind\` (municipality / former_municipality / locality) i \`refnis\`
--    (kod NIS gminy, Statbel). Wiersze z 0010 zachowują nazwę, współrzędne i kolejność.
-- 2. location_aliases: nazwy PL/NL/FR/EN i warianty; \`alias_key\` = cityKey()
--    z src/lib/matching/belgian-cities.ts (bez diakrytyków, małe litery, myślnik = spacja),
--    unikalny — jeden klucz wskazuje jedną miejscowość. Matching szuka po kluczu.
-- 3. Dane: ${counts.curated} miast z listy kanonicznej w kodzie (ich współrzędne i aliasy mają
--    pierwszeństwo) + gminy Belgii z Wikidata — razem ${counts.all} miejscowości, w tym
--    ${counts.former} gmin zniesionych przy fuzjach 2019/2025 (nazwy nadal w ogłoszeniach).
--    Źródło: ${snapshot.source}; licencja ${snapshot.license};
--    migawka ${snapshot.retrieved} (data/locations/be-municipalities.wikidata.json).
--    Dane rzeczywiste (is_demo = false). Bez geokodowania przez API zewnętrzne.
-- 4. RLS: słownik czytelny publicznie, zapis tylko service_role (jak locations).
--
-- Rollback: supabase/rollback/0112_locations_be_municipalities.down.sql
-- =============================================================================

alter table public.locations
  add column if not exists kind text not null default 'municipality'
    constraint locations_kind_check check (kind in ('municipality', 'former_municipality', 'locality')),
  add column if not exists refnis text
    constraint locations_refnis_check check (refnis ~ '^[0-9]{5}[A-Z]?$');
create unique index if not exists locations_refnis_key on public.locations (refnis) where refnis is not null;

create table if not exists public.location_aliases (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade on update cascade,
  alias       text not null constraint location_aliases_alias_len check (char_length(alias) between 1 and ${ALIAS_MAX}),
  alias_key   text not null unique
    constraint location_aliases_key_format check (alias_key = lower(alias_key) and alias_key = btrim(alias_key)
      and alias_key <> '' and alias_key !~ '[-[:space:]]{2}' and alias_key !~ '-'),
  created_at  timestamptz not null default now()
);
create index if not exists location_aliases_location_idx on public.location_aliases (location_id);

alter table public.location_aliases enable row level security;
drop policy if exists location_aliases_public_read on public.location_aliases;
create policy location_aliases_public_read on public.location_aliases
  for select to anon, authenticated using (true);
revoke all on public.location_aliases from anon, authenticated;
grant select on public.location_aliases to anon, authenticated;
grant select, insert, update, delete on public.location_aliases to service_role;

-- Miejscowości. Istniejący slug: uzupełniamy tylko kind/refnis (nazwa, współrzędne i kolejność
-- z 0010 albo ustawione ręcznie zostają).
insert into public.locations (slug, name, region, province, country, latitude, longitude, sort_order, is_active, is_demo, kind, refnis)
select v.slug, v.name, v.region, v.province, 'BE', v.latitude, v.longitude, v.sort_order, true, false, v.kind, v.refnis
from (values
${rowsSql}
) as v(slug, name, region, province, latitude, longitude, sort_order, kind, refnis)
on conflict (slug) do update
  set kind       = excluded.kind,
      refnis     = coalesce(public.locations.refnis, excluded.refnis),
      updated_at = now();

insert into public.location_aliases (location_id, alias, alias_key)
select l.id, v.alias, v.alias_key
from (values
${aliasSql}
) as v(slug, alias, alias_key)
join public.locations l on l.slug = v.slug
on conflict (alias_key) do nothing;

-- Kontrola: każda miejscowość z koordynatami ma alias; wiersze 0010 bez zmian.
do $$
begin
  if exists (select 1 from public.locations l
             where l.country = 'BE' and l.latitude is not null
               and not exists (select 1 from public.location_aliases a where a.location_id = l.id)) then
    raise exception 'location_aliases: miejscowość bez aliasu.';
  end if;
  if (select count(*) from public.locations where country = 'BE' and latitude is not null) < ${counts.all} then
    raise exception 'locations: za mało miejscowości po imporcie.';
  end if;
end $$;
`;
}

export function generate(cwd = process.cwd()) {
  const snapshot = JSON.parse(readFileSync(join(cwd, SNAPSHOT_FILE), 'utf8'));
  const curated = parseCuratedCities(readFileSync(join(cwd, CURATED_FILE), 'utf8'));
  const built = buildLocations({ curated, snapshot });
  return { ...built, curated, snapshot, sql: renderMigrationSql(built, snapshot) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { sql, rows, aliases, ambiguous, curated } = generate();
  writeFileSync(join(process.cwd(), MIGRATION_FILE), sql);
  console.log(`${MIGRATION_FILE}: ${rows.length} miejscowości (${curated.length} kanonicznych), ${aliases.length} aliasów.`);
  if (ambiguous.length) console.log(`Aliasy niejednoznaczne (pominięte):\n  ${ambiguous.join('\n  ')}`);
}
