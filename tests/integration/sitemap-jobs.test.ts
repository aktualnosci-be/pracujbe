import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPortalDb, type PortalDb } from './support/portal-db';
import { getPublicJobs } from '../../src/lib/db/public-jobs';
import {
  getSitemapJobsPage,
  getSitemapShardStarts,
  type SitemapJobCursor,
  type SitemapJobRow,
} from '../../src/lib/db/sitemap-jobs';

/**
 * #1042 (migracja 0208) na PostgreSQL 16: kursorowe RPC sitemapy ofert pod loginem `web`
 * (rola anon, jak w produkcji). 2600 ofert z JEDNYM published_at (remis przez każdą granicę
 * strony i partii) + oferty ukryte. Sitemap ma zwrócić dokładnie to samo, co publiczna lista
 * (`get_public_jobs`), w porządku (published_at, id) malejąco, bez dziur i dubli.
 */

const TOTAL = 2600;
const TIE = '2026-09-20 10:00:00.654321+00';
let pg: PortalDb;
let companyId = '';
let hidden: string[] = [];

/** Przechodzi wszystkie partie tak jak sitemap: granice, potem strony kursorem do granicy następnej. */
async function walk(shardSize: number, limit: number): Promise<{ rows: SitemapJobRow[]; shards: number[] }> {
  const starts = await getSitemapShardStarts(pg.web, shardSize);
  const rows: SitemapJobRow[] = [];
  const shards: number[] = [];
  for (const [index, start] of starts.entries()) {
    const until = starts[index + 1]?.after ?? null;
    let cursor: SitemapJobCursor | null = start.after;
    let count = 0;
    for (;;) {
      const page = await getSitemapJobsPage(pg.web, cursor, until, limit);
      rows.push(...page);
      count += page.length;
      const last = page[page.length - 1];
      if (!last || page.length < limit) break;
      cursor = { publishedAt: last.publishedAt, id: last.id };
    }
    shards.push(count);
  }
  return { rows, shards };
}

