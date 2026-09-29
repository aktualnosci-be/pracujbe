import { isDatabaseConfigured, isProductionMode } from '@/lib/env';
import { isBuildPhase } from '@/lib/static-rendering';
import { AppError } from '@/lib/errors';
import { captureError } from '@/lib/error-report';
import type { TransactionPool } from '@/lib/db/transaction';
import type {
  SitemapJobCursor,
  SitemapJobRow,
  SitemapShardStart,
} from '@/lib/db/sitemap-jobs';

/**
 * Katalog ofert dla sitemapy (#1042, migracja 0965). Zamiast `getJobs` (licznik +
 * stronicowanie OFFSET po 100 ofert, sufit 10 000) czyta dwa lekkie RPC kursorowe
 * (`src/lib/db/sitemap-jobs.ts`): granice partii (jedno zapytanie, 1 wiersz na partię) i strony
 * po 1000 ofert kursorem (`published_at desc`, `id desc`) razem z językami tłumaczeń.
 *
 * Partia = zakres kluczy kursora, nie zakres pozycji: partia k obejmuje oferty PO kursorze
 * poprzedniej i aż do kursora następnej (włącznie), więc partie są rozłączne i bez dziur także
 * wtedy, gdy między żądaniami oferta wygasa albo pojawia się nowa (nowe trafiają do partii 1).
 *
 * Błędy: skonfigurowana baza nie degraduje do pustej listy (indeksowanie pustej sitemapy) —
 * błąd jest logowany i propagowany, tak jak w `getJobs`. Faza `next build` nie czyta bazy
 * (#534) i zwraca pustą listę.
 */

/** Rozmiar strony kursora (zgodny z klampem RPC). */
export const SITEMAP_JOBS_PAGE = 1000;
/**
 * Bezpiecznik pętli jednej partii: nominalnie `shardSize / SITEMAP_JOBS_PAGE` stron. Partia 1
 * może urosnąć o oferty opublikowane po wyliczeniu granic, ale nie w nieskończoność.
 */
function maxPagesPerShard(shardSize: number): number {
  return Math.ceil(shardSize / SITEMAP_JOBS_PAGE) * 3;
}

async function withPool<T>(
  area: string,
  run: (pool: TransactionPool) => Promise<T>,
  empty: T,
): Promise<T> {
  if (!isDatabaseConfigured()) {
    // Produkcja bez bazy nie ma prawa serwować sitemapy z danych demonstracyjnych.
    if (isProductionMode()) throw new AppError('INTERNAL');
    return empty;
  }
  if (isBuildPhase()) return empty;
  try {
    const { getDomainPool } = await import('@/lib/db/runtime');
    return await run(await getDomainPool());
  } catch (error) {
    captureError(error, { area });
    throw new AppError('INTERNAL');
  }
}

/** Granice wszystkich partii (numer od 1). Liczba partii = długość listy; pusta = brak ofert. */
export async function getSitemapJobShardStarts(shardSize: number): Promise<SitemapShardStart[]> {
  return withPool(
    'sitemap.jobShardStarts',
    async (pool) => {
      const { getSitemapShardStarts } = await import('@/lib/db/sitemap-jobs');
      return getSitemapShardStarts(pool, shardSize);
    },
    [],
  );
}

/**
 * Oferty partii `shardIndex` (numer od 1). Numer spoza istniejących partii = pusta lista.
 * Jedno zapytanie o granice + kolejne strony kursorem aż do granicy następnej partii.
 */
export async function getSitemapJobsShard(
  shardIndex: number,
  shardSize: number,
): Promise<SitemapJobRow[]> {
  return withPool(
    'sitemap.jobShard',
    async (pool) => {
      const { getSitemapShardStarts, getSitemapJobsPage } = await import('@/lib/db/sitemap-jobs');
      const starts = await getSitemapShardStarts(pool, shardSize);
      const start = starts.find((item) => item.shardIndex === shardIndex);
      if (!start) return [];
      const until = starts.find((item) => item.shardIndex === shardIndex + 1)?.after ?? null;

      const rows: SitemapJobRow[] = [];
      let cursor: SitemapJobCursor | null = start.after;
      for (let page = 0; page < maxPagesPerShard(shardSize); page += 1) {
        const batch = await getSitemapJobsPage(pool, cursor, until, SITEMAP_JOBS_PAGE);
        rows.push(...batch);
        const last = batch[batch.length - 1];
        if (!last || batch.length < SITEMAP_JOBS_PAGE) return rows;
        cursor = { publishedAt: last.publishedAt, id: last.id };
      }
      // Bezpiecznik: ponad limit stron partia jest niepełna (bez duplikatów — następna partia
      // zaczyna od własnej granicy); pominięte oferty wrócą przy kolejnym wyliczeniu granic,
      // które od nowa dzieli katalog na partie po `shardSize`.
      captureError(new Error('sitemap: partia ofert ponad limit stron'), { area: 'sitemap.jobShardLimit' });
      return rows;
    },
    [],
  );
}

/**
 * Bezpiecznik pętli profili firm: tyle stron kursora mieści się w `MAX_JOB_SITEMAP_SHARDS`
 * partiach po 5000 ofert (500 000 ofert = 500 stron po 1000).
 */
const MAX_COMPANY_SLUG_PAGES = 500;

/**
 * PERF-05 (#1231): slugi zweryfikowanych firm z publicznymi ofertami — jedna iteracja kursorem
 * po całym katalogu (to samo RPC co partie, bez licznika i OFFSET), w kolejności pierwszego
 * wystąpienia. Profile trafiają tylko do partii `0`, więc firma nie powtarza się między plikami.
 */
export async function getSitemapCompanySlugs(): Promise<string[]> {
  return withPool(
    'sitemap.companySlugs',
    async (pool) => {
      const { getSitemapJobsPage } = await import('@/lib/db/sitemap-jobs');
      const slugs = new Set<string>();
      let cursor: SitemapJobCursor | null = null;
      for (let page = 0; page < MAX_COMPANY_SLUG_PAGES; page += 1) {
        const batch = await getSitemapJobsPage(pool, cursor, null, SITEMAP_JOBS_PAGE);
        for (const job of batch) {
          if (job.companySlug) slugs.add(job.companySlug);
        }
        const last = batch[batch.length - 1];
        if (!last || batch.length < SITEMAP_JOBS_PAGE) return [...slugs];
        cursor = { publishedAt: last.publishedAt, id: last.id };
      }
      captureError(new Error('sitemap: profile firm ponad limit stron'), { area: 'sitemap.companySlugsLimit' });
      return [...slugs];
    },
    [],
  );
}
