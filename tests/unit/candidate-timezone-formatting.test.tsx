import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatMessageTime } from '@/lib/messaging/thread-view';
import type { ConversationListItem } from '@/lib/data/messages';
import type { LatestMessage, MyApplication, MyOffer } from '@/lib/data/candidate';

/**
 * #865: formatery dat/godzin w panelu kandydata i listach rozmów muszą liczyć dzień/godzinę
 * w strefie produktu `Europe/Brussels` (`APP_TIME_ZONE`), nie w strefie procesu serwera (UTC
 * na Railway). Bez `timeZone` w `Intl.DateTimeFormat`, chwila blisko północy w Brukseli
 * (CEST, latem UTC+2) pokazuje dzień wcześniejszy niż faktyczny, a klienckie listy dodatkowo
 * rozjeżdżają się między SSR (proces w UTC) i hydratacją w przeglądarce (strefa lokalna).
 *
 * `2026-09-26T22:30:00Z` to `2026-09-27T00:30` czasu brukselskiego — dzień PO stronie UTC
 * kończy się wcześniej niż w Brukseli, więc poprawny wynik to `27.09`, nie `26.09`.
 */
const MIDNIGHT_BOUNDARY_ISO = '2026-09-26T22:30:00Z';
const EXPECTED_BRUSSELS_DAY_MONTH = '27.09';

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('thread-view: formatMessageTime liczy godzinę w Europe/Brussels', () => {
  it('chwila blisko północy UTC pokazuje dzień brukselski, nie dzień UTC', () => {
    // 22:30 UTC = 00:30 w Brukseli (CEST): dzień 27, nie 26.
    expect(formatMessageTime(MIDNIGHT_BOUNDARY_ISO, 'pl')).toBe('27.09, 00:30');
  });

  it('kontrola ujemna: bez strefy wynik pokazywałby dzień UTC (regresja #865)', () => {
    // Ta sama chwila sformatowana BEZ `timeZone` — dokładnie zachowanie sprzed naprawy.
    const withoutTimeZone = new Intl.DateTimeFormat('pl', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(Date.parse(MIDNIGHT_BOUNDARY_ISO));
    expect(withoutTimeZone).not.toBe(formatMessageTime(MIDNIGHT_BOUNDARY_ISO, 'pl'));
  });
});

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe('CandidateMessagesPreview: data ostatniej wiadomości w Europe/Brussels', () => {
  it('pokazuje dzień brukselski dla chwili blisko północy UTC', async () => {
    const { CandidateMessagesPreview } = await import('@/components/candidate/CandidateMessagesPreview');
    const items: LatestMessage[] = [
      { id: 'm1', title: 'Firma A', preview: 'Cześć', time: MIDNIGHT_BOUNDARY_ISO, unread: false },
    ];
    render(
      <CandidateMessagesPreview
        result={{ status: 'ok', items }}
        locale="pl"
        labels={{ title: 't', empty: 'e', loadError: 'le', retry: 'r', seeAll: 'sa', unread: 'u' }}
      />,
    );
    expect(screen.getByText(EXPECTED_BRUSSELS_DAY_MONTH)).toBeVisible();
  });
});

describe('ConversationList: czas ostatniej wiadomości w Europe/Brussels', () => {
  it('pokazuje dzień brukselski dla chwili blisko północy UTC', async () => {
    vi.doMock('next-intl/server', () => ({
      getTranslations: () => (key: string) => key,
    }));
    vi.doMock('@/components/messaging/ConversationOpenPending', () => ({
      ConversationOpenPending: () => null,
    }));
    const { ConversationList } = await import('@/components/messaging/ConversationList');
    const items: ConversationListItem[] = [
      {
        id: 'c1',
        subject: 'Oferta',
        counterpartyName: 'Firma A',
        lastPreview: 'Cześć',
        lastMessageAt: MIDNIGHT_BOUNDARY_ISO,
        unread: false,
        unreadCount: 0,
      },
    ];
    render(await ConversationList({ items, basePath: '/candidate/wiadomosci', locale: 'pl' }));
    expect(screen.getByText(EXPECTED_BRUSSELS_DAY_MONTH)).toBeVisible();
  });
});

describe('CandidateApplicationsPreview: data zgłoszenia w Europe/Brussels', () => {
  it('pokazuje dzień brukselski dla chwili blisko północy UTC', async () => {
    vi.doMock('@/components/ui/status-pill', () => ({ StatusPill: ({ status }: { status: string }) => <span>{status}</span> }));
    vi.doMock('@/components/candidate/ApplicationActions', () => ({ ApplicationActions: () => null }));
    const { CandidateApplicationsPreview } = await import('@/components/candidate/CandidateApplicationsPreview');
    const items: MyApplication[] = [
      {
        id: 'a1',
        jobTitle: 'Magazynier',
        companyName: 'Firma A',
        slug: 'magazynier',
        date: MIDNIGHT_BOUNDARY_ISO,
        status: 'submitted',
        screeningCount: 0,
      },
    ];
    render(
      <CandidateApplicationsPreview
        result={{ status: 'ok', items }}
        locale="pl"
        labels={{ title: 't', seeAll: 'sa', empty: 'e', loadError: 'le', retry: 'r' }}
      />,
    );
    expect(screen.getByText(new RegExp(EXPECTED_BRUSSELS_DAY_MONTH.replace('.', '\\.')))).toBeVisible();
  });
});

describe('CandidateApplicationsList: „Wysłano …” w Europe/Brussels', () => {
  it('pokazuje dzień brukselski dla chwili blisko północy UTC', async () => {
    vi.doMock('next-intl', () => ({
      useTranslations: () => (key: string, values?: Record<string, string>) =>
        values ? `${key}:${values.date}` : key,
    }));
    vi.doMock('@/lib/actions/candidate-applications', () => ({ loadMoreApplications: vi.fn() }));
    vi.doMock('@/components/ui/status-pill', () => ({ StatusPill: ({ status }: { status: string }) => <span>{status}</span> }));
    vi.doMock('@/components/candidate/ApplicationActions', () => ({ ApplicationActions: () => <span /> }));
    vi.doMock('@/components/candidate/ApplicationScreeningAnswers', () => ({ ApplicationScreeningAnswers: () => null }));
    const { CandidateApplicationsList } = await import('@/components/candidate/CandidateApplicationsList');
    const items: MyApplication[] = [
      {
        id: 'a1',
        jobTitle: 'Magazynier',
        companyName: 'Firma A',
        slug: 'magazynier',
        date: MIDNIGHT_BOUNDARY_ISO,
        status: 'submitted',
        screeningCount: 0,
      },
    ];
    render(<CandidateApplicationsList locale="pl" initialPage={{ items, nextCursor: null }} />);
    expect(screen.getByText(`applicationSentOn:${EXPECTED_BRUSSELS_DAY_MONTH}.2026`)).toBeVisible();
  });
});

describe('CandidateProposalsList: „Wysłano …” w Europe/Brussels', () => {
  it('pokazuje dzień brukselski dla chwili blisko północy UTC', async () => {
    vi.doMock('next-intl', () => ({
      useTranslations: () => (key: string, values?: Record<string, string>) =>
        values ? `${key}:${values.date}` : key,
    }));
    vi.doMock('@/lib/actions/candidate-proposals', () => ({ loadMoreProposals: vi.fn() }));
    vi.doMock('@/components/candidate/ProposalStatusPill', () => ({ ProposalStatusPill: () => <span /> }));
    vi.doMock('@/components/candidate/ProposalActions', () => ({ ProposalActions: () => null }));
    const { CandidateProposalsList } = await import('@/components/candidate/CandidateProposalsList');
    const items: MyOffer[] = [
      {
        id: 'o1',
        jobTitle: 'Magazynier',
        companyName: 'Firma A',
        slug: 'magazynier',
        message: '',
        date: MIDNIGHT_BOUNDARY_ISO,
        status: 'sent',
        expiresAt: null,
      },
    ];
    render(
      <CandidateProposalsList locale="pl" initialPage={{ items, nextCursor: null }} now={MIDNIGHT_BOUNDARY_ISO} />,
    );
    expect(screen.getByText(`proposalSentOn:${EXPECTED_BRUSSELS_DAY_MONTH}.2026`)).toBeVisible();
  });
});
