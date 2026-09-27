import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CandidateApplicationsList } from '@/components/candidate/CandidateApplicationsList';
import type { MyApplication } from '@/lib/data/candidate';

const { loadMoreApplications } = vi.hoisted(() => ({ loadMoreApplications: vi.fn() }));
vi.mock('@/lib/actions/candidate-applications', () => ({ loadMoreApplications }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/i18n/navigation', () => ({ Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/components/ui/status-pill', () => ({ StatusPill: ({ status }: { status: string }) => <span>{status}</span> }));
vi.mock('@/components/candidate/ApplicationActions', () => ({ ApplicationActions: () => <span /> }));

const items: MyApplication[] = Array.from({ length: 15 }, (_, index) => ({
  id: `app-${index + 1}`,
  jobTitle: `Job ${index + 1}`,
  companyName: 'Company',
  slug: `job-${index + 1}`,
  date: '2026-09-20T09:00:00Z',
  status: 'submitted',
  screeningCount: 0,
}));
const cursor = { submittedAt: '2026-09-20T09:00:00+00:00', id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000010' };

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('candidate application list', () => {
  it('shows every row after loading the next page, then a distinct end state', async () => {
    loadMoreApplications.mockResolvedValue({ status: 'ready', page: { items: items.slice(10), nextCursor: null } });
    render(<CandidateApplicationsList locale="pl" initialPage={{ items: items.slice(0, 10), nextCursor: cursor }} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'applicationsMore' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(15));
    expect(loadMoreApplications).toHaveBeenCalledWith('pl', cursor);
    expect(screen.getByText('applicationsEnd')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'applicationsMore' })).not.toBeInTheDocument();
  });

  it('every card links to its application detail, also when the offer has no public page', () => {
    const noSlug = { ...items[0]!, id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', slug: null };
    render(<CandidateApplicationsList locale="pl" initialPage={{ items: [noSlug, items[1]!], nextCursor: null }} />);
    const details = screen.getAllByRole('link', { name: 'candidateApplicationDetailsLinkLabel' });
    expect(details.map((a) => a.getAttribute('href'))).toEqual([
      '/candidate/aplikacje/aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
      '/candidate/aplikacje/app-2',
    ]);
    // Oferta bez publicznego adresu: brak „Zobacz ofertę”, szczegół zgłoszenia zostaje.
    expect(screen.getAllByRole('link', { name: 'actionView' })).toHaveLength(1);
  });

  it('preserves loaded rows on a failed request and allows a retry', async () => {
    loadMoreApplications.mockResolvedValueOnce({ status: 'error' })
      .mockResolvedValueOnce({ status: 'ready', page: { items: [...items.slice(9, 15)], nextCursor: null } });
    render(<CandidateApplicationsList locale="pl" initialPage={{ items: items.slice(0, 10), nextCursor: cursor }} />);
    fireEvent.click(screen.getByRole('button', { name: 'applicationsMore' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    const retry = await screen.findByRole('button', { name: 'candidateListRetry' });
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(15));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(loadMoreApplications).toHaveBeenCalledTimes(2);
  });

  it('ignores an old page that finishes after a server refresh', async () => {
    let finish!: (value: unknown) => void;
    loadMoreApplications.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { rerender } = render(
      <CandidateApplicationsList locale="pl" initialPage={{ items: items.slice(0, 10), nextCursor: cursor }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'applicationsMore' }));
    await waitFor(() => expect(loadMoreApplications).toHaveBeenCalledOnce());
    const refreshed = [{ ...items[0]!, status: 'withdrawn' }, ...items.slice(1, 10)];
    const newPage = { items: refreshed, nextCursor: cursor };
    rerender(<CandidateApplicationsList locale="pl" initialPage={newPage} />);
    finish({ status: 'ready', page: { items: items.slice(10), nextCursor: null } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'applicationsMore' })).toBeVisible());
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getAllByText('withdrawn')).toHaveLength(1);
  });
});
