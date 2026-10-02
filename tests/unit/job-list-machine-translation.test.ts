import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyJobListMachineTranslation } from '@/lib/job-machine-translation';
import { getJobs, getLatestJobs, type JobListItem } from '@/lib/jobs';

/**
 * #33 (0160): przekład tytułu i wyróżników kart listy ofert w języku widza. Jedno zapytanie
 * na stronę listy (bez N+1), tylko za flagą i tylko dla list trafiających na karty; każda
 * niezgodność albo awaria = karta w oryginale.
 */

const adapters = vi.hoisted(() => ({
  list: vi.fn(),
  titles: vi.fn(),
  pool: {},
}));
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: async () => adapters.pool }));
vi.mock('@/lib/db/public-jobs', () => ({
  getPublicJobs: adapters.list,
  getPublicJobsPage: adapters.list,
  getPublicJobsMachineTitles: adapters.titles,
  getPublicJobListTranslations: vi.fn(async () => []),
}));
const captureError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/error-report', () => ({ captureError }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function row(index: number, highlights: string[] = []) {
  return {
    id: `job-${index}`,
    slug: `oferta-${index}`,
    title: `Magazijnmedewerker ${index}`,
    company_name: 'Firma',
    company_verified: true,
    city: 'Gent',
    region: 'Vlaanderen',
    contract_type: 'permanent',
    currency: 'EUR',
    published_at: '2026-09-01T00:00:00Z',
    highlights,
    category: 'warehouse',
  };
}

function card(overrides: Partial<JobListItem> = {}): JobListItem {
  return {
    id: 'job-1', slug: 's', title: 'Magazijnmedewerker', companyName: 'Firma', companyVerified: true,
    city: 'Gent', region: 'Vlaanderen', contractType: 'permanent', currency: 'EUR',
    publishedAt: '2026-09-01T00:00:00Z', isNew: false, highlights: ['Parking', 'Nachtploeg'],
    category: 'warehouse', accommodation: false, immediate: false, noLanguageRequired: false,
    ...overrides,
  };
}

const EN_FIELDS = { title: 'Warehouse worker', 'highlights.0': 'Parking', 'highlights.1': 'Night shift' };

describe('applyJobListMachineTranslation', () => {
  it('nakłada tytuł i wyróżniki, oznacza pochodzenie', () => {
    const job = applyJobListMachineTranslation(card(), { source_locale: 'nl', origin: 'ai', fields: EN_FIELDS }, 'en');
    expect(job).toMatchObject({
      title: 'Warehouse worker',
      highlights: ['Parking', 'Night shift'],
      machineTranslation: { sourceLocale: 'nl', origin: 'ai' },
    });
    // Pola spoza przekładu karty bez zmian.
    expect(job.city).toBe('Gent');
  });

  it('korekta ręczna ma własne pochodzenie', () => {
    const job = applyJobListMachineTranslation(card(), { source_locale: 'nl', origin: 'manual', fields: EN_FIELDS }, 'en');
    expect(job.machineTranslation).toEqual({ sourceLocale: 'nl', origin: 'manual' });
  });

  it.each([
    ['brak przekładu', null],
    ['język strony = język źródła', { source_locale: 'en', origin: 'ai', fields: EN_FIELDS }],
    ['nieznany język źródła', { source_locale: 'de', origin: 'ai', fields: EN_FIELDS }],
    ['nieznane pochodzenie', { source_locale: 'nl', origin: 'robot', fields: EN_FIELDS }],
    ['pola nie są obiektem', { source_locale: 'nl', origin: 'ai', fields: ['Warehouse worker'] }],
    ['pusty tytuł', { source_locale: 'nl', origin: 'ai', fields: { ...EN_FIELDS, title: '  ' } }],
    ['mniej wyróżników niż w oryginale', { source_locale: 'nl', origin: 'ai', fields: { title: 'X', 'highlights.0': 'Parking' } }],
    ['więcej wyróżników niż w oryginale', { source_locale: 'nl', origin: 'ai', fields: { ...EN_FIELDS, 'highlights.2': 'Extra' } }],
    ['dziura w indeksach', { source_locale: 'nl', origin: 'ai', fields: { title: 'X', 'highlights.0': 'A', 'highlights.2': 'B' } }],
  ] as const)('%s → karta bez zmian', (_case, input) => {
    const original = card();
    expect(applyJobListMachineTranslation(original, input, 'en')).toBe(original);
  });
});

