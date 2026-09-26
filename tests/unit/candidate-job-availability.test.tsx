import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { asJobAvailability, getMyApplicationsPage, type MyApplication } from '@/lib/data/candidate';
import { CandidateApplicationsList } from '@/components/candidate/CandidateApplicationsList';
import { JobAvailabilityNote } from '@/components/candidate/JobAvailabilityNote';
import { fakeDb, resetFakeDb } from '../helpers/fake-db';

/**
 * 0206 — historia zgłoszeń kandydata po zamknięciu/wygaśnięciu oferty: RPC zwraca
 * `job_availability` i `slug` tylko dla oferty publicznej; karta pokazuje etykietę stanu
 * zamiast linku „Zobacz ofertę” (404). SQL i klasyfikacja: `rls.sql` sekcja AV206.
 */

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/actions/candidate-applications', () => ({ loadMoreApplications: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock('@/components/ui/status-pill', () => ({ StatusPill: ({ status }: { status: string }) => <span>{status}</span> }));
vi.mock('@/components/candidate/ApplicationActions', () => ({ ApplicationActions: () => <span /> }));

const ownerId = '22222222-2222-4222-8222-222222222222';
const openJob = '11111111-1111-4111-8111-111111111111';
const closedJob = '11111111-1111-4111-8111-111111111112';

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: ownerId, role: 'candidate' });
});
afterEach(() => cleanup());

describe('asJobAvailability', () => {
  it('accepts only the four RPC values', () => {
    expect(['available', 'expired', 'closed', 'unavailable'].map(asJobAvailability)).toEqual([
      'available', 'expired', 'closed', 'unavailable',
    ]);
    expect(asJobAvailability('deleted')).toBeNull();
    expect(asJobAvailability(null)).toBeNull();
  });
});

describe('getMyApplicationsPage — stan oferty', () => {
  it('maps job_availability and asks the RPC for it', async () => {
    fakeDb
      .rows('candidate.applications-page', () => [
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', job_id: openJob, status: 'submitted', submitted_at: '2026-09-20T09:00:00+00:00', screening_count: 0 },
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', job_id: closedJob, status: 'viewed', submitted_at: '2026-09-19T09:00:00+00:00', screening_count: 0 },
      ])
      .rows('candidate.applied-jobs-page', () => [
        { job_id: openJob, slug: 'otwarta', title: 'Otwarta', company_name: 'Firma', city: 'Gent', job_availability: 'available' },
        { job_id: closedJob, slug: null, title: 'Zamknięta', company_name: 'Firma', city: 'Gent', job_availability: 'closed' },
      ]);
    const page = await getMyApplicationsPage('pl');
    expect(page.items.map((i) => [i.jobTitle, i.slug, i.jobAvailability])).toEqual([
      ['Otwarta', 'otwarta', 'available'],
      ['Zamknięta', null, 'closed'],
    ]);
    expect(fakeDb.callsTo('candidate.applied-jobs-page')[0]!.text).toContain('d.job_availability');
  });
});

describe('karta zgłoszenia', () => {
  const base: MyApplication = {
    id: 'app-1', jobTitle: 'Magazynier', companyName: 'Firma', slug: 'magazynier',
    date: '2026-09-20T09:00:00Z', status: 'submitted', screeningCount: 0, jobAvailability: 'available',
  };

  it.each([
    ['closed', 'jobAvailabilityClosed'],
    ['expired', 'jobAvailabilityExpired'],
    ['unavailable', 'jobAvailabilityUnavailable'],
  ] as const)('%s offer: label instead of a dead link', (availability, label) => {
    render(
      <CandidateApplicationsList
        locale="pl"
        initialPage={{ items: [{ ...base, slug: null, jobAvailability: availability }], nextCursor: null }}
      />,
    );
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'actionView' })).not.toBeInTheDocument();
    // Szczegół zgłoszenia zostaje dostępny.
    expect(screen.getByRole('link', { name: 'candidateApplicationDetailsLinkLabel' })).toHaveAttribute(
      'href', '/candidate/aplikacje/app-1');
  });

  it('public offer (negative control): link, no label', () => {
    render(<CandidateApplicationsList locale="pl" initialPage={{ items: [base], nextCursor: null }} />);
    expect(screen.getByRole('link', { name: 'actionView' })).toHaveAttribute('href', '/oferty-pracy/magazynier');
    expect(screen.queryByText(/^jobAvailability/)).not.toBeInTheDocument();
  });

  it('unknown state renders nothing', () => {
    const { container } = render(<JobAvailabilityNote availability={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
