import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CandidateProposalsList } from '@/components/candidate/CandidateProposalsList';
import type { MyOffer } from '@/lib/data/candidate';

const { loadMoreProposals } = vi.hoisted(() => ({ loadMoreProposals: vi.fn() }));
vi.mock('@/lib/actions/candidate-proposals', () => ({ loadMoreProposals }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/i18n/navigation', () => ({ Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/components/candidate/ProposalStatusPill', () => ({ ProposalStatusPill: ({ status }: { status: string }) => <span>{status}</span> }));
vi.mock('@/components/candidate/ProposalActions', () => ({
  ProposalActions: ({ initialCanRespond }: { initialCanRespond: boolean }) => (initialCanRespond ? <button type="button">respond</button> : null),
}));

const now = '2026-09-23T12:00:00.000Z';
const items: MyOffer[] = Array.from({ length: 21 }, (_, index) => ({
  id: `offer-${index + 1}`,
  jobTitle: `Job ${index + 1}`,
  companyName: 'Company',
  slug: `job-${index + 1}`,
  message: '',
  date: '2026-09-20T09:00:00Z',
  status: index === 20 ? 'sent' : 'declined',
  expiresAt: index === 20 ? '2026-09-22T00:00:00Z' : null,
}));
const cursor = { createdAt: '2026-09-20T09:00:00+00:00', id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000012' };
const cursor2 = { createdAt: '2026-09-20T09:00:00+00:00', id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002' };

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('lista propozycji kandydata (#245)', () => {
  it('dociera do najstarszej propozycji i pokazuje osobny stan końca listy', async () => {
    loadMoreProposals
      .mockResolvedValueOnce({ status: 'ready', page: { items: items.slice(10, 20), nextCursor: cursor2 } })
      .mockResolvedValueOnce({ status: 'ready', page: { items: items.slice(20), nextCursor: null } });
    render(<CandidateProposalsList locale="pl" now={now} initialPage={{ items: items.slice(0, 10), nextCursor: cursor }} />);
    expect(screen.getAllByRole('article')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'proposalsMore' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(20));
    fireEvent.click(await screen.findByRole('button', { name: 'proposalsMore' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(21));
    expect(loadMoreProposals).toHaveBeenNthCalledWith(1, 'pl', cursor);
    expect(loadMoreProposals).toHaveBeenNthCalledWith(2, 'pl', cursor2);
    expect(screen.getByRole('link', { name: 'Job 21' })).toHaveAttribute('href', '/oferty-pracy/job-21');
    // Najstarsza propozycja po terminie: status „wygasła”, bez akcji odpowiedzi.
    expect(screen.getByText('expired')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'respond' })).not.toBeInTheDocument();
    expect(screen.getByText('proposalsEnd')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'proposalsMore' })).not.toBeInTheDocument();
  });

  it('zachowuje wczytane karty po błędzie i pozwala ponowić', async () => {
    loadMoreProposals.mockResolvedValueOnce({ status: 'error' })
      .mockResolvedValueOnce({ status: 'ready', page: { items: items.slice(9, 21), nextCursor: null } });
    render(<CandidateProposalsList locale="pl" now={now} initialPage={{ items: items.slice(0, 10), nextCursor: cursor }} />);
    fireEvent.click(screen.getByRole('button', { name: 'proposalsMore' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('proposalsMoreError'));
    expect(screen.getAllByRole('article')).toHaveLength(10);
    fireEvent.click(await screen.findByRole('button', { name: 'candidateListRetry' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(21));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('pusty stan tylko przy braku propozycji', () => {
    render(<CandidateProposalsList locale="pl" now={now} initialPage={{ items: [], nextCursor: null }} />);
    expect(screen.getByText('proposalsEmptyTitle')).toBeVisible();
    expect(screen.queryByText('proposalsEnd')).not.toBeInTheDocument();
  });
});
