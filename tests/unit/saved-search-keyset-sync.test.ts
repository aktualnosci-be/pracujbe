// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #100 (0211) — alerty zapisanych wyszukiwań stronicują nowe oferty kursorem
 * (published_at, id) w `saved_search_jobs_after`, a nie offsetem `get_public_jobs`
 * (clamp 10 000). Filtry muszą być IDENTYCZNE z listą ofert: blok FROM … WHERE jest kopią
 * z najnowszej definicji `get_public_jobs`. Ten test pilnuje kopii — zmiana filtrów listy
 * bez tej funkcji (albo odwrotnie) = czerwony.
 */

const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations');

function latestFunctionBody(name: string): { file: string; body: string } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let found: { file: string; body: string } | null = null;
  const header = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'gi');
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8');
    for (const match of sql.matchAll(header)) {
      const start = match.index ?? 0;
      const open = sql.indexOf('$$', start);
      const close = sql.indexOf('$$', open + 2);
      if (open < 0 || close < 0) throw new Error(`${file}: brak ciała $$ dla ${name}`);
      found = { file, body: sql.slice(open + 2, close) };
    }
  }
  if (!found) throw new Error(`Nie znaleziono definicji public.${name}`);
  return found;
}

/** Bez komentarzy SQL i z jednolitymi białymi znakami. */
function normalize(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Blok filtrów listy: od `from public.jobs j` do `order by`. */
function publicListFilters(body: string): string {
  const start = body.search(/\bfrom public\.jobs j\b/);
  const end = body.search(/\border by\s*\(case when p_sort/);
  if (start < 0 || end < 0) throw new Error('get_public_jobs: nie znaleziono bloku filtrów');
  return normalize(body.slice(start, end));
}

/** Blok filtrów kopii: między znacznikami BEGIN/END w saved_search_jobs_after. */
function keysetFilters(body: string): string {
  const begin = body.indexOf('-- BEGIN get_public_jobs filters');
  const end = body.indexOf('-- END get_public_jobs filters');
  if (begin < 0 || end < 0) throw new Error('saved_search_jobs_after: brak znaczników BEGIN/END');
  return normalize(body.slice(body.indexOf('\n', begin), end));
}

describe('saved_search_jobs_after = filtry get_public_jobs (#100, 0211)', () => {
  const list = latestFunctionBody('get_public_jobs');
  const keyset = latestFunctionBody('saved_search_jobs_after');

  it('blok FROM … WHERE jest kopią 1:1 najnowszej definicji get_public_jobs', () => {
    expect(keysetFilters(keyset.body)).toBe(publicListFilters(list.body));
  });

  it('kursor (published_at, id) w porządku „najnowsze”, bez offsetu', () => {
    const body = normalize(keyset.body);
    expect(body).toContain('(j.published_at, j.id) < (p_after_published_at, p_after_id)');
    expect(body).toContain('order by j.published_at desc, j.id desc');
    expect(body).not.toMatch(/\boffset\b/);
  });

  it('saved_search_matching_jobs idzie kursorem, nie offsetem get_public_jobs', () => {
    const body = normalize(latestFunctionBody('saved_search_matching_jobs').body);
    expect(body).toContain('saved_search_keyset_page');
    expect(body).not.toContain('saved_search_job_page(');
    expect(body).not.toContain('10000');
  });

  it('kontrola ujemna: filtr dodany tylko do listy ofert wykrywa rozjazd', () => {
    const drifted = list.body.replace(
      "where j.status = 'active'",
      "where j.status = 'active' and j.is_demo = false",
    );
    expect(drifted).not.toBe(list.body);
    expect(keysetFilters(keyset.body)).not.toBe(publicListFilters(drifted));
  });
});
