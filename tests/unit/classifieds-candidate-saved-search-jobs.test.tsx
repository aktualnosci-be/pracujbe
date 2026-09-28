import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider, createTranslator } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';
import type { JobListItem } from '@/lib/jobs';
import { fakeDb, resetFakeDb } from '../helpers/fake-db';

/**
 * Tryb ogłoszeniowy — pulpit kandydata (epik #1128; decyzja produktowa: portal ogłoszeniowy):
 * w miejscu polecanych ofert najnowsze oferty z ZAPISANYCH WYSZUKIWAŃ kandydata. Filtry to
 * kanoniczny adres zapisany z wyszukiwaniem (`parseJobListQuery`), oferty z publicznej listy
 * (`getJobs`, kolejność „najnowsze”, firmy zablokowane pomija baza dla `candidateId`). Bez wyniku
 * i dopasowania. Awaria odczytu = jawny błąd z ponowieniem, nie pusty wynik.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/auth/candidate-viewer', () => ({ readCandidateViewerId: vi.fn(async () => 'cand-1') }));
vi.mock('@/lib/jobs', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/jobs')>()), getJobs: vi.fn() }));

const MESSAGES = { pl, nl, fr, en } as const;
type Locale = keyof typeof MESSAGES;

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: Locale; namespace: string }) =>
    createTranslator({ locale, messages: MESSAGES[locale], namespace: namespace as never }),
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  Link: ({ children, href, locale, ...props }: Omit<React.ComponentProps<'a'>, 'href'> & { href: string; locale?: string }) => (
    <a {...props} href={href} data-locale={locale}>
      {children}
    </a>
  ),
}));

const { getJobs } = await import('@/lib/jobs');
const { loadSavedSearchJobs } = await import('@/lib/data/candidate-saved-search-jobs');
const { CandidateSavedSearchJobs } = await import('@/components/candidate/CandidateSavedSearchJobs');

const ME = '11111111-1111-4111-8111-111111111111';

const search = (id: string, name: string, query: string, locale = 'pl') => ({
  id, name, query, locale, frequency: 'daily', alerts_enabled: true, last_alert_at: null, created_at: '2026-09-01T10:00:00Z',
});

function job(id: string, publishedAt: string, extra: Partial<JobListItem> = {}): JobListItem {
  return {
    id, slug: `oferta-${id}`, title: `Oferta ${id}`, companyName: `Firma ${id}`, companyVerified: true, city: 'Gent',
    region: 'Flandria', contractType: 'permanent', currency: 'EUR', publishedAt, isNew: true, highlights: [],
    category: 'warehouse', accommodation: false, immediate: false, noLanguageRequired: false, ...extra,
  } as JobListItem;
}

function jobsFor(map: Record<string, JobListItem[]>) {
  vi.mocked(getJobs).mockImplementation(async (params) => {
    const jobs = map[params.keyword ?? ''] ?? [];
    return { jobs, total: jobs.length, page: 1, pageSize: 3, maxPage: 1 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: ME, role: 'candidate' });
});
afterEach(cleanup);

describe('loadSavedSearchJobs', () => {
  it('bez zapisanych wyszukiwań → none, oferty niepobierane', async () => {
    fakeDb.rows('saved-searches.mine', []);
    await expect(loadSavedSearchJobs()).resolves.toEqual({ status: 'none' });
    expect(getJobs).not.toHaveBeenCalled();
  });

  it('filtry zapisanego adresu trafiają do listy publicznej (język zapisu, najnowsze, widz = kandydat)', async () => {
    fakeDb.rows('saved-searches.mine', [search('s1', 'Magazyn Gent', '?keyword=magazynier&category=warehouse&location=Gent', 'nl')]);
    jobsFor({ magazynier: [job('a', '2026-09-27T10:00:00Z')] });
    const load = await loadSavedSearchJobs();
    expect(load.status).toBe('ok');
    expect(getJobs).toHaveBeenCalledTimes(1);
    const [params, viewer] = vi.mocked(getJobs).mock.calls[0]!;
    expect(params).toMatchObject({ locale: 'nl', keyword: 'magazynier', categories: ['warehouse'], sort: 'newest', page: 1, pageSize: 3 });
    expect(viewer).toEqual({ candidateId: 'cand-1' });
  });

  it('łączy wyszukiwania: najnowsze najpierw, bez duplikatów, najwyżej 3 oferty, z wyszukiwaniem źródłowym', async () => {
    fakeDb.rows('saved-searches.mine', [
      search('s1', 'Magazyn', '?keyword=magazyn'),
      search('s2', 'Kierowca', '?keyword=kierowca', 'fr'),
    ]);
    jobsFor({
      magazyn: [job('a', '2026-09-20T10:00:00Z'), job('b', '2026-09-10T10:00:00Z')],
      kierowca: [job('c', '2026-09-25T10:00:00Z'), job('a', '2026-09-20T10:00:00Z'), job('d', '2026-09-01T10:00:00Z')],
    });
    const load = await loadSavedSearchJobs();
    expect(load.status === 'ok' && load.jobs.map((item) => [item.id, item.searchId])).toEqual([
      ['c', 's2'], ['a', 's1'], ['b', 's1'],
    ]);
    expect(load.status === 'ok' && load.searches.map((item) => [item.id, item.locale])).toEqual([['s1', 'pl'], ['s2', 'fr']]);
    // Pola dopasowania/wyniku nie istnieją w wyniku loadera.
    expect(load.status === 'ok' && load.jobs[0]).not.toHaveProperty('match');
  });

  it('bierze pod uwagę najwyżej 3 najnowsze wyszukiwania', async () => {
    fakeDb.rows('saved-searches.mine', ['a', 'b', 'c', 'd', 'e'].map((k) => search(`s-${k}`, k, `?keyword=${k}`)));
    jobsFor({});
    const load = await loadSavedSearchJobs();
    expect(getJobs).toHaveBeenCalledTimes(3);
    expect(load.status === 'ok' && load.searches).toHaveLength(3);
    expect(load.status === 'ok' && load.jobs).toEqual([]);
  });

  it('awaria odczytu wyszukiwań → error, nie none', async () => {
    fakeDb.rows('saved-searches.mine', () => { throw new Error('db down'); });
    await expect(loadSavedSearchJobs()).resolves.toEqual({ status: 'error' });
  });

  it('awaria odczytu ofert → error, nie pusta lista', async () => {
    fakeDb.rows('saved-searches.mine', [search('s1', 'Magazyn', '?keyword=magazyn')]);
    vi.mocked(getJobs).mockRejectedValue(new Error('rpc down'));
    await expect(loadSavedSearchJobs()).resolves.toEqual({ status: 'error' });
  });
});

describe('CandidateSavedSearchJobs', () => {
  const okResult = {
    status: 'ok' as const,
    jobs: [
      { id: 'a', slug: 'oferta-a', title: 'Magazynier', companyName: 'Firma A', city: 'Gent', publishedAt: '2026-09-27T10:00:00Z', searchId: 's1' },
    ],
    searches: [
      { id: 's1', name: 'Magazyn Gent', query: '?keyword=magazynier', locale: 'nl' as const },
      { id: 's2', name: '', query: '?category=driver', locale: 'fr' as const },
    ],
  };

  async function renderSection(locale: Locale, result: React.ComponentProps<typeof CandidateSavedSearchJobs>['result']) {
    const element = await CandidateSavedSearchJobs({ locale, result });
    return render(<NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>{element}</NextIntlClientProvider>);
  }

  it.each(Object.keys(MESSAGES) as Locale[])('%s: oferty z wyszukiwań, linki „Pokaż oferty” w języku zapisu, bez wyniku dopasowania', async (locale) => {
    const t = MESSAGES[locale];
    const { container } = await renderSection(locale, okResult);
    expect(screen.getByRole('heading', { level: 2, name: t.dashboard.savedSearchJobsTitle })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Magazynier' })).toHaveAttribute('href', '/oferty-pracy/oferta-a');
    const shown = screen.getAllByRole('link', { name: /^(Pokaż oferty|Vacatures tonen|Voir les offres|Show jobs)/ });
    expect(shown.map((a) => [a.getAttribute('href'), a.getAttribute('data-locale')])).toEqual([
      ['/oferty-pracy?keyword=magazynier', 'nl'],
      ['/oferty-pracy?category=driver', 'fr'],
    ]);
    expect(screen.getByRole('link', { name: t.dashboard.navSearches })).toHaveAttribute('href', '/candidate/wyszukiwania');
    expect(container.textContent).not.toMatch(/%/);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('brak zapisanych wyszukiwań → zachęta z linkiem do listy ofert', async () => {
    await renderSection('pl', { status: 'none' });
    expect(screen.getByText(pl.dashboard.savedSearchJobsNone)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: pl.dashboard.savedSearchJobsCta })).toHaveAttribute('href', '/oferty-pracy');
  });

  it('wyszukiwania bez ofert → osobny komunikat, linki zostają', async () => {
    await renderSection('pl', { ...okResult, jobs: [] });
    expect(screen.getByText(pl.dashboard.savedSearchJobsNoResults)).toBeInTheDocument();
    expect(screen.queryByText(pl.dashboard.savedSearchJobsNone)).toBeNull();
    expect(screen.getAllByRole('link', { name: /Pokaż oferty/ })).toHaveLength(2);
  });

  it('błąd odczytu → komunikat z ponowieniem, nie pusty stan', async () => {
    const { container } = await renderSection('pl', { status: 'error' });
    const alert = within(container).getByRole('alert');
    expect(alert).toHaveTextContent(pl.dashboard.savedSearchJobsError);
    expect(within(alert).getByRole('button', { name: pl.common.retry })).toBeInTheDocument();
    expect(screen.queryByText(pl.dashboard.savedSearchJobsNone)).toBeNull();
    expect(screen.queryByText(pl.dashboard.savedSearchJobsNoResults)).toBeNull();
  });

  it('kontrola ujemna: tryb rekrutacyjny (result = null) — sekcji nie ma', async () => {
    await expect(CandidateSavedSearchJobs({ locale: 'pl', result: null })).resolves.toBeNull();
  });
});
