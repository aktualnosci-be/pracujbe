import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveJobListContentLocale } from '@/lib/job-content-locale';
import { applyJobListMachineTranslation } from '@/lib/job-machine-translation';
import { getJobs, type JobListItem } from '@/lib/jobs';

/**
 * #1223 (audyt 29.09 I18N-1): karta listy ofert zna język swojego tytułu i wyróżników, choć
 * `get_public_jobs` go nie zwraca — jedno zapytanie o tłumaczenia ofert strony (bez migracji),
 * reguła jak kolejność RPC (język strony pierwszy), awaria = karta bez `lang`.
 */

const adapters = vi.hoisted(() => ({ list: vi.fn(), translations: vi.fn(), pool: {} }));
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: async () => adapters.pool }));
vi.mock('@/lib/db/public-jobs', () => ({
  getPublicJobs: adapters.list,
  getPublicJobsPage: adapters.list,
  getPublicJobListTranslations: adapters.translations,
  getPublicJobsMachineTitles: vi.fn(async () => []),
}));
const captureError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/error-report', () => ({ captureError }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const NL = { locale: 'nl', title: 'Orderpicker magazijn (m/v/x)', highlights: ['Nachtploeg'] };
const FR = { locale: 'fr', title: 'Préparateur de commandes', highlights: ['Équipe de nuit'] };

describe('resolveJobListContentLocale', () => {
  it('tłumaczenie w języku strony istnieje → karta jest w języku strony', () => {
    expect(resolveJobListContentLocale('fr', { title: FR.title, highlights: FR.highlights }, [NL, FR])).toBe('fr');
  });

  it('brak języka strony → język tłumaczenia identycznego z kartą (tytuł i wyróżniki)', () => {
    expect(resolveJobListContentLocale('pl', { title: NL.title, highlights: NL.highlights }, [NL, FR])).toBe('nl');
    expect(resolveJobListContentLocale('en', { title: FR.title, highlights: FR.highlights }, [NL, FR])).toBe('fr');
  });

  it('kontrola ujemna: sam tytuł bez zgodnych wyróżników, identyczna treść w dwóch językach, brak tłumaczeń → nieznany', () => {
    expect(resolveJobListContentLocale('pl', { title: NL.title, highlights: ['Inne'] }, [NL])).toBeUndefined();
    const same = { locale: 'fr', title: NL.title, highlights: NL.highlights };
    expect(resolveJobListContentLocale('pl', { title: NL.title, highlights: NL.highlights }, [NL, same])).toBeUndefined();
    expect(resolveJobListContentLocale('pl', { title: NL.title, highlights: [] }, [])).toBeUndefined();
    // Wiersz w nieobsługiwanym języku nie jest brany pod uwagę.
    expect(resolveJobListContentLocale('pl', { title: NL.title, highlights: NL.highlights },
      [{ ...NL, locale: 'de' }])).toBeUndefined();
  });

  it('przekład maszynowy karty ustawia język strony (bez lang na karcie)', () => {
    const card: JobListItem = {
      id: 'job-1', slug: 's', title: NL.title, companyName: 'Firma', companyVerified: true, city: 'Gent',
      region: 'Vlaanderen', contractType: 'permanent', currency: 'EUR', publishedAt: '2026-09-01T00:00:00Z',
      isNew: false, highlights: NL.highlights, category: 'warehouse', accommodation: false, immediate: false,
      noLanguageRequired: false, contentLocale: 'nl',
    };
    const translated = applyJobListMachineTranslation(
      card, { source_locale: 'nl', origin: 'ai', fields: { title: 'Kompletowanie', 'highlights.0': 'Noc' } }, 'pl');
    expect(translated.contentLocale).toBe('pl');
  });
});

function row(index: number, title: string, highlights: string[]) {
  return {
    id: `job-${index}`, slug: `oferta-${index}`, title, company_name: 'Firma', company_verified: true,
    city: 'Gent', region: 'Vlaanderen', contract_type: 'permanent', currency: 'EUR',
    published_at: '2026-09-01T00:00:00Z', highlights, category: 'warehouse',
  };
}

describe('getJobs — język treści kart', () => {
  function arrange() {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.list.mockResolvedValue({
      rows: [row(1, NL.title, NL.highlights), row(2, 'Magazynier', [])],
      total: 2, page: 1, pageSize: 2, maxPage: 1,
    });
    adapters.translations.mockResolvedValue([
      { job_id: 'job-1', ...NL },
      { job_id: 'job-2', locale: 'pl', title: 'Magazynier', highlights: [] },
    ]);
  }

  it('lista na karty → JEDNO zapytanie o tłumaczenia strony i contentLocale każdej oferty', async () => {
    arrange();
    const result = await getJobs({ locale: 'pl', page: 1, pageSize: 2 }, undefined, { translateCards: true });
    expect(adapters.translations).toHaveBeenCalledTimes(1);
    expect(adapters.translations).toHaveBeenCalledWith(adapters.pool, ['job-1', 'job-2']);
    expect(result.jobs.map((job) => job.contentLocale)).toEqual(['nl', 'pl']);
  });

  it('pulpit (withContentLocale) liczy język bez przekładu kart', async () => {
    arrange();
    const result = await getJobs({ locale: 'pl', page: 1, pageSize: 2 }, undefined,
      { withTotal: false, withContentLocale: true });
    expect(result.jobs[0]?.contentLocale).toBe('nl');
  });

  it('kontrola ujemna: lista bez kart (sitemap, liczniki) nie czyta tłumaczeń', async () => {
    arrange();
    const result = await getJobs({ locale: 'pl', page: 1, pageSize: 2 });
    expect(adapters.translations).not.toHaveBeenCalled();
    expect(result.jobs.every((job) => job.contentLocale === undefined)).toBe(true);
  });

  it('awaria odczytu → karty bez języka, log z samym kodem obszaru', async () => {
    arrange();
    adapters.translations.mockRejectedValue(new Error('permission denied'));
    const result = await getJobs({ locale: 'pl', page: 1, pageSize: 2 }, undefined, { translateCards: true });
    expect(result.jobs.map((job) => job.title)).toEqual([NL.title, 'Magazynier']);
    expect(result.jobs.every((job) => job.contentLocale === undefined)).toBe(true);
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { area: 'jobs.readListContentLocales' });
  });
});
