#!/usr/bin/env node
// Pobiera migawkę gmin Belgii z Wikidata (CC0 1.0) do data/locations/ (#194).
// Uruchamiane ręcznie przy odświeżaniu danych (poza CI):
//   node scripts/locations/fetch-wikidata.mjs                 — gminy i części gmin
//   node scripts/locations/fetch-wikidata.mjs municipalities  — tylko gminy (migracja 0112)
//   node scripts/locations/fetch-wikidata.mjs sections        — tylko części gmin (migracja 0191)
// Odświeżenie migawki gmin zmienia wynik generatora 0112 — po wdrożeniu 0112 zmiany idą nową migracją.
// Zapisuje wyłącznie to, czego potrzebuje generator migracji: QID, kod NIS (REFNIS),
// współrzędne i etykiety PL/NL/FR/EN. Gminy zniesione przy fuzjach od 2019 r. zostają
// jako `formerUntil` (nazwy nadal w ogłoszeniach); starsze fuzje pomijamy.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const LOCALES = ['pl', 'nl', 'fr', 'en'];
/** `mul` = etykieta wspólna dla wielu języków (Wikidata od 2024 r.) — zapas, gdy brak PL/NL/FR/EN. */
const LABELS = [...LOCALES, 'mul'];
/** Fuzje z 1 stycznia 2019 i 2025 r.: koniec członkostwa 2018-12-31 / 2024-12-31. */
const FORMER_SINCE = '2018-12-31';
export const SNAPSHOT_PATH = join(process.cwd(), 'data/locations/be-municipalities.wikidata.json');

export const QUERY = `SELECT ?m ?nis ?coord ?end ?dissolved ${LABELS.map((l) => `?${l}`).join(' ')} WHERE {
  {
    ?m p:P31 ?st . ?st ps:P31 wd:Q493522 .
    OPTIONAL { ?st pq:P582 ?end }
  } UNION {
    # Gminy zniesione przy fuzjach: część ma inną klasę („gmina dawna”), ale zachowuje kod NIS.
    ?m wdt:P1567 ?anyNis ; wdt:P576 ?dissolvedAt ; wdt:P17 wd:Q31 .
    FILTER(?dissolvedAt >= "${FORMER_SINCE}T00:00:00Z"^^xsd:dateTime)
  }
  OPTIONAL { ?m wdt:P576 ?dissolved }
  OPTIONAL { ?m wdt:P1567 ?nis }
  OPTIONAL { ?m wdt:P625 ?coord }
${LABELS.map((l) => `  OPTIONAL { ?m rdfs:label ?${l} FILTER(LANG(?${l})="${l}") }`).join('\n')}
}`;

export const SECTIONS_SNAPSHOT_PATH = join(process.cwd(), 'data/locations/be-sections.wikidata.json');

/**
 * Części gmin (deelgemeenten / sections de commune, klasa Q2785216) i miejscowości z kodem NIS
 * części gminy (5 cyfr + litera, np. 44011J), z gminą nadrzędną (P131). Po fuzjach gminą
 * nadrzędną bywa gmina zniesiona — generator wybiera gminę obecną, gdy jest wśród P131,
 * a potem następcę gminy zniesionej (P1366, pole `successors`).
 */
export const SECTIONS_QUERY = `SELECT ?m ?nis ?coord ?parent ?successor ?dissolved ${LABELS.map((l) => `?${l}`).join(' ')} WHERE {
  { ?m wdt:P31 wd:Q2785216 . }
  UNION
  { ?m wdt:P1567 ?sectionNis ; wdt:P17 wd:Q31 . FILTER(REGEX(?sectionNis, "^[0-9]{5}[A-Z]$")) }
  OPTIONAL { ?m wdt:P1567 ?nis }
  OPTIONAL { ?m wdt:P625 ?coord }
  OPTIONAL { ?m wdt:P131 ?parent . OPTIONAL { ?parent wdt:P1366 ?successor } }
  OPTIONAL { ?m wdt:P576 ?dissolved }
${LABELS.map((l) => `  OPTIONAL { ?m rdfs:label ?${l} FILTER(LANG(?${l})="${l}") }`).join('\n')}
}`;

const value = (binding, key) => binding[key]?.value;
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const entityId = (uri) => uri.replace('http://www.wikidata.org/entity/', '');

async function sparql(query) {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/sparql-results+json',
      'User-Agent': 'pracujbe-locations/1.0 (https://github.com/aktualnosci-be/pracujbe)',
    },
  });
  if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
  return (await response.json()).results.bindings;
}

function groupByItem(bindings) {
  const byItem = new Map();
  for (const b of bindings) {
    const qid = entityId(value(b, 'm'));
    const list = byItem.get(qid) ?? [];
    list.push(b);
    byItem.set(qid, list);
  }
  return byItem;
}

