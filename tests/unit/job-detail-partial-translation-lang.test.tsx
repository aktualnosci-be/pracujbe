import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobDetail } from '@/lib/jobs';

/**
 * #896: częściowy przekład oferty (#33). Pole bez klucza w przekładzie zostaje w oryginale
 * i dostaje `lang` języka źródła; pola przełożone są w języku strony (bez `lang`).
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
  id: '00000000-0000-4000-8000-000000000896',
  slug: 'magazijnmedewerker-gent',
  title: 'Warehouse worker',
  companyName: 'Logistiek Gent NV',
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
  description: 'Work in the warehouse from 8:00.',
  responsibilities: ['Order picking'],
  requirementsMandatory: [],
  requirementsOptional: [],
  conditions: [],
  workingHours: '',
  languages: [],
  transport: false,
  companyDescription: 'Logistiek bedrijf',
  contentLocale: 'nl',
  availableLocales: ['nl'],
};

const params = (locale: string) => ({ params: Promise.resolve({ locale, slug: job.slug }) });

async function render(patch: Partial<JobDetail>): Promise<Document> {
  jobs.getJobBySlug.mockResolvedValue({ ...job, ...patch });
  jobs.getSimilarJobs.mockResolvedValue({ status: 'ok', jobs: [] });
  const html = renderToStaticMarkup(await JobDetailPage(params('en')));
  return new DOMParser().parseFromString(html, 'text/html');
}

function paragraph(doc: Document, text: string): HTMLElement {
  const found = [...doc.querySelectorAll('p')].find((p) => p.textContent === text);
  if (!found) throw new Error(`brak akapitu: ${text}`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  messages = JSON.parse(readFileSync(resolve('src/messages', 'en.json'), 'utf8')) as Messages;
});

describe('szczegół oferty: język pól przy częściowym przekładzie (#896)', () => {
  it('opis firmy bez przekładu ma lang języka źródła, przełożony opis — bez lang', async () => {
    const doc = await render({
      machineTranslation: { sourceLocale: 'nl', origin: 'ai', untranslated: ['companyDescription'] },
    });
    expect(paragraph(doc, 'Logistiek bedrijf').getAttribute('lang')).toBe('nl');
    expect(paragraph(doc, 'Work in the warehouse from 8:00.').hasAttribute('lang')).toBe(false);
    expect(doc.querySelector('h1')?.hasAttribute('lang')).toBe(false);
  });

  it('opis oferty bez przekładu też dostaje lang źródła', async () => {
    const doc = await render({
      description: 'Werk in het magazijn vanaf 8:00.',
      machineTranslation: { sourceLocale: 'nl', origin: 'manual', untranslated: ['description', 'companyDescription'] },
    });
    expect(paragraph(doc, 'Werk in het magazijn vanaf 8:00.').getAttribute('lang')).toBe('nl');
    expect(paragraph(doc, 'Logistiek bedrijf').getAttribute('lang')).toBe('nl');
  });

  it('kontrola ujemna: komplet przekładu = żadne pole nie udaje oryginału', async () => {
    const doc = await render({
      companyDescription: 'Logistics company',
      machineTranslation: { sourceLocale: 'nl', origin: 'ai', untranslated: [] },
    });
    expect(paragraph(doc, 'Logistics company').hasAttribute('lang')).toBe(false);
    expect(paragraph(doc, 'Work in the warehouse from 8:00.').hasAttribute('lang')).toBe(false);
  });

  it('kontrola ujemna: bez przekładu (#301) cała treść ma lang oryginału', async () => {
    const doc = await render({ description: 'Werk vanaf 8:00.', title: 'Magazijnmedewerker' });
    expect(paragraph(doc, 'Werk vanaf 8:00.').getAttribute('lang')).toBe('nl');
    expect(paragraph(doc, 'Logistiek bedrijf').getAttribute('lang')).toBe('nl');
    expect(doc.querySelector('h1')?.getAttribute('lang')).toBe('nl');
  });
});
