import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyJobMachineTranslation } from '@/lib/job-machine-translation';
import { getJobBySlug, type JobDetail } from '@/lib/jobs';

/**
 * #33 (0219): przekład oferty na publicznej stronie w języku widza, z fallbackiem do oryginału.
 * Nakładka tylko przy pełnej zgodności z treścią strony; za flagą; awaria = oryginał.
 */

const adapters = vi.hoisted(() => ({
  detail: vi.fn(),
  translations: vi.fn(),
  screening: vi.fn(async () => [] as unknown[]),
  machine: vi.fn(),
  pool: {},
}));
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: async () => adapters.pool }));
vi.mock('@/lib/db/public-jobs', () => ({
  getPublicJob: adapters.detail,
  getPublicJobTranslations: adapters.translations,
  getPublicJobScreeningQuestions: adapters.screening,
  getPublicJobMachineTranslation: adapters.machine,
}));
const captureError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/error-report', () => ({ captureError }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const NL_ROW = {
  id: 'job-1',
  slug: 'magazijnmedewerker',
  title: 'Magazijnmedewerker',
  description: 'Werk vanaf 8:00.',
  responsibilities: ['Orders verzamelen'],
  requirements_mandatory: ['VCA-certificaat'],
  requirements_optional: [],
  conditions: [],
  highlights: [],
  working_hours: '8:00–16:30',
  company_description: 'Logistiek bedrijf',
  published_at: '2026-09-01T00:00:00Z',
};
const EN_FIELDS = {
  title: 'Warehouse worker',
  description: 'Work from 8:00.',
  working_hours: '8:00–16:30',
  'responsibilities.0': 'Order picking',
  'requirements_mandatory.0': 'VCA certificate',
};

function baseJob(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    id: 'job-1', slug: 's', title: 'Magazijnmedewerker', companyName: 'Firma', companyVerified: true,
    city: 'Gent', region: 'Vlaanderen', contractType: 'permanent', currency: 'EUR',
    publishedAt: '2026-09-01T00:00:00Z', isNew: false, highlights: [], category: 'warehouse',
    accommodation: false, immediate: false, noLanguageRequired: false,
    description: 'Werk vanaf 8:00.', responsibilities: ['Orders verzamelen'],
    requirementsMandatory: ['VCA-certificaat'], requirementsOptional: [], conditions: [],
    workingHours: '', languages: [], transport: false, companyDescription: 'Logistiek bedrijf',
    contentLocale: 'nl', availableLocales: ['nl'],
    ...overrides,
  };
}

