import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';
import { jobFunnelCsv, jobFunnelCsvFilename, type JobFunnelCsvLabels } from '@/lib/job-funnel/csv';

/**
 * Eksport lejka ofert do CSV (`/api/employer/job-funnel`, #99): te same dane co
 * `/employer/statystyki`, nagłówki w języku panelu, neutralizacja formuł w tytułach ofert,
 * kody odmowy bez treści i brak cache.
 */

const MESSAGES = { pl, nl, fr, en } as const;
type Messages = (typeof MESSAGES)[keyof typeof MESSAGES];

const state = vi.hoisted(() => ({
  configured: true,
  user: { id: 'u-1' } as { id: string } | null,
  load: null as unknown,
  throws: null as unknown,
  getJobFunnel: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock('@/lib/db/portal', () => ({
  isPortalDataConfigured: () => state.configured,
  getPortalIdentity: async () => (state.user ? { id: state.user.id, role: 'employer' } : null),
}));
vi.mock('@/lib/data/employer', () => ({
  getJobFunnel: async (days: number) => {
    state.getJobFunnel(days);
    if (state.throws) throw state.throws;
    return state.load;
  },
}));
vi.mock('@/lib/error-report', () => ({ captureError: state.captureError }));
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: keyof typeof MESSAGES; namespace: string }) => {
    const ns = (MESSAGES[locale] as unknown as Record<string, Record<string, string>>)[namespace] ?? {};
    const t = (key: string) => ns[key] ?? key;
    t.has = (key: string) => key in ns;
    return t;
  },
}));

const { GET } = await import('@/app/api/employer/job-funnel/route');

const range = { days: 30 as const, from: '2026-08-29', to: '2026-09-27' };
const jobs = [
  { jobId: 'j1', title: 'Magazynier, zmiana "B"', slug: 'magazynier', status: 'active',
    searchAppearances: 1200, detailViews: 30, applyStarted: 6, applicationsSubmitted: 2 },
  { jobId: 'j2', title: '=HYPERLINK("http://evil")', slug: '', status: 'closed',
    searchAppearances: 50, detailViews: 1, applyStarted: 0, applicationsSubmitted: 1 },
  { jobId: 'j3', title: '  ', slug: '', status: 'weird',
    searchAppearances: 0, detailViews: 0, applyStarted: 0, applicationsSubmitted: 0 },
];
const totals = { searchAppearances: 1250, detailViews: 31, applyStarted: 6, applicationsSubmitted: 3 };

function labels(messages: Messages): JobFunnelCsvLabels {
  const t = messages.jobFunnel;
  return {
    from: t.csvFrom, to: t.csvTo, offer: t.offer, status: t.csvStatus,
    searchAppearances: t.searchAppearances, detailViews: t.detailViews,
    applyStarted: t.applyStarted, applicationsSubmitted: t.applicationsSubmitted,
    total: t.csvTotal, untitled: t.untitled,
    statusLabel: (s) => (messages.status as Record<string, string>)[s] ?? '',
  };
}

function call(query = 'dni=30&locale=pl') {
  return GET(new Request(`http://localhost/api/employer/job-funnel?${query}`));
}

function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-robots-tag')).toContain('noindex');
}

describe('jobFunnelCsv', () => {
  it('builds a header, one row per job and a total row with raw integers', () => {
    const csv = jobFunnelCsv(range, jobs, totals, labels(pl));
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines.at(-1)).toBe('');
    expect(lines[0]).toBe('Od,Do,Oferta,Status,Pojawienia w wynikach,Wyświetlenia ofert,Rozpoczęte aplikowanie,Wysłane aplikacje');
    expect(lines[1]).toBe('2026-08-29,2026-09-27,"Magazynier, zmiana ""B""",Aktywna,1200,30,6,2');
    expect(lines[4]).toBe('2026-08-29,2026-09-27,Razem,,1250,31,6,3');
    expect(lines).toHaveLength(6);
  });

  it('neutralises spreadsheet formulas in job titles (negative control: raw cell would start with =)', () => {
    const line = jobFunnelCsv(range, jobs, totals, labels(pl)).split('\r\n')[2]!;
    const titleCell = line.split(',').slice(2, -5).join(',');
    expect(titleCell.startsWith('=')).toBe(false);
    expect(titleCell).toBe(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('uses the untitled label for blank titles and an empty cell for unknown statuses', () => {
    const line = jobFunnelCsv(range, jobs, totals, labels(pl)).split('\r\n')[3]!;
    expect(line).toBe(`2026-08-29,2026-09-27,${pl.jobFunnel.untitled},,0,0,0,0`);
  });

  it.each(Object.entries(MESSAGES))('%s: every header label is translated', (_locale, messages) => {
    const header = jobFunnelCsv(range, [], totals, labels(messages)).slice(1).split('\r\n')[0]!;
    for (const key of ['csvFrom', 'csvTo', 'offer', 'csvStatus', 'searchAppearances'] as const) {
      expect(messages.jobFunnel[key]).toBeTruthy();
      expect(header).toContain(messages.jobFunnel[key]);
    }
  });

  it('names the file after the range only', () => {
    expect(jobFunnelCsvFilename(range)).toBe('job-funnel-2026-08-29_2026-09-27.csv');
  });
});

describe('GET /api/employer/job-funnel', () => {
  beforeEach(() => {
    state.configured = true;
    state.user = { id: 'u-1' };
    state.load = { status: 'ok', range, totals, jobs };
    state.throws = null;
    state.getJobFunnel.mockClear();
    state.captureError.mockClear();
  });

  it('returns the CSV of the active company in the panel language', async () => {
    const response = await call('dni=90&locale=nl');
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="job-funnel-2026-08-29_2026-09-27.csv"');
    expect(state.getJobFunnel).toHaveBeenCalledWith(90);
    const body = await response.text();
    expect(body).toContain(nl.jobFunnel.csvTotal);
    expect(body).toContain(`,${nl.status.active},1200,30,6,2`);
    expect(body).not.toContain(pl.jobFunnel.csvTotal);
  });

  it('falls back to the default range for an unknown value, like the page', async () => {
    await call('dni=365&locale=pl');
    expect(state.getJobFunnel).toHaveBeenCalledWith(30);
  });

  it('rejects an unsupported locale', async () => {
    const response = await call('dni=30&locale=de');
    expect(response.status).toBe(400);
    expect(state.getJobFunnel).not.toHaveBeenCalled();
  });

  it('does not export demo data', async () => {
    state.configured = false;
    const response = await call();
    expect(response.status).toBe(404);
    expect(state.getJobFunnel).not.toHaveBeenCalled();
  });

  it('requires a session', async () => {
    state.user = null;
    const response = await call();
    expect(response.status).toBe(401);
    expectPrivate(response);
    expect(state.getJobFunnel).not.toHaveBeenCalled();
  });

  it('answers 403 without a body when the role may not read the funnel', async () => {
    state.load = { status: 'denied', range };
    const response = await call();
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('');
  });

  it('answers 500 without technical details on a read error', async () => {
    state.load = { status: 'error', range };
    const failed = await call();
    expect(failed.status).toBe(500);
    expect(await failed.text()).toBe('');

    state.throws = new Error('connection refused at 10.0.0.1');
    const thrown = await call();
    expect(thrown.status).toBe(500);
    expect(await thrown.text()).toBe('');
    expect(state.captureError).toHaveBeenCalledTimes(1);
  });
});
