import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CandidateApplicationsPreview } from '@/components/candidate/CandidateApplicationsPreview';
import { CandidateMessagesPreview } from '@/components/candidate/CandidateMessagesPreview';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

const refresh = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a>,
  useRouter: () => ({ refresh }),
}));
vi.mock('@/components/ui/status-pill', () => ({
  StatusPill: ({ status }: { status: string }) => <span>{status}</span>,
}));
vi.mock('@/components/candidate/ApplicationActions', () => ({ ApplicationActions: () => null }));
afterEach(() => {
  cleanup();
  refresh.mockClear();
});

describe.each([['pl', pl], ['nl', nl], ['fr', fr], ['en', en]] as const)('sekcje pulpitu kandydata (%s)', (locale, messages) => {
  const t = messages.dashboard;
  const applicationLabels = {
    title: t.myApplications, seeAll: t.seeAll, empty: t.noApplications,
    loadError: t.candidateApplicationsLoadError, retry: t.candidateListRetry,
  };
  const messageLabels = {
    title: t.latestMessages, empty: t.noMessages, loadError: t.candidateMessagesLoadError,
    retry: t.candidateListRetry, seeAll: t.seeAllMessages,
  };

  it('błąd odczytu zgłoszeń pokazuje komunikat z ponowieniem, nie „brak zgłoszeń”', () => {
    render(<CandidateApplicationsPreview result={{ status: 'error' }} locale={locale} labels={applicationLabels} />);
    expect(screen.getByRole('alert')).toHaveTextContent(applicationLabels.loadError);
    expect(screen.queryByText(applicationLabels.empty)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: applicationLabels.retry }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('pusta lista zgłoszeń po udanym odczycie to stan pusty, bez alertu', () => {
    render(<CandidateApplicationsPreview result={{ status: 'ok', items: [] }} locale={locale} labels={applicationLabels} />);
    expect(screen.getByText(applicationLabels.empty)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('udany odczyt zgłoszeń pokazuje prawdziwe dane', () => {
    render(
      <CandidateApplicationsPreview
        result={{ status: 'ok', items: [{ id: 'a1', jobTitle: 'Magazynier', companyName: 'Firma', slug: 'magazynier', date: '2026-09-20T09:00:00Z', status: 'submitted' }] }}
        locale={locale}
        labels={applicationLabels}
      />,
    );
    expect(screen.getByRole('link', { name: 'Magazynier' })).toHaveAttribute('href', '/oferty-pracy/magazynier');
    expect(screen.queryByText(applicationLabels.empty)).not.toBeInTheDocument();
  });

  it('błąd odczytu wiadomości pokazuje komunikat z ponowieniem, nie „brak wiadomości”', () => {
    render(<CandidateMessagesPreview result={{ status: 'error' }} locale={locale} labels={messageLabels} />);
    expect(screen.getByRole('alert')).toHaveTextContent(messageLabels.loadError);
    expect(screen.queryByText(messageLabels.empty)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: messageLabels.retry }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: messageLabels.seeAll })).toHaveAttribute('href', '/candidate/wiadomosci');
  });

  it('pusta lista wiadomości po udanym odczycie to stan pusty, bez alertu', () => {
    render(<CandidateMessagesPreview result={{ status: 'ok', items: [] }} locale={locale} labels={messageLabels} />);
    expect(screen.getByText(messageLabels.empty)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
