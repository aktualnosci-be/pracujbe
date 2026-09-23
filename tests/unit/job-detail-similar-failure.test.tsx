import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobDetail } from '@/lib/jobs';

/**
 * #191: po udanym `getJobBySlug` awaria podobnych ofert nie przerywa strony — opis,
 * wymagania, firma i aplikowanie zostają; sekcja podobnych pokazuje neutralny błąd
 * z ponowieniem zamiast fikcyjnych ofert. Brak oferty to nadal 404, a błąd głównego
 * odczytu nie udaje nieistniejącej oferty.
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
vi.mock('@/components/public/JobMatchCard', () => ({ JobMatchCard: () => null }));
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
  getFormatter: async () => ({ dateTime: () => '1 stycznia 2026' }),
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

beforeEach(() => {
  vi.clearAllMocks();
  jobs.getJobBySlug.mockResolvedValue(job);
});

for (const locale of locales) {
  describe(`szczegół oferty przy awarii podobnych (${locale})`, () => {
    beforeEach(() => {
      messages = JSON.parse(readFileSync(resolve('src/messages', `${locale}.json`), 'utf8')) as Messages;
    });

    it('zachowuje opis, wymagania, firmę i aplikowanie; sekcja podobnych = błąd z ponowieniem', async () => {
      jobs.getSimilarJobs.mockResolvedValue({ status: 'error' });

      const html = renderToStaticMarkup(await JobDetailPage(params(locale)));
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const text = doc.body.textContent ?? '';

      expect(text).toContain(job.title);
      expect(text).toContain(job.description);
      expect(text).toContain('Uprawnienia UDT');
      expect(text).toContain(job.companyName);
      expect(doc.querySelectorAll('[data-testid="apply"]').length).toBeGreaterThan(0);

      const alert = doc.querySelector('#podobne [role="alert"]');
      expect(alert?.textContent).toContain(lookup('job', 'similarJobsLoadError'));
      expect(alert?.querySelector('button')?.textContent).toBe(lookup('common', 'retry'));
      // Brak fikcyjnych podobnych ofert.
      expect(doc.querySelectorAll('#podobne a[href*="/oferty-pracy/"]').length).toBe(0);
      // Brak technicznych szczegółów w treści.
      expect(text).not.toMatch(/INTERNAL|SQL|stack|Error:/);
    });

    it('udany pusty odczyt podobnych: brak sekcji i kotwicy, bez komunikatu błędu', async () => {
      jobs.getSimilarJobs.mockResolvedValue({ status: 'ok', jobs: [] });

      const html = renderToStaticMarkup(await JobDetailPage(params(locale)));

      expect(html).not.toContain('id="podobne"');
      expect(html).not.toContain('href="#podobne"');
      expect(html).not.toContain(lookup('job', 'similarJobsLoadError'));
    });
  });
}

describe('główny odczyt oferty (#191)', () => {
  it('nieistniejąca oferta → 404', async () => {
    jobs.getJobBySlug.mockResolvedValue(null);
    await expect(JobDetailPage(params('pl', 'brak'))).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
    expect(jobs.getSimilarJobs).not.toHaveBeenCalled();
  });

  it('błąd głównego odczytu nie jest przedstawiany jako nieistniejąca oferta', async () => {
    const failure = Object.assign(new Error('internal'), { code: 'INTERNAL' });
    jobs.getJobBySlug.mockRejectedValue(failure);
    const rejection = await JobDetailPage(params('pl')).catch((error: unknown) => error);
    expect(rejection).toBe(failure);
    expect(String((rejection as { digest?: string }).digest ?? '')).not.toContain('404');
  });
});
