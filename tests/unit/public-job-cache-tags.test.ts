// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// Next przy starcie serwera ustawia globalne AsyncLocalStorage; bez niego moduły
// `*-async-storage` dostają atrapę, która rzuca przy `run`. Musi być przed importem Next.
vi.hoisted(() => {
  const { AsyncLocalStorage } = process.getBuiltinModule('node:async_hooks');
  (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage;
});

import { PUBLIC_JOB_ROUTES, revalidatePublicJobPaths } from '@/lib/jobs/public-cache';
import { createIsrCacheHandler } from '@/lib/cache/isr-cache-handler.mjs';

/**
 * #1216 (PERF-02): `revalidatePublicJobPaths()` musi unieważniać PRAWDZIWE tagi wpisów ISR.
 *
 * Bez atrapy `next/cache`: prawdziwe `revalidatePath` z Next działa w prawdziwym
 * `workAsyncStorage` i zapisuje tagi w `pendingRevalidatedTags` (tak jak w Server Action);
 * tagi wpisu strony liczy prawdziwe `getImplicitTags` z Next dla ścieżki PLIKU trasy z
 * `src/app` (tak jak Next przy renderowaniu ISR). Na końcu wpis w naszym `cacheHandler`
 * (tagi w nagłówku `x-next-cache-tags`, jak zapisuje Next) po `revalidateTag` znika.
 * Kontrola ujemna: ścieżki bez grupy `(public)` (stan sprzed #1216) nie unieważniają nic.
 */

const require = createRequire(import.meta.url);
const { workAsyncStorage } = require('next/dist/server/app-render/work-async-storage.external') as {
  workAsyncStorage: { run<T>(store: Record<string, unknown>, fn: () => T): T };
};
const { getImplicitTags } = require('next/dist/server/lib/implicit-tags') as {
  getImplicitTags(page: string, url: { pathname: string }, fallback?: unknown): Promise<{ tags: string[] }>;
};

const APP_DIR = join(process.cwd(), 'src', 'app');
const PUBLIC_DIR = join(APP_DIR, '[locale]', '(public)');

/** Ścieżki plików tras (`/[locale]/(public)/…`, bez `/page`) każdej strony w `(public)`. */
function publicPageRoutes(dir = PUBLIC_DIR): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!name.startsWith('_')) out.push(...publicPageRoutes(full));
    } else if (name === 'page.tsx') {
      out.push('/' + relative(APP_DIR, dir).split(sep).join('/'));
    }
  }
  return out;
}

function pageRevalidate(route: string): number | null {
  const source = readFileSync(join(APP_DIR, ...route.slice(1).split('/'), 'page.tsx'), 'utf8');
  const match = /export const revalidate = (\d+);/.exec(source);
  return match ? Number(match[1]) : null;
}

/** Przykładowy adres URL instancji trasy (bez grup, parametry wypełnione). */
function samplePathname(route: string): string {
  return route
    .split('/')
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
    .map((segment) => (segment === '[locale]' ? 'pl' : segment.startsWith('[') ? 'przyklad-1a2b3c4d' : segment))
    .join('/');
}

function capturedTags(fn: () => void): string[] {
  const store: Record<string, unknown> = { route: '/test', incrementalCache: {} };
  workAsyncStorage.run(store, fn);
  return (store['pendingRevalidatedTags'] as string[] | undefined) ?? [];
}

async function entryTags(route: string): Promise<string[]> {
  return (await getImplicitTags(`${route}/page`, { pathname: samplePathname(route) })).tags;
}

/** Strony z ofertami wg struktury `src/app` (niezależnie od testowanej listy). */
const ISR_JOB_PAGES = publicPageRoutes().filter((route) => pageRevalidate(route) === 60).sort();

describe('revalidatePublicJobPaths — zgodność z tagami Next (#1216)', () => {
  it('każda ścieżka z listy odpowiada istniejącemu page.tsx w src/app', () => {
    for (const route of PUBLIC_JOB_ROUTES) {
      expect(existsSync(join(APP_DIR, ...route.slice(1).split('/'), 'page.tsx')), route).toBe(true);
    }
  });

  it('lista obejmuje każdą stronę (public) z revalidate = 60 (strony z ofertami)', () => {
    expect(ISR_JOB_PAGES.length).toBeGreaterThan(0);
    expect([...PUBLIC_JOB_ROUTES].sort()).toEqual(ISR_JOB_PAGES);
  });

  it('prawdziwe revalidatePath trafia w niejawny tag wpisu każdej strony', async () => {
    const tags = capturedTags(() => revalidatePublicJobPaths());
    expect(tags.length).toBe(ISR_JOB_PAGES.length);
    for (const route of ISR_JOB_PAGES) {
      const own = await entryTags(route);
      expect(tags.filter((tag) => own.includes(tag)), route).toEqual([`_N_T_${route}/page`]);
    }
  });

  it('wpis w cacheHandler znika po rewalidacji (szczegół oferty i profil firmy)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'isr-tags-'));
    try {
      let t = 1_000_000;
      const Handler = createIsrCacheHandler({ now: () => t, diskDir: join(root, 'cache') });
      const handler = new Handler({ flushToDisk: false });
      const keys: Array<[string, string]> = [
        ['/pl/oferty-pracy/przyklad-1a2b3c4d', '/[locale]/(public)/oferty-pracy/[slug]'],
        ['/pl/pracodawcy/przyklad-1a2b3c4d', '/[locale]/(public)/pracodawcy/[slug]'],
        ['/pl', '/[locale]/(public)'],
      ];
      for (const [key, route] of keys) {
        const headers = { 'x-next-cache-tags': (await entryTags(route)).join(',') };
        await handler.set(key, { kind: 'APP_PAGE', html: 'ok', rscData: Buffer.from('r'), headers, status: 200 }, {});
        expect(await handler.get(key, { kind: 'APP_PAGE' }), key).not.toBeNull();
      }
      t += 1000;
      await handler.revalidateTag(capturedTags(() => revalidatePublicJobPaths()));
      for (const [key] of keys) expect(await handler.get(key, { kind: 'APP_PAGE' }), key).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('kontrola ujemna: wzorce bez grupy (public) nie trafiają w żaden tag wpisu', async () => {
    const { revalidatePath } = await import('next/cache');
    const legacy = ['/[locale]', '/[locale]/oferty-pracy/[slug]', '/[locale]/praca/kategoria/[category]'];
    const tags = capturedTags(() => {
      for (const path of legacy) revalidatePath(path, 'page');
    });
    expect(tags.length).toBe(legacy.length);
    for (const route of ISR_JOB_PAGES) {
      const own = await entryTags(route);
      expect(tags.filter((tag) => own.includes(tag)), route).toEqual([]);
    }
  });
});
