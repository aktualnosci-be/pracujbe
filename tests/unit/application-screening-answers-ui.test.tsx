import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApplicationScreeningAnswers } from '@/components/candidate/ApplicationScreeningAnswers';
import { CandidateApplicationsList } from '@/components/candidate/CandidateApplicationsList';
import type { MyApplication } from '@/lib/data/candidate';
import type { ScreeningAnswer } from '@/lib/screening/questions';

const { loadApplicationScreeningAnswers } = vi.hoisted(() => ({ loadApplicationScreeningAnswers: vi.fn() }));
vi.mock('@/lib/actions/candidate-applications', () => ({ loadApplicationScreeningAnswers, loadMoreApplications: vi.fn() }));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
}));
vi.mock('@/i18n/navigation', () => ({ Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('@/components/ui/status-pill', () => ({ StatusPill: ({ status }: { status: string }) => <span>{status}</span> }));
vi.mock('@/components/candidate/ApplicationActions', () => ({ ApplicationActions: () => <span /> }));

const answers: ScreeningAnswer[] = [
  { position: 0, type: 'yes_no', required: true, prompt: { pl: 'Prawo jazdy?', en: 'Licence?' }, options: [], answerBoolean: false, answerDate: null, answerText: null },
  { position: 1, type: 'single_choice', required: true, prompt: { pl: 'Zmiana?' }, options: [{ id: 'o1', label: { pl: 'Dzienna', en: 'Day' } }, { id: 'o2', label: { pl: 'Nocna', en: 'Night' } }], answerBoolean: null, answerDate: null, answerText: 'o2' },
  { position: 2, type: 'date', required: false, prompt: { en: 'Start?' }, options: [], answerBoolean: null, answerDate: '2026-10-05', answerText: null },
  { position: 3, type: 'short_text', required: false, prompt: { pl: 'Opis' }, options: [], answerBoolean: null, answerDate: null, answerText: null },
];

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('ApplicationScreeningAnswers', () => {
  it('loads once on first expand, shows the snapshot in the viewer language and keeps it after collapsing', async () => {
    loadApplicationScreeningAnswers.mockResolvedValue({ status: 'ready', answers });
    render(<ApplicationScreeningAnswers applicationId="app-1" count={4} locale="en" />);
    const toggle = screen.getByRole('button', { name: /applicationAnswersToggle/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(loadApplicationScreeningAnswers).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('applicationAnswersLoading');
    const region = await screen.findByRole('region', { name: 'applicationAnswersHeading' });
    await waitFor(() => expect(screen.getAllByRole('term')).toHaveLength(4));
    const terms = screen.getAllByRole('term').map((el) => el.textContent);
    const values = screen.getAllByRole('definition').map((el) => el.textContent);
    // Tłumaczenie w języku widza; brak → język domyślny (pl) → pierwszy dostępny.
    expect(terms).toEqual([
      'Licence? (employerApplicationScreeningRequired)',
      'Zmiana? (employerApplicationScreeningRequired)',
      'Start?',
      'Opis',
    ]);
    expect(values).toEqual(['employerApplicationNo', 'Night', 'October 5, 2026', 'employerApplicationScreeningNoAnswer']);
    expect(region).toHaveAttribute('aria-busy', 'false');
    expect(loadApplicationScreeningAnswers).toHaveBeenCalledWith('app-1');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getAllByRole('term')).toHaveLength(4);
    expect(loadApplicationScreeningAnswers).toHaveBeenCalledTimes(1);
  });

  it('shows an error with retry and never an empty answer list after a failure', async () => {
    loadApplicationScreeningAnswers
      .mockResolvedValueOnce({ status: 'error' })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ status: 'ready', answers: answers.slice(0, 1) });
    render(<ApplicationScreeningAnswers applicationId="app-1" count={1} locale="pl" />);
    fireEvent.click(screen.getByRole('button', { name: /applicationAnswersToggle/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('applicationAnswersError');
    expect(screen.queryByText('applicationAnswersEmpty')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'candidateListRetry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('applicationAnswersError');
    fireEvent.click(screen.getByRole('button', { name: 'candidateListRetry' }));
    await waitFor(() => expect(screen.getAllByRole('term')).toHaveLength(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(loadApplicationScreeningAnswers).toHaveBeenCalledTimes(3);
  });
});

describe('application card', () => {
  const base: Omit<MyApplication, 'id' | 'screeningCount'> = {
    jobTitle: 'Job', companyName: 'Company', slug: 'job', date: '2026-09-20T09:00:00Z', status: 'submitted',
  };

  it('offers the answers only for applications with saved answers', () => {
    render(<CandidateApplicationsList locale="pl" initialPage={{
      items: [{ ...base, id: 'with', screeningCount: 3 }, { ...base, id: 'without', screeningCount: 0 }],
      nextCursor: null,
    }} />);
    const toggles = screen.getAllByRole('button', { name: /applicationAnswersToggle/ });
    expect(toggles).toHaveLength(1);
    expect(toggles[0]).toHaveTextContent('applicationAnswersToggle:{"count":3}');
  });
});
