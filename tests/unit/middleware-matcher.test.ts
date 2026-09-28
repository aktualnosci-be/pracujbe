import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// next-intl/middleware nie ładuje się w Vitest (ESM `next/server`); tu liczy się tylko `config`.
vi.mock('next-intl/middleware', () => ({ default: () => () => new Response(null) }));

import { config } from '@/middleware';

/**
 * #1035: matcher middleware (bramka hasła + tryb „niegotowe” 503) nie może pomijać stron ani
 * Server Actions tylko dlatego, że segment ścieżki (slug) zawiera kropkę.
 */
const [pathMatcher, actionMatcher] = config.matcher as [
  string,
  { source: string; has: Array<{ type: string; key: string }> },
];
const runsMiddleware = (path: string) => new RegExp(`^${pathMatcher}$`).test(path);

/** Dawny wzorzec sprzed #1035 — kontrola ujemna (pokazuje, co naprawiamy). */
const LEGACY_MATCHER = '/((?!api|auth|_next|_vercel|.*\\..*).*)';
const legacyRunsMiddleware = (path: string) => new RegExp(`^${LEGACY_MATCHER}$`).test(path);

const DOTTED_PAGE_PATHS = [
  '/pl/oferty-pracy/praca.magazyn',
  '/nl/oferty-pracy/job.v2',
  '/fr/pracodawcy/firma.be',
  '/en/praca/miasto/a.b',
  '/pl/logowanie.html',
  '/pl/oferty-pracy/x.png',
  '/foo.bar',
];

describe('matcher middleware (#1035)', () => {
  it.each(DOTTED_PAGE_PATHS)('strona/slug z kropką %s przechodzi przez middleware', (path) => {
    expect(runsMiddleware(path)).toBe(true);
  });

  it.each(DOTTED_PAGE_PATHS)('kontrola ujemna: dawny matcher pomijał %s', (path) => {
    expect(legacyRunsMiddleware(path)).toBe(false);
  });

  it.each(['/', '/pl', '/nl/oferty-pracy', '/fr/praca/miasto/brussels', '/en/candidate/profil', '/apiary', '/authors'])(
    'zwykła ścieżka %s przechodzi przez middleware',
    (path) => {
      expect(runsMiddleware(path)).toBe(true);
    },
  );

  it.each([
    '/api/health',
    '/api/email/process',
    '/api/maintenance',
    '/auth/callback',
    '/_next/static/chunks/main.js',
    '/_next/image',
    '/_vercel/insights/script.js',
    '/images/people/team.webp',
    '/.well-known/security.txt',
    '/robots.txt',
    '/sitemap.xml',
    '/sitemap/0.xml',
    '/sitemap/12.xml',
    '/manifest.webmanifest',
    '/pl/manifest.webmanifest',
    '/nl/manifest.webmanifest',
    '/fr/manifest.webmanifest',
    '/en/manifest.webmanifest',
    '/favicon.ico',
  ])('zasób %s omija middleware', (path) => {
    expect(runsMiddleware(path)).toBe(false);
  });

  it('każdy plik z public/ (korzeń i podkatalogi) omija middleware', () => {
    const publicDir = join(process.cwd(), 'public');
    const missing: string[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const url = `${prefix}/${name}`;
        if (statSync(full).isDirectory()) walk(full, url);
        // ICONS_README.md to dokumentacja katalogu, nie zasób używany przez stronę.
        else if (runsMiddleware(url) && !url.endsWith('.md')) missing.push(url);
      }
    };
    walk(publicDir, '');
    expect(missing).toEqual([]);
  });

  it('nieznany język w manifeście nie omija middleware (kontrola ujemna)', () => {
    expect(runsMiddleware('/de/manifest.webmanifest')).toBe(true);
    expect(runsMiddleware('/pl/oferty-pracy/manifest.webmanifest')).toBe(true);
  });

  it('żądanie Server Action (nagłówek next-action) zawsze przechodzi przez middleware', () => {
    expect(actionMatcher.source).toBe('/:path*');
    expect(actionMatcher.has).toEqual([{ type: 'header', key: 'next-action' }]);
  });

  it('Next.js poprawnie kompiluje matcher (bez błędu składni path-to-regexp)', () => {
    const requireFromHere = createRequire(import.meta.url);
    const { getMiddlewareMatchers } = requireFromHere('next/dist/build/analysis/get-page-static-info') as {
      getMiddlewareMatchers: (matcher: unknown, nextConfig: unknown) => Array<{ regexp: string }>;
    };
    const compiled = getMiddlewareMatchers(config.matcher, { i18n: undefined, basePath: '' });
    expect(compiled).toHaveLength(2);
    const [first] = compiled;
    expect(new RegExp(first!.regexp).test('/pl/oferty-pracy/praca.magazyn')).toBe(true);
    expect(new RegExp(first!.regexp).test('/api/health')).toBe(false);
  });
});
