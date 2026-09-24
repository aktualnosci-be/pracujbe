// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PUBLIC_JOBS_REVALIDATE_SECONDS, prerenderParamsAtBuild } from '@/lib/static-rendering';

/**
 * Strażnik #298: strony publiczne są statyczne/ISR. Wystarczy jedno wywołanie next-intl bez
 * jawnego locale w chrome'ie (Header/Footer/SkipLink), żeby next-intl sięgnął po `headers()`
 * i całe drzewo `(public)` wróciło do SSR z `Cache-Control: no-store`. Pełny dowód daje build
 * (`scripts/check-next-build.mjs` sprawdza prerender) i E2E `public-cache-headers.spec.ts`.
 */

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const PUBLIC = 'src/app/[locale]/(public)';

const JOB_PAGES = [
  `${PUBLIC}/page.tsx`,
  `${PUBLIC}/praca/page.tsx`,
  `${PUBLIC}/praca/kategoria/[category]/page.tsx`,
  `${PUBLIC}/praca/miasto/[city]/page.tsx`,
  `${PUBLIC}/oferty-pracy/[slug]/page.tsx`,
];

describe('chrome stron publicznych nie wymusza renderowania dynamicznego', () => {
  it('layout (public) ustawia locale i podaje je jawnie do Header/Footer', () => {
    const layout = read(`${PUBLIC}/layout.tsx`);
    expect(layout).toMatch(/setRequestLocale\(locale\)/);
    for (const component of ['Header', 'Footer']) {
      expect(layout).toContain(`<${component} locale={locale} />`);
    }
  });

  it('layout [locale] podaje locale jawnie do SkipLink (przed banerem zgód, #389)', () => {
    const layout = read('src/app/[locale]/layout.tsx');
    expect(layout).toMatch(/setRequestLocale\(locale\)/);
    expect(layout).toContain('<SkipLink locale={locale} />');
  });

  for (const file of ['Header', 'Footer', 'SkipLink']) {
    it(`${file}: tłumaczenia z jawnym locale, bez getLocale()`, () => {
      const source = read(`src/components/layout/${file}.tsx`);
      expect(source).not.toMatch(/getLocale\(/);
      // Każde getTranslations dostaje obiekt { locale, namespace }, nie gołą przestrzeń nazw.
      expect(source).not.toMatch(/getTranslations\(\s*['"]/);
      expect(source).toMatch(/getTranslations\(\{ locale, namespace:/);
    });
  }

  it('strony publiczne i chrome nie czytają cookies/nagłówków żądania', () => {
    const files = [
      'src/app/[locale]/layout.tsx',
      'src/components/cookies/CookieConsent.tsx',
      `${PUBLIC}/layout.tsx`,
      ...JOB_PAGES,
      'src/components/layout/Header.tsx',
      'src/components/layout/Footer.tsx',
    ];
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/from 'next\/headers'/);
      expect(source, file).not.toMatch(/supabase\/server|getCurrentUser|getSession/);
    }
  });
});

describe('ISR stron z ofertami', () => {
  for (const file of JOB_PAGES) {
    it(`${file}: revalidate = PUBLIC_JOBS_REVALIDATE_SECONDS`, () => {
      // Next wymaga literału w `export const revalidate`, więc pilnujemy zgodności ze stałą.
      expect(read(file)).toContain(`export const revalidate = ${PUBLIC_JOBS_REVALIDATE_SECONDS};`);
    });
  }

  it('strony treściowe mają górną granicę świeżości w layoucie (public)', () => {
    expect(read(`${PUBLIC}/layout.tsx`)).toMatch(/export const revalidate = 3600;/);
  });
});

describe('prerenderParamsAtBuild — build nie łączy się z bazą', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('bez bazy (demo/CI) prerenderuje wszystkie parametry', () => {
    vi.stubEnv('DATABASE_APP_URL', '');
    expect(prerenderParamsAtBuild([{ locale: 'pl' }, { locale: 'nl' }])).toEqual([
      { locale: 'pl' },
      { locale: 'nl' },
    ]);
  });

  it('ze skonfigurowaną bazą zwraca pustą listę (strony powstają przy pierwszym żądaniu)', () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://app@db.internal/pracujbe');
    expect(prerenderParamsAtBuild([{ locale: 'pl' }])).toEqual([]);
  });

  it('landingi z ofertami korzystają z helpera', () => {
    for (const file of [
      `${PUBLIC}/praca/page.tsx`,
      `${PUBLIC}/praca/kategoria/[category]/page.tsx`,
      `${PUBLIC}/praca/miasto/[city]/page.tsx`,
    ]) {
      expect(read(file), file).toContain('prerenderParamsAtBuild(');
    }
  });

  it('layout [locale] zawsze prerenderuje komplet języków (pusta lista = 500 DYNAMIC_SERVER_USAGE)', () => {
    // Pusta lista w layoucie sprawiała, że build nie renderował stron pod [locale] i nie wykrywał
    // tych, które czytają cookies/nagłówki (logowanie, rejestracja, lista ofert) — na produkcji
    // z DATABASE_APP_URL kończyły się błędem 500.
    const layout = read('src/app/[locale]/layout.tsx');
    expect(layout).not.toContain('prerenderParamsAtBuild(');
    expect(layout).toMatch(/return routing\.locales\.map\(\(locale\) => \(\{ locale \}\)\);/);
  });
});

describe('isBuildPhase — odczyty ofert w buildzie nie łączą się z bazą', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('w next build ze skonfigurowaną bazą getJobs zwraca pusty wynik bez dostępu do bazy', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://app@db.internal/pracujbe');
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    const runtime = await import('@/lib/db/runtime');
    const pool = vi.spyOn(runtime, 'getDomainPool');
    const { getJobs, getJobBySlug, getCategoryCounts } = await import('@/lib/jobs');
    await expect(getJobs({ locale: 'pl' })).resolves.toMatchObject({ jobs: [], total: 0 });
    await expect(getJobBySlug('dowolna', 'pl')).resolves.toBeNull();
    await expect(getCategoryCounts('pl', ['warehouse'])).resolves.toBeNull();
    expect(pool).not.toHaveBeenCalled();
  });

  it('kontrola ujemna: poza buildem skonfigurowana baza jest odpytywana', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://app@db.internal/pracujbe');
    vi.stubEnv('NEXT_PHASE', 'phase-production-server');
    const runtime = await import('@/lib/db/runtime');
    const pool = vi.spyOn(runtime, 'getDomainPool').mockRejectedValue(new Error('brak bazy'));
    const { getJobs } = await import('@/lib/jobs');
    await expect(getJobs({ locale: 'pl' })).rejects.toBeTruthy();
    expect(pool).toHaveBeenCalled();
  });
});
