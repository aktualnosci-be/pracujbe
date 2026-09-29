import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobDetail } from '@/lib/jobs';

/**
 * #1112 (TIME21-03): szczegół oferty pokazuje „Praca od zaraz” i datę rozpoczęcia zebrane
 * w kreatorze (serwerowo, bez JavaScriptu po stronie klienta), w języku strony.
 */

const jobs = vi.hoisted(() => ({ getJobBySlug: vi.fn(), getSimilarJobs: vi.fn() }));

vi.mock('@/lib/jobs', () => jobs);
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: React.ComponentProps<'a'>) => <a href={String(href)} {...props}>{children}</a>,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/components/public/ApplyModal', () => ({
  ApplyModal: ({ triggerLabel }: { triggerLabel?: string }) => <button type="button" data-testid="apply">{triggerLabel ?? 'apply'}</button>,
}));
// #1130: w trybie ogłoszeniowym (domyślny w testach) aplikowanie = kanał ogłoszeniodawcy.
vi.mock('@/components/public/EmployerApplyChannel', () => ({
  EmployerApplyChannel: () => <a data-testid="apply" href="https://example.com/apply">apply</a>,
}));
vi.mock('@/components/public/JobMatchCard', () => ({ JobMatchCard: () => null }));
vi.mock('@/components/public/JobCompanyBlockControl', () => ({ JobCompanyBlockControl: () => null }));
vi.mock('@/components/public/PublicSavedJobs', () => ({
  PublicSavedJobsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PublicSaveJobButton: () => null,
}));

type Messages = Record<string, unknown>;
const locales = ['pl', 'nl', 'fr', 'en'] as const;
let messages: Messages = {};

function lookup(namespace: string, key: string): string {
  const value = `${namespace}.${key}`.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Messages)[part] : undefined),
    messages,
  );
  return typeof value === 'string' ? value : `${namespace}.${key}`;
}

vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  // Data rozpoczęcia formatowana w UTC (dzień kalendarzowy); publikacja — stała etykieta.
  getFormatter: async () => ({
    dateTime: (date: Date, options?: { timeZone?: string }) =>
      options?.timeZone === 'UTC' ? `DATA:${date.toISOString().slice(0, 10)}` : '1 stycznia 2026',
  }),
  getTranslations: async (arg: string | { namespace: string }) => {
    const namespace = typeof arg === 'string' ? arg : arg.namespace;
    return (key: string) => lookup(namespace, key);
  },
}));

const { default: JobDetailPage } = await import('@/app/[locale]/(public)/oferty-pracy/[slug]/page');

const job: JobDetail = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'operator-wozka-gent',
  title: 'Operator wózka widłowego',
  companyName: 'Magazyn Gent NV',
  companyVerified: true,
  city: 'Gent',
  region: 'Oost-Vlaanderen',
  contractType: 'permanent',
  currency: 'EUR',
  publishedAt: '2026-09-01T08:00:00Z',
  isNew: false,
  highlights: [],
  category: 'warehouse',
  accommodation: false,
  immediate: false,
  noLanguageRequired: true,
  description: 'Obsługa wózka widłowego w centrum dystrybucyjnym.',
  responsibilities: ['Załadunek palet'],
  requirementsMandatory: ['Uprawnienia UDT'],
  requirementsOptional: [],
  conditions: [],
  workingHours: '8–16',
  languages: [],
  transport: false,
  companyDescription: 'Centrum logistyczne w Gandawie.',
  availableLocales: ['pl', 'nl', 'fr', 'en'],
};

const params = (locale: string, slug = job.slug) => ({ params: Promise.resolve({ locale, slug }) });

async function startLine(locale: string, patch: Partial<JobDetail>): Promise<string | null> {
  jobs.getJobBySlug.mockResolvedValue({ ...job, ...patch });
  jobs.getSimilarJobs.mockResolvedValue({ status: 'ok', jobs: [] });
  const html = renderToStaticMarkup(await JobDetailPage(params(locale)));
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.querySelector('[data-testid="job-start"]')?.textContent ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

for (const locale of locales) {
  describe(`szczegół oferty: rozpoczęcie pracy (${locale})`, () => {
    beforeEach(() => {
      messages = JSON.parse(readFileSync(resolve('src/messages', `${locale}.json`), 'utf8')) as Messages;
    });

    it('„od zaraz” i data rozpoczęcia w języku strony', async () => {
      expect(await startLine(locale, { immediate: true })).toBe(lookup('job', 'startImmediate'));
      expect(await startLine(locale, { startDate: '2026-10-15' })).toBe(
        `${lookup('job', 'startDate')}: DATA:2026-10-15`,
      );
      expect(await startLine(locale, { immediate: true, startDate: '2026-10-15' })).toBe(
        `${lookup('job', 'startImmediate')} · ${lookup('job', 'startDate')}: DATA:2026-10-15`,
      );
    });

    it('kontrola ujemna: bez „od zaraz” i daty (albo z datą spoza kalendarza) linii nie ma', async () => {
      expect(await startLine(locale, {})).toBeNull();
      expect(await startLine(locale, { startDate: '2026-02-31' })).toBeNull();
      expect(await startLine(locale, { startDate: 'jutro' })).toBeNull();
    });
  });
}
