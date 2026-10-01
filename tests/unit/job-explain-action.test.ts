// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { explainJobOffer } from '@/lib/actions/job-explain';
import { clearExplainCache } from '@/lib/ai-explain/cache';
import { isProductionMode } from '@/lib/env';
import { getJobBySlug, type JobDetail } from '@/lib/jobs';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, fakeSession, resetFakeDb } from '../helpers/fake-db';

/**
 * #773 — akcja „Wyjaśnij ofertę”: flaga i dostawca, tylko oferta publiczna (oryginał, nie
 * przekład), limity per adres (fail-closed — w `FAIL_SAFE_ACTIONS`), budżet AI przed modelem,
 * pamięć podręczna tej samej treści, demo bez kosztów. Dostawca to atrapa — zero sieci.
 */

const explain = vi.fn();

vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isProductionMode: vi.fn(() => true),
}));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/jobs', () => ({ getJobBySlug: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async ({ namespace }: { namespace: string }) => (key: string) => `${namespace}.${key}`),
}));
vi.mock('@/lib/ai-explain/explain', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ai-explain/explain')>();
  return { ...real, OpenAiJobExplainer: class { explain = explain; } };
});

const JOB = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'orderpicker-antwerpen',
  title: 'Orderpicker',
  companyName: 'Firma',
  companyVerified: true,
  city: 'Antwerpen',
  region: 'Antwerpen',
  contractType: 'interim',
  salaryMin: 2000,
  salaryMax: 2500,
  currency: 'EUR',
  salaryPeriod: 'month',
  publishedAt: '2026-09-01T00:00:00Z',
  isNew: false,
  highlights: [],
  category: 'logistics',
  accommodation: false,
  immediate: true,
  noLanguageRequired: true,
  description: 'Voor ons magazijn zoeken we orderpickers.',
  responsibilities: ['Bestellingen verzamelen'],
  requirementsMandatory: [],
  requirementsOptional: [],
  conditions: [],
  workingHours: '38 uur per week',
  languages: [],
  transport: false,
  companyDescription: 'Geheime interne beschrijving',
  contentLocale: 'nl',
  applyChannel: { email: 'jobs@example.com' },
} as unknown as JobDetail;

const GOOD = {
  suspiciousInstructions: false,
  items: [{ topic: 'pay', explanation: 'Pracodawca płaci od 2000 do 2500 EUR miesięcznie.', sourceIds: ['S2'] }],
  gaps: [{ topic: 'accommodation', kind: 'missing', note: 'Oferta nie mówi o zakwaterowaniu.', sourceIds: [] }],
};
const INPUT = { slug: JOB.slug, locale: 'pl', targetLocale: 'pl' };