describe('applyJobMachineTranslation', () => {
  it('nakłada pola przekładu i oznacza pochodzenie', () => {
    const job = applyJobMachineTranslation(baseJob(), { source_locale: 'nl', origin: 'ai', fields: EN_FIELDS }, 'en');
    expect(job).toMatchObject({
      title: 'Warehouse worker',
      description: 'Work from 8:00.',
      responsibilities: ['Order picking'],
      requirementsMandatory: ['VCA certificate'],
      // Pole spoza źródła oferty (profil firmy) bez klucza w przekładzie = oryginał.
      companyDescription: 'Logistiek bedrijf',
      machineTranslation: { sourceLocale: 'nl', origin: 'ai' },
    });
  });

  it('korekta ręczna ma własne oznaczenie', () => {
    const job = applyJobMachineTranslation(baseJob(), { source_locale: 'nl', origin: 'manual', fields: EN_FIELDS }, 'en');
    expect(job.machineTranslation).toEqual({ sourceLocale: 'nl', origin: 'manual' });
  });

  it.each([
    ['brak przekładu', null],
    ['rewizja w innym języku niż treść strony', { source_locale: 'fr', origin: 'ai', fields: EN_FIELDS }],
    ['język strony = język źródła', { source_locale: 'en', origin: 'ai', fields: EN_FIELDS }],
    ['nieznane pochodzenie', { source_locale: 'nl', origin: 'robot', fields: EN_FIELDS }],
    ['brak tytułu', { source_locale: 'nl', origin: 'ai', fields: { ...EN_FIELDS, title: '' } }],
    ['lista krótsza niż w oryginale', { source_locale: 'nl', origin: 'ai', fields: { title: 'X', 'requirements_mandatory.0': 'Y' } }],
    ['lista dłuższa niż w oryginale', { source_locale: 'nl', origin: 'ai', fields: { ...EN_FIELDS, 'responsibilities.1': 'Extra' } }],
    ['dziura w indeksach listy', { source_locale: 'nl', origin: 'ai', fields: { ...EN_FIELDS, 'responsibilities.0': undefined, 'responsibilities.1': 'Order picking' } }],
    ['wartość niebędąca tekstem', { source_locale: 'nl', origin: 'ai', fields: { ...EN_FIELDS, description: 5 } }],
  ] as const)('%s → oryginał bez zmian (nigdy mieszanka języków)', (_case, input) => {
    const original = baseJob();
    const fields = input && typeof input.fields === 'object'
      ? Object.fromEntries(Object.entries(input.fields).filter(([, v]) => v !== undefined))
      : undefined;
    const job = applyJobMachineTranslation(original, input ? { ...input, fields } : null, 'en');
    expect(job).toBe(original);
  });

  it('kontrola ujemna: ta sama zgodna lista jest nakładana', () => {
    const job = applyJobMachineTranslation(baseJob(), { source_locale: 'nl', origin: 'ai', fields: EN_FIELDS }, 'en');
    expect(job).not.toBe(baseJob());
    expect(job.responsibilities).toEqual(['Order picking']);
  });
});

describe('getJobBySlug — przekład na język strony (#33)', () => {
  function arrange() {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.detail.mockResolvedValue(NL_ROW);
    adapters.translations.mockResolvedValue([
      { job_id: 'job-1', locale: 'nl', title: NL_ROW.title, description: NL_ROW.description },
    ]);
  }

  it('flaga wyłączona (domyślnie) → bez odczytu przekładu, treść oryginału', async () => {
    arrange();
    const job = await getJobBySlug('magazijnmedewerker', 'en');
    expect(adapters.machine).not.toHaveBeenCalled();
    expect(job).toMatchObject({ title: 'Magazijnmedewerker', contentLocale: 'nl' });
    expect(job).not.toHaveProperty('machineTranslation');
  });

  it('flaga włączona → przekład w języku strony z oznaczeniem', async () => {
    arrange();
    vi.stubEnv('AI_TRANSLATION_ENABLED', 'true');
    adapters.machine.mockResolvedValue({ source_locale: 'nl', origin: 'ai', fields: EN_FIELDS });
    const job = await getJobBySlug('magazijnmedewerker', 'en');
    expect(adapters.machine).toHaveBeenCalledWith(adapters.pool, 'job-1', 'en');
    expect(job).toMatchObject({ title: 'Warehouse worker', machineTranslation: { sourceLocale: 'nl', origin: 'ai' } });
  });

  it('strona w języku oryginału → bez odczytu przekładu', async () => {
    arrange();
    vi.stubEnv('AI_TRANSLATION_ENABLED', 'true');
    await getJobBySlug('magazijnmedewerker', 'nl');
    expect(adapters.machine).not.toHaveBeenCalled();
  });

  it('awaria odczytu przekładu → oryginał, log bez treści oferty', async () => {
    arrange();
    vi.stubEnv('AI_TRANSLATION_ENABLED', 'true');
    adapters.machine.mockRejectedValue(new Error('permission denied'));
    const job = await getJobBySlug('magazijnmedewerker', 'en');
    expect(job).toMatchObject({ title: 'Magazijnmedewerker' });
    expect(job).not.toHaveProperty('machineTranslation');
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { area: 'jobs.readMachineTranslation', jobId: 'job-1' });
  });
});