function labelsOf(list) {
  const labels = {};
  for (const locale of LABELS) {
    const label = list.map((b) => value(b, locale)).find(Boolean);
    if (label) labels[locale] = label;
  }
  return labels;
}

async function fetchSections() {
  const byItem = groupByItem(await sparql(SECTIONS_QUERY));
  const items = [];
  const skipped = [];
  for (const [qid, list] of byItem) {
    // Część gminy zniesiona albo z nieznaną datą zniesienia — nie zgadujemy.
    if (list.some((b) => value(b, 'dissolved'))) { skipped.push(`${qid}: zniesiona`); continue; }
    const nisCodes = [...new Set(list.map((b) => value(b, 'nis')).filter((c) => c && /^\d{5}[A-Z]$/.test(c)))].sort();
    const parents = [...new Set(list.map((b) => value(b, 'parent')).filter((p) => p?.startsWith('http://www.wikidata.org/entity/Q')).map(entityId))].sort();
    const successors = [...new Set(list.map((b) => value(b, 'successor')).filter((p) => p?.startsWith('http://www.wikidata.org/entity/Q')).map(entityId))].sort();
    const point = list.map((b) => value(b, 'coord')).find(Boolean);
    const match = point?.match(/^Point\(([-\d.]+) ([-\d.]+)\)$/);
    const labels = labelsOf(list);
    if (Object.keys(labels).length === 0) { skipped.push(`${qid}: brak etykiety`); continue; }
    items.push({
      qid,
      nis: nisCodes[0] ?? null,
      parents,
      successors,
      // Brak współrzędnych → generator bierze współrzędne gminy nadrzędnej.
      lat: match ? round6(Number(match[2])) : null,
      lng: match ? round6(Number(match[1])) : null,
      labels,
    });
  }
  items.sort((a, b) => (a.nis ?? '~').localeCompare(b.nis ?? '~') || a.qid.localeCompare(b.qid));
  const snapshot = {
    source: 'Wikidata (https://www.wikidata.org), zapytanie SPARQL w polu `query`',
    license: 'CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)',
    retrieved: new Date().toISOString().slice(0, 10),
    query: SECTIONS_QUERY,
    skipped,
    items,
  };
  writeFileSync(SECTIONS_SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(`Zapisano ${items.length} części gmin, pominięto ${skipped.length}.`);
}

async function fetchMunicipalities() {
  const bindings = await sparql(QUERY);

  const byItem = groupByItem(bindings);

  const items = [];
  const skipped = [];
  for (const [qid, list] of byItem) {
    const ends = list.map((b) => value(b, 'end') ?? value(b, 'dissolved') ?? '');
    // Wartość „nieznana” (genid) = element niepewny → pomijamy, żeby nie zgadywać.
    if (ends.some((e) => e.startsWith('http'))) { skipped.push(`${qid}: nieznany koniec`); continue; }
    const end = ends.every(Boolean) ? ends.sort().at(-1).slice(0, 10) : null;
    if (end && end < FORMER_SINCE) continue;
    const nisCodes = [...new Set(list.map((b) => value(b, 'nis')).filter((c) => c && /^\d{5}[A-Z]?$/.test(c) && !c.endsWith('000')))].sort();
    const point = list.map((b) => value(b, 'coord')).find(Boolean);
    const match = point?.match(/^Point\(([-\d.]+) ([-\d.]+)\)$/);
    if (!match || nisCodes.length === 0) { skipped.push(`${qid}: brak współrzędnych/NIS`); continue; }
    const labels = labelsOf(list);
    items.push({
      qid,
      // Kilka kodów NIS na jednym elemencie (np. stary i nowy) → najmniejszy, deterministycznie.
      refnis: nisCodes[0],
      lat: round6(Number(match[2])),
      lng: round6(Number(match[1])),
      formerUntil: end,
      labels,
    });
  }
  items.sort((a, b) => a.refnis.localeCompare(b.refnis) || a.qid.localeCompare(b.qid));

  const snapshot = {
    source: 'Wikidata (https://www.wikidata.org), zapytanie SPARQL w polu `query`',
    license: 'CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)',
    retrieved: new Date().toISOString().slice(0, 10),
    formerSince: FORMER_SINCE,
    query: QUERY,
    skipped,
    items,
  };
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(`Zapisano ${items.length} gmin (${items.filter((i) => i.formerUntil).length} zniesionych), pominięto ${skipped.length}.`);
}

async function main() {
  const mode = process.argv[2] ?? 'all';
  if (!['all', 'municipalities', 'sections'].includes(mode)) throw new Error(`Nieznany tryb: ${mode}`);
  if (mode !== 'sections') await fetchMunicipalities();
  if (mode !== 'municipalities') await fetchSections();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