beforeEach(() => {
  vi.clearAllMocks();
  clearExplainCache();
  process.env.AI_JOB_EXPLAIN_ENABLED = '1';
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  delete process.env.AI_JOB_EXPLAIN_PROVIDER;
  resetFakeDb(null);
  fakeDb.rpc('ai_budget_reserve', () => '44444444-4444-4444-8444-444444444444');
  fakeDb.rpc('ai_budget_settle', () => true);
  vi.mocked(isProductionMode).mockReturnValue(true);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(getJobBySlug).mockResolvedValue(JOB);
  explain.mockImplementation(async (_sources, _locale, onUsage?: (u: { inputTokens: number; outputTokens: number }) => void) => {
    onUsage?.({ inputTokens: 800, outputTokens: 200 });
    return GOOD;
  });
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

describe('explainJobOffer (#773)', () => {
  it('flaga wyłączona = NOT_FOUND bez odczytu oferty i modelu', async () => {
    delete process.env.AI_JOB_EXPLAIN_ENABLED;
    expect(await explainJobOffer(INPUT)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(getJobBySlug).not.toHaveBeenCalled();
    expect(explain).not.toHaveBeenCalled();
  });

  it('niepoprawne wejście = VALIDATION_FAILED (zły slug, język spoza listy)', async () => {
    expect(await explainJobOffer({ ...INPUT, slug: '../x' })).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(await explainJobOffer({ ...INPUT, targetLocale: 'de' })).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(getJobBySlug).not.toHaveBeenCalled();
  });

  it('oferta niepubliczna/nieistniejąca = NOT_FOUND bez modelu', async () => {
    vi.mocked(getJobBySlug).mockResolvedValue(null);
    expect(await explainJobOffer(INPUT)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(explain).not.toHaveBeenCalled();
  });

  it('wynik: objaśnienie ze źródłem (wartość w języku strony), luka; limity per adres i budżet przed modelem', async () => {
    const res = await explainJobOffer(INPUT);
    expect(res).toMatchObject({
      ok: true,
      targetLocale: 'pl',
      dropped: 0,
      items: [{ topic: 'pay', sources: [{ id: 'S2', field: 'salary', lang: 'pl' }] }],
      gaps: [{ topic: 'accommodation', kind: 'missing', sources: [] }],
    });
    expect(checkRateLimit).toHaveBeenCalledWith('job-explain', { max: 10, windowSeconds: 3600 });
    expect(checkRateLimit).toHaveBeenCalledWith('job-explain-day', { max: 30, windowSeconds: 86_400 });
    const calls = fakeDb.calls.map((c) => c.name);
    expect(calls.indexOf('ai_budget_reserve')).toBeGreaterThanOrEqual(0);
    expect(calls).toContain('ai_budget_settle');
  });

  it('do modelu: same fragmenty oferty i język — bez opisu firmy, kanału aplikowania i danych sesji', async () => {
    await explainJobOffer(INPUT);
    const [sent, locale] = explain.mock.calls[0]!;
    expect(locale).toBe('pl');
    const text = JSON.stringify(sent);
    expect(text).not.toMatch(/Geheime|jobs@example\.com/);
    expect(text).toContain('Orderpicker');
  });

  it('ta sama oferta i język = pamięć podręczna (bez drugiego wywołania i limitu); inny język = nowe wywołanie', async () => {
    await explainJobOffer(INPUT);
    await explainJobOffer(INPUT);
    expect(explain).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledTimes(2);
    await explainJobOffer({ ...INPUT, targetLocale: 'nl' });
    expect(explain).toHaveBeenCalledTimes(2);
  });

  it('kontrola ujemna pamięci: błąd nie trafia do pamięci (ponowienie woła model)', async () => {
    explain.mockResolvedValueOnce({ bad: true });
    expect(await explainJobOffer(INPUT)).toEqual({ ok: false, error: 'JOB_EXPLAIN_FAILED' });
    expect((await explainJobOffer(INPUT)).ok).toBe(true);
    expect(explain).toHaveBeenCalledTimes(2);
  });

  it('limit przekroczony = RATE_LIMITED bez budżetu i modelu', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    expect(await explainJobOffer(INPUT)).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(explain).not.toHaveBeenCalled();
    expect(fakeDb.calls.map((c) => c.name)).not.toContain('ai_budget_reserve');
  });

  it('budżet odmawia (fail-closed) = AI_BUDGET_EXCEEDED bez modelu', async () => {
    fakeDb.rpc('ai_budget_reserve', () => {
      throw new Error('AI_BUDGET_EXCEEDED');
    });
    expect(await explainJobOffer(INPUT)).toEqual({ ok: false, error: 'AI_BUDGET_EXCEEDED' });
    expect(explain).not.toHaveBeenCalled();
  });

  it('strona z przekładem maszynowym: wyjaśniamy oryginał (odczyt w języku źródła)', async () => {
    vi.mocked(getJobBySlug)
      .mockResolvedValueOnce({ ...JOB, machineTranslation: { sourceLocale: 'nl', origin: 'ai' } } as JobDetail)
      .mockResolvedValueOnce(JOB);
    await explainJobOffer(INPUT);
    expect(getJobBySlug).toHaveBeenNthCalledWith(2, JOB.slug, 'nl');
  });

  it('oferta przykładowa z prawdziwym dostawcą = DEMO_UNAVAILABLE (bez kosztów)', async () => {
    vi.mocked(getJobBySlug).mockResolvedValue({ ...JOB, isDemo: true } as JobDetail);
    expect(await explainJobOffer(INPUT)).toEqual({ ok: false, error: 'DEMO_UNAVAILABLE' });
    expect(explain).not.toHaveBeenCalled();
  });

  it('bez bazy: dostawca płatny odrzucony; atrapa poza produkcją działa bez budżetu i limitu (demo)', async () => {
    fakeSession.configured = false;
    fakeSession.serviceConfigured = false;
    expect(await explainJobOffer(INPUT)).toEqual({ ok: false, error: 'DEMO_UNAVAILABLE' });
    vi.mocked(isProductionMode).mockReturnValue(false);
    process.env.AI_JOB_EXPLAIN_PROVIDER = 'fixture';
    vi.mocked(getJobBySlug).mockResolvedValue({ ...JOB, isDemo: true } as JobDetail);
    const res = await explainJobOffer(INPUT);
    expect(res).toMatchObject({ ok: true, demo: true });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(explain).not.toHaveBeenCalled();
  });

  it('atrapa w produkcji jest ignorowana (bez klucza = wyłączone)', async () => {
    process.env.AI_JOB_EXPLAIN_PROVIDER = 'fixture';
    process.env.OPENAI_API_KEY = '';
    expect(await explainJobOffer(INPUT)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});