describe('getJobs — przekład kart listy (#33)', () => {
  function arrange(count = 12) {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.list.mockResolvedValue({
      rows: Array.from({ length: count }, (_, index) => row(index + 1)),
      total: count, page: 1, pageSize: count, maxPage: 1,
    });
  }

  it('flaga wyłączona (domyślnie) → bez odczytu przekładów, karty w oryginale', async () => {
    arrange();
    const result = await getJobs({ locale: 'en', page: 1, pageSize: 12 }, undefined, { translateCards: true });
    expect(adapters.titles).not.toHaveBeenCalled();
    expect(result.jobs.every((job) => job.machineTranslation === undefined)).toBe(true);
  });

  it('lista bez kart (sitemap, liczniki) → bez odczytu przekładów mimo flagi', async () => {
    arrange();
    vi.stubEnv('AI_TRANSLATION_ENABLED', 'true');
    await getJobs({ locale: 'en', page: 1, pageSize: 12 });
    expect(adapters.titles).not.toHaveBeenCalled();
  });

  it('flaga włączona → JEDNO zapytanie dla całej strony (bez N+1), fallback dla ofert bez przekładu', async () => {
    arrange(12);
    vi.stubEnv('AI_TRANSLATION_ENABLED', 'true');
    adapters.titles.mockResolvedValue([
      { job_id: 'job-3', source_locale: 'nl', origin: 'ai', fields: { title: 'Warehouse worker 3' } },
    ]);
    const result = await getJobs({ locale: 'en', page: 1, pageSize: 12 }, undefined, { translateCards: true });
    expect(adapters.titles).toHaveBeenCalledTimes(1);
    expect(adapters.titles).toHaveBeenCalledWith(
      adapters.pool,
      Array.from({ length: 12 }, (_, index) => `job-${index + 1}`),
      'en',
    );
    expect(result.jobs[2]).toMatchObject({ title: 'Warehouse worker 3', machineTranslation: { origin: 'ai' } });
    expect(result.jobs[0]).toMatchObject({ title: 'Magazijnmedewerker 1' });
    expect(result.jobs[0]).not.toHaveProperty('machineTranslation');
  });

  it('pusta strona → bez odczytu przekładów', async () => {
    arrange(0);
    vi.stubEnv('AI_TRANSLATION_ENABLED', 'true');
    await getJobs({ locale: 'en', page: 1, pageSize: 12 }, undefined, { translateCards: true });
    expect(adapters.titles).not.toHaveBeenCalled();
  });

  it('awaria odczytu przekładów → karty w oryginale, log bez treści', async () => {
    arrange(2);
    vi.stubEnv('AI_TRANSLATION_ENABLED', 'true');
    adapters.titles.mockRejectedValue(new Error('permission denied'));
    const result = await getJobs({ locale: 'en', page: 1, pageSize: 2 }, undefined, { translateCards: true });
    expect(result.jobs.map((job) => job.title)).toEqual(['Magazijnmedewerker 1', 'Magazijnmedewerker 2']);
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { area: 'jobs.readListMachineTranslations' });
  });

  it('„Najnowsze oferty” na stronie głównej dostają przekład kart', async () => {
    arrange(3);
    vi.stubEnv('AI_TRANSLATION_ENABLED', 'true');
    adapters.titles.mockResolvedValue([
      { job_id: 'job-1', source_locale: 'nl', origin: 'manual', fields: { title: 'Warehouse worker' } },
    ]);
    const jobs = await getLatestJobs('en', 3);
    expect(adapters.titles).toHaveBeenCalledTimes(1);
    expect(jobs[0]).toMatchObject({ title: 'Warehouse worker', machineTranslation: { origin: 'manual' } });
  });
});
