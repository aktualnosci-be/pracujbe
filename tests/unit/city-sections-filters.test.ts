// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #1076 (SRCH-01, migracja 0183 — numer tymczasowy): filtr po gminie obejmuje jej części
 * (dzielnice, `locations.parent_location_id`), a facet „miasto” grupuje część pod gminą.
 * Zachowanie na żywej bazie dowodzi `rls.sql` sekcja SRCH1076; ten test pilnuje kształtu
 * NAJNOWSZYCH definicji w migracjach (kontrole ujemne: funkcje z 0153/0167).
 */

const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations');

function bodiesOf(name: string): { file: string; body: string }[] {
  const header = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'gi');
  const out: { file: string; body: string }[] = [];
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8');
    for (const match of sql.matchAll(header)) {
      const open = sql.indexOf('$$', match.index ?? 0);
      const close = sql.indexOf('$$', open + 2);
      out.push({ file, body: sql.slice(open + 2, close) });
    }
  }
  return out;
}

const latest = (name: string) => {
  const all = bodiesOf(name);
  if (!all.length) throw new Error(`brak definicji ${name}`);
  return all[all.length - 1]!;
};
const strip = (sql: string) =>
  sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');

describe('części gmin w filtrach miasta (#1076)', () => {
  it('location_filter_ids dokłada aktywne części wskazanych miejscowości', () => {
    const fn = latest('location_filter_ids');
    const body = strip(fn.body);
    expect(fn.file).not.toBe('0153_job_location_canonical.sql');
    expect(body).toContain('s.parent_location_id = m.location_id');
    expect(body).toContain('s.is_active');
    // Kontrola ujemna: definicja z 0153 nie zna części gmin.
    const old = strip(bodiesOf('location_filter_ids')[0]!.body);
    expect(old).not.toContain('parent_location_id');
  });

  it('search_city_candidates rozwija wpis o części gminy przez location_filter_ids', () => {
    const body = strip(latest('search_city_candidates').body);
    expect(body).toContain('public.location_filter_ids(array[left(p_city, 200)])');
    expect(body).not.toContain('resolve_location_id(p_city)');
    const old = strip(bodiesOf('search_city_candidates').find((b) => b.file.startsWith('0153'))!.body);
    expect(old).toContain('resolve_location_id(p_city)');
  });

  it('facet „miasto” grupuje część pod gminą nadrzędną (nazwa kanoniczna)', () => {
    const fn = latest('get_public_job_filter_facets');
    const body = strip(fn.body);
    expect(body).toContain('left join public.locations pl on pl.id=l.parent_location_id and pl.is_active');
    // 0960 (#1215): nazwa jako podzapytanie po kluczu głównym (gmina nadrzędna, potem część,
    // potem tekst oferty) — ta sama kolejność co dawne `coalesce(pl.name, l.name, j.city)`.
    expect(body).toContain('select coalesce(pl.name, l.name) from public.locations l');
    expect(body).toContain('where l.id=j.location_id and l.is_active ), j.city) city_label');
    // Kontrola ujemna: facety z 0167 dzieliły miasto na części.
    const old = strip(bodiesOf('get_public_job_filter_facets').find((b) => b.file.startsWith('0167'))!.body);
    expect(old).not.toContain('parent_location_id');
  });

  it('lista, licznik i alerty nadal filtrują przez location_filter_ids (jedno źródło)', () => {
    for (const name of ['get_public_jobs', 'get_public_jobs_count', 'saved_search_jobs_after']) {
      const body = strip(latest(name).body);
      expect(body, name).toContain('j.location_id in (select unnest(public.location_filter_ids(p_locations)))');
    }
  });
});