beforeAll(async () => {
  pg = await startPortalDb();
  companyId = (await pg.admin.query(
    `INSERT INTO public.companies(name, status) VALUES ('Sitemap IT', 'verified') RETURNING id`)).rows[0].id;
  const unverified = (await pg.admin.query(
    `INSERT INTO public.companies(name, status) VALUES ('Sitemap IT niezweryfikowana', 'pending') RETURNING id`)).rows[0].id;

  const client = await pg.admin.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    const insert = (company: string, prefix: string, count: number, status: string, published: string,
      expires: string | null = null, deleted = false) => client.query(
      `INSERT INTO public.jobs(company_id, slug, title, status, category, contract_type, city, region,
         published_at, expires_at, deleted_at)
       SELECT $1::uuid, $2 || g, 'Oferta ' || g, $3::job_status, 'warehouse', 'permanent', 'Gent', 'Oost-Vlaanderen',
              ${published}, $4::timestamptz, CASE WHEN $5 THEN now() END
         FROM generate_series(1, $6) g`,
      [company, prefix, status, expires, deleted, count]);
    await insert(companyId, 'tie-', TOTAL, 'active', `timestamptz '${TIE}'`);
    await insert(companyId, 'new-', 3, 'active', `timestamptz '2026-09-25 09:00:00.000001+00' + g * interval '1 microsecond'`);
    await insert(companyId, 'old-', 2, 'active', `timestamptz '2026-08-01 09:00:00+00'`);
    await insert(companyId, 'hid-draft-', 2, 'draft', 'now()');
    await insert(companyId, 'hid-exp-', 2, 'active', 'now()', new Date(Date.now() - 86_400_000).toISOString());
    await insert(companyId, 'hid-del-', 2, 'active', 'now()', null, true);
    await insert(unverified, 'hid-unv-', 2, 'active', 'now()');
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  hidden = (await pg.admin.query(`SELECT slug FROM public.jobs WHERE slug LIKE 'hid-%'`)).rows.map(
    (row: { slug: string }) => row.slug);
  // Tłumaczenia: jedna oferta pl+nl, druga tylko fr; reszta bez.
  await pg.admin.query(
    `INSERT INTO public.job_translations(job_id, locale, title)
     SELECT j.id, l, 'T ' || l FROM public.jobs j, unnest(ARRAY['pl','nl']) l WHERE j.slug = 'new-1'`);
  await pg.admin.query(
    `INSERT INTO public.job_translations(job_id, locale, title)
     SELECT j.id, 'fr', 'T fr' FROM public.jobs j WHERE j.slug = 'new-2'`);
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe('sitemap ofert — kursorowe RPC na PostgreSQL 16 (#1042)', () => {
  const EXPECTED = TOTAL + 3 + 2;

  it('granice partii: liczba = ceil(N / rozmiar), pierwsza bez kursora, bez licznika ofert', async () => {
    const starts = await getSitemapShardStarts(pg.web, 1000);
    expect(starts.map((s) => s.shardIndex)).toEqual([1, 2, 3, 4, 5, 6].slice(0, Math.ceil(EXPECTED / 1000)));
    expect(starts[0]!.after).toBeNull();
    // Kursor niesie mikrosekundy (nie milisekundy z Date).
    expect(starts[1]!.after!.publishedAt).toMatch(/\.654321\+00:00$/);
  });

  it('partie 1000 × strony 1000 pokrywają katalog bez dziur i dubli (remis przez granice)', async () => {
    const { rows, shards } = await walk(1000, 1000);
    expect(rows).toHaveLength(EXPECTED);
    expect(new Set(rows.map((r) => r.id)).size).toBe(EXPECTED);
    expect(shards.slice(0, -1).every((n) => n === 1000)).toBe(true);
    expect(shards.reduce((a, b) => a + b, 0)).toBe(EXPECTED);
  });

  it('małe strony (73) i partie (250) przecinają remis w wielu miejscach — ten sam wynik', async () => {
    const big = (await walk(1000, 1000)).rows.map((r) => r.id);
    const small = (await walk(250, 73)).rows.map((r) => r.id);
    expect(small).toEqual(big);
  });

  it('to samo co publiczna lista (get_public_jobs) w porządku (published_at, id) malejąco', async () => {
    const listed: { id: string; published_at: string }[] = [];
    for (let page = 1; listed.length < EXPECTED + 100; page += 1) {
      const result = await getPublicJobs(pg.web, { locale: 'pl', page, pageSize: 100 });
      if (result.rows.length === 0) break;
      listed.push(...(result.rows as { id: string; published_at: string }[]));
    }
    const fromList = listed
      .map((r) => r.id)
      .sort();
    const { rows } = await walk(1000, 1000);
    expect(rows.map((r) => r.id).slice().sort()).toEqual(fromList);
    // Kolejność klucza kursora: published_at malejąco, remis → id malejąco.
    for (let i = 1; i < rows.length; i += 1) {
      const a = rows[i - 1]!;
      const b = rows[i]!;
      // Ten sam format tekstu (ISO, mikrosekundy, +00:00) — porównanie leksykograficzne = chronologiczne.
      expect(
        a.publishedAt > b.publishedAt || (a.publishedAt === b.publishedAt && a.id > b.id),
        `${a.id} → ${b.id}`,
      ).toBe(true);
    }
  });

  it('oferty niepubliczne (szkic, wygasła, usunięta, firma niezweryfikowana) nie trafiają do sitemapy', async () => {
    const { rows } = await walk(5000, 1000);
    const slugs = new Set(rows.map((r) => r.slug));
    expect(hidden).toHaveLength(8);
    for (const slug of hidden) expect(slugs.has(slug), slug).toBe(false);
  });

  it('wiersz: języki tłumaczeń (posortowane), slug firmy, daty', async () => {
    const { rows } = await walk(5000, 1000);
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    expect(bySlug.get('new-1')!.locales).toEqual(['nl', 'pl']);
    expect(bySlug.get('new-2')!.locales).toEqual(['fr']);
    expect(bySlug.get('new-3')!.locales).toEqual([]);
    expect(Number.isNaN(Date.parse(bySlug.get('old-1')!.updatedAt))).toBe(false);
  });

  it('updated_at odzwierciedla edycję (lastmod)', async () => {
    // Trigger set_updated_at nadpisałby wartość — wyłączamy go tylko dla tej instrukcji testu.
    const client = await pg.admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(`UPDATE public.jobs SET updated_at = timestamptz '2026-09-28 12:00:00+00' WHERE slug = 'old-1'`);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const { rows } = await walk(5000, 1000);
    expect(new Date(rows.find((r) => r.slug === 'old-1')!.updatedAt).toISOString()).toBe('2026-09-28T12:00:00.000Z');
  });

  it('KONTROLA UJEMNA: kursor z published_at zaokrąglonym do milisekund gubi/dubluje oferty remisu', async () => {
    const starts = await getSitemapShardStarts(pg.web, 1000);
    const cursor = starts[1]!.after!;
    const truncated: SitemapJobCursor = {
      id: cursor.id,
      publishedAt: new Date(Date.parse(cursor.publishedAt)).toISOString(), // .654Z zamiast .654321
    };
    const exact = await getSitemapJobsPage(pg.web, cursor, null, 1000);
    const lossy = await getSitemapJobsPage(pg.web, truncated, null, 1000);
    // .654000 < .654321: wszystkie oferty remisu są „po” obciętym kursorze albo poza nim —
    // wynik różni się od dokładnego (dokładnie ten błąd, którego unikamy tekstowym kursorem).
    expect(lossy.map((r) => r.id)).not.toEqual(exact.map((r) => r.id));
  });

  it('anon wywołuje RPC, ale nie czyta tabel bazowych', async () => {
    // Rola anon (jak w withUserTransaction) — bez dostępu do tabeli jobs:
    const client = await pg.web.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE anon');
      await expect(client.query('SELECT count(*) FROM public.jobs')).rejects.toThrow(/permission denied/);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});
