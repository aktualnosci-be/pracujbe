import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import pl from '@/messages/pl.json';
import { NotificationsDropdown } from '@/components/dashboard/NotificationsDropdown';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { resolveHref } from '@/lib/data/notifications';
// Alias: nazwa `use*` myli regułę react-hooks/rules-of-hooks (to nie hook Reacta, tylko beforeEach/afterEach).
import { useRecruitmentMode as recruitmentModeInTests } from '../helpers/portal-mode';

// Istniejące przepływy rekrutacyjne testowane w trybie RECRUITMENT (#1128, tryb ogłoszeniowy = domyślny).
recruitmentModeInTests();

const { markNotificationsRead, refresh } = vi.hoisted(() => ({
  markNotificationsRead: vi.fn(),
  refresh: vi.fn(),
}));

// Prawdziwy formater ICU (nazwa dzwonka ma liczbę nieprzeczytanych z odmianą, #353).
vi.mock('next-intl', async () => {
  const actual = await vi.importActual<typeof import('next-intl')>('next-intl');
  return {
    useTranslations: (ns?: string) =>
      actual.createTranslator({ locale: 'pl', messages: pl, namespace: ns as never }),
  };
});
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
    className?: string;
  }) => (
    // Lokalizowany Link: prefiks locale dokłada nawigacja next-intl.
    <a href={`/pl${href}`} onClick={(e) => { e.preventDefault(); onClick?.(); }} className={className}>
      {children}
    </a>
  ),
  usePathname: () => '/candidate',
}));
vi.mock('@/lib/actions/notifications', () => ({ markNotificationsRead }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const CONVERSATION = '2f1c1b8e-8c1a-4a4c-9d7e-3a1f0c2b9e11';

describe('resolveHref — cel powiadomienia wyznaczany serwerowo (#148)', () => {
  it.each([
    ['application', 'candidate', '/candidate/aplikacje'],
    ['application', 'employer', '/employer/aplikacje'],
    ['offer', 'candidate', '/candidate/propozycje'],
    ['offer', 'employer', '/employer/aplikacje'],
    ['job', 'candidate', '/candidate/oferty-polecane'],
    ['job', 'employer', '/employer/oferty'],
    // #843: decyzja o firmie (weryfikacja/odrzucenie/zawieszenie) niesie identyfikator firmy,
    // której dotyczy — inaczej właściciel kilku firm z inną AKTYWNĄ firmą w cookie widziałby
    // jej dane zamiast tej z decyzji (strona `/employer/firma` czyta `?firma=`, patrz #843).
    ['company', 'employer', `/employer/firma?firma=${CONVERSATION}`],
    // Kandydat nie ma panelu firmy — bez identyfikatora w URL (nie ma gdzie go użyć).
    ['company', 'candidate', '/candidate'],
    ['conversation', 'candidate', `/candidate/wiadomosci?c=${CONVERSATION}`],
    ['conversation', 'employer', `/employer/wiadomosci?c=${CONVERSATION}`],
    ['unknown', 'candidate', '/candidate'],
    ['unknown', 'employer', '/employer'],
  ])('%s dla %s → %s', (entityType, role, href) => {
    expect(resolveHref(entityType, role, CONVERSATION)).toBe(href);
  });

  it.each(['', 'not-a-uuid', `${CONVERSATION}&x=1`, '../../admin'])(
    'nie wkleja niezweryfikowanego id do URL: %j',
    (entityId) => {
      expect(resolveHref('conversation', 'candidate', entityId)).toBe('/candidate/wiadomosci');
      // #843: to samo dla firmy — zła/brakująca wartość nie trafia do zapytania.
      expect(resolveHref('company', 'employer', entityId)).toBe('/employer/firma');
    },
  );

  // KONTROLA UJEMNA (#843): bez poprawki `resolveHref('company', 'employer', id)` zawsze
  // zwracało `/employer/firma` bez identyfikatora — ten test byłby czerwony.
  it('KONTROLA UJEMNA: link firmy niesie identyfikator, nie jest stałym adresem', () => {
    expect(resolveHref('company', 'employer', CONVERSATION)).not.toBe('/employer/firma');
  });
});

const items = [
  { id: 'n-app', title: 'Zmiana statusu', meta: '1 h', unread: true, href: '/candidate/aplikacje' },
  { id: 'n-msg', title: 'Nowa wiadomość', meta: '2 h', unread: false, href: `/candidate/wiadomosci?c=${CONVERSATION}` },
  { id: 'n-offer', title: 'Nowa propozycja', meta: '3 h', unread: true, href: '/candidate/propozycje' },
];

describe('NotificationsDropdown — pozycje jako linki (#148)', () => {
  it('renderuje każdą pozycję jako lokalizowany link do obiektu', () => {
    render(<NotificationsDropdown items={items} />);
    expect(screen.getByRole('link', { name: /Zmiana statusu/ })).toHaveAttribute('href', '/pl/candidate/aplikacje');
    expect(screen.getByRole('link', { name: /Nowa wiadomość/ })).toHaveAttribute(
      'href',
      `/pl/candidate/wiadomosci?c=${CONVERSATION}`,
    );
    expect(screen.getByRole('link', { name: /Nowa propozycja/ })).toHaveAttribute('href', '/pl/candidate/propozycje');
  });

  it('link jest osiągalny klawiaturą i zgłasza otwarcie tej jednej pozycji', () => {
    const onItemOpen = vi.fn();
    render(<NotificationsDropdown items={items} onItemOpen={onItemOpen} />);
    const link = screen.getByRole('link', { name: /Nowa propozycja/ });
    link.focus();
    expect(link).toHaveFocus();
    fireEvent.click(link); // Enter na <a> = natywny klik
    expect(onItemOpen).toHaveBeenCalledExactlyOnceWith(items[2]);
  });

  it('bez celu pozycja nie udaje linku; bez dedykowanej listy brak „Zobacz wszystkie”', () => {
    render(<NotificationsDropdown items={[{ title: 'Demo', meta: '1 h' }]} />);
    expect(screen.queryByRole('link', { name: /Demo/ })).not.toBeInTheDocument();
    expect(screen.queryByText(pl.notifications.seeAll)).not.toBeInTheDocument();
  });
});

describe('DashboardShell — otwarcie powiadomienia (#148)', () => {
  const nav = [
    { href: '/candidate', label: 'Pulpit', icon: null },
    { href: '/candidate/wiadomosci', label: 'Wiadomości', icon: null },
  ];

  function renderShell() {
    render(
      <DashboardShell
        nav={nav as never}
        active="/candidate"
        user={{ name: 'Anna', initials: 'A' }}
        notifications={2}
        notifItems={items}
      >
        <p>treść</p>
      </DashboardShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Powiadomienia, 2 nieprzeczytane' }));
  }

  it('oznacza wyłącznie otwarte powiadomienie i odświeża licznik', async () => {
    markNotificationsRead.mockResolvedValue({ ok: true, count: 1 });
    renderShell();
    fireEvent.click(screen.getByRole('link', { name: /Nowa propozycja/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(markNotificationsRead).toHaveBeenCalledExactlyOnceWith(['n-offer']);
  });

  it('nie zapisuje ponownie już przeczytanej pozycji, a „Zobacz wszystkie” nie prowadzi do wiadomości', () => {
    renderShell();
    expect(screen.queryByRole('link', { name: pl.notifications.seeAll })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /Nowa wiadomość/ }));
    expect(markNotificationsRead).not.toHaveBeenCalled();
  });

  it('błąd zapisu nie odświeża ani nie zmienia celu', async () => {
    markNotificationsRead.mockResolvedValue({ ok: false, error: 'INTERNAL' });
    renderShell();
    const link = screen.getByRole('link', { name: /Zmiana statusu/ });
    expect(link).toHaveAttribute('href', '/pl/candidate/aplikacje');
    fireEvent.click(link);
    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledWith(['n-app']));
    expect(refresh).not.toHaveBeenCalled();
  });
});
