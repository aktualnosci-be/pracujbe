import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FollowCompanyButton } from '@/components/candidate/FollowCompanyButton';
import { SavedJobsCompareForm } from '@/components/candidate/SavedJobsCompareForm';
import { SavedJobsComparison } from '@/components/candidate/SavedJobsComparison';
import { SavedSearchesPause } from '@/components/candidate/SavedSearchesPause';
import { SavedSearchList } from '@/components/candidate/SavedSearchList';
import {
  followCompanyAction,
  getCompanyFollowState,
  setAlertsPauseAction,
  unfollowCompanyAction,
} from '@/lib/actions/saved-searches';
import type { CompareModel } from '@/lib/saved-job-compare';
import pl from '@/messages/pl.json';

/**
 * #810 / #855 / #816 — komponenty: pauza alertów (formularz i wznowienie), przycisk „Obserwuj firmę”
 * (gość, kandydat, błąd), lista z obserwowaną firmą, formularz wyboru do porównania (limit 3)
 * i tabela porównania (nagłówki, brak danych, oferta niedostępna).
 */

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh }),
  Link: ({ href, locale: _l, scroll: _s, children, ...rest }: { href: unknown; locale?: string; scroll?: boolean; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : JSON.stringify(href)} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/actions/saved-searches', () => ({
  setAlertsPauseAction: vi.fn(),
  getCompanyFollowState: vi.fn(),
  followCompanyAction: vi.fn(),
  unfollowCompanyAction: vi.fn(),
  renameSavedSearchAction: vi.fn(),
  setSavedSearchAlertsAction: vi.fn(),
  deleteSavedSearchAction: vi.fn(),
}));

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="pl" messages={pl}>{node}</NextIntlClientProvider>
);
const COMPANY = '22222222-2222-4222-8222-222222222222';
const cp = pl.companyProfile;
const followLabels = {
  follow: cp.follow, following: cp.following, followed: cp.followed, unfollowed: cp.unfollowed,
  login: cp.followLogin, stateError: cp.followStateError, networkError: cp.followNetworkError,
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('pauza alertów (#810)', () => {
  const props = { pausedUntil: null, pausedUntilLabel: null, minDate: '2026-09-30', maxDate: '2027-09-30' };

  it('formularz: data w granicach, przycisk od wyboru daty, zapis przez akcję i komunikat', async () => {
    vi.mocked(setAlertsPauseAction).mockResolvedValue({ ok: true });
    render(wrap(<SavedSearchesPause {...props} />));
    const input = screen.getByLabelText(pl.savedSearches.pauseDateLabel) as HTMLInputElement;
    expect(input).toMatchObject({ min: '2026-09-30', max: '2027-09-30', required: true });
    const submit = screen.getByRole('button', { name: pl.savedSearches.pauseSubmit });
    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: '2026-10-20' } });
    fireEvent.click(submit);
    await waitFor(() => expect(setAlertsPauseAction).toHaveBeenCalledWith('2026-10-20'));
    expect(await screen.findByText(pl.savedSearches.pauseSet)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it('trwająca pauza: data i „Wznów teraz” (akcja z null); błąd w alert', async () => {
    vi.mocked(setAlertsPauseAction).mockResolvedValueOnce({ ok: false, error: 'INTERNAL' });
    render(wrap(<SavedSearchesPause {...props} pausedUntil="2026-10-20T22:00:00Z" pausedUntilLabel="21 paź 2026" />));
    expect(screen.getByText(/21 paź 2026/)).toBeInTheDocument();
    expect(screen.queryByLabelText(pl.savedSearches.pauseDateLabel)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: pl.savedSearches.pauseResume }));
    await waitFor(() => expect(setAlertsPauseAction).toHaveBeenCalledWith(null));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('kontrola ujemna: nieznany stan pauzy nie pokazuje formularza jak przy braku pauzy', () => {
    render(wrap(<SavedSearchesPause {...props} loadError />));
    expect(screen.getByRole('alert')).toHaveTextContent(pl.savedSearches.pauseLoadError);
    expect(screen.queryByLabelText(pl.savedSearches.pauseDateLabel)).toBeNull();
  });
});

describe('„Obserwuj firmę” (#855)', () => {
  it('gość: link logowania z powrotem na profil; pracodawca/demo: nic', async () => {
    vi.mocked(getCompanyFollowState).mockResolvedValue({ status: 'anonymous' });
    const { unmount } = render(wrap(<FollowCompanyButton companyId={COMPANY} companySlug="firma" labels={followLabels} />));
    const link = await screen.findByRole('link', { name: pl.companyProfile.followLogin });
    expect(link.getAttribute('href')).toContain('/pl/pracodawcy/firma');
    unmount();
    vi.mocked(getCompanyFollowState).mockResolvedValue({ status: 'unavailable' });
    const { container } = render(wrap(<FollowCompanyButton companyId={COMPANY} companySlug="firma" labels={followLabels} />));
    await waitFor(() => expect(getCompanyFollowState).toHaveBeenCalledTimes(2));
    expect(container).toBeEmptyDOMElement();
  });

  it('kandydat: obserwuj → aria-pressed i komunikat; ponowne kliknięcie odobserwowuje', async () => {
    vi.mocked(getCompanyFollowState).mockResolvedValue({ status: 'candidate', following: false });
    vi.mocked(followCompanyAction).mockResolvedValue({ ok: true });
    vi.mocked(unfollowCompanyAction).mockResolvedValue({ ok: true });
    render(wrap(<FollowCompanyButton companyId={COMPANY} companySlug="firma" labels={followLabels} />));
    const button = await screen.findByRole('button', { name: pl.companyProfile.follow });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    await waitFor(() => expect(followCompanyAction).toHaveBeenCalledWith(COMPANY, 'pl'));
    const following = await screen.findByRole('button', { name: pl.companyProfile.following });
    expect(following).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(pl.companyProfile.followed)).toBeInTheDocument();
    fireEvent.click(following);
    await waitFor(() => expect(unfollowCompanyAction).toHaveBeenCalledWith(COMPANY));
    expect(await screen.findByRole('button', { name: pl.companyProfile.follow })).toHaveAttribute('aria-pressed', 'false');
  });

  it('błąd zmiany: stan przycisku bez zmian i komunikat w alert', async () => {
    vi.mocked(getCompanyFollowState).mockResolvedValue({ status: 'candidate', following: false });
    vi.mocked(followCompanyAction).mockResolvedValue({ ok: false, error: 'SAVED_SEARCH_LIMIT_REACHED' });
    render(wrap(<FollowCompanyButton companyId={COMPANY} companySlug="firma" labels={followLabels} />));
    fireEvent.click(await screen.findByRole('button', { name: pl.companyProfile.follow }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: pl.companyProfile.follow })).toHaveAttribute('aria-pressed', 'false');
  });

  it('lista wyszukiwań: obserwowana firma ma link do profilu zamiast listy ofert', () => {
    const base = {
      id: 's1', name: 'Firma Jeden', query: '', locale: 'pl' as const, frequency: 'daily' as const, alertsEnabled: true,
      lastAlertAt: null, createdAt: '2026-09-24T10:00:00Z', lastAlertLabel: null,
    };
    render(wrap(
      <SavedSearchList
        currentLocale="pl"
        searches={[{ ...base, company: { slug: 'firma-jeden' } }, { ...base, id: 's2', name: 'Firma Dwa', company: { slug: null } }]}
      />,
    ));
    expect(screen.getAllByText(pl.savedSearches.followedCompany)).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Pokaż stronę firmy/ }).getAttribute('href')).toBe('/pracodawcy/firma-jeden');
    expect(screen.getByText(pl.savedSearches.companyUnavailable)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: new RegExp(`^${pl.savedSearches.open}`) })).toBeNull();
  });
});

describe('porównanie zapisanych ofert (#816)', () => {
  it('formularz: przycisk od dwóch zaznaczeń, po trzecim pozostałe pola nieaktywne', () => {
    render(wrap(
      <SavedJobsCompareForm>
        {['a', 'b', 'c', 'd'].map((id) => (
          <label key={id}><input type="checkbox" name="porownaj" value={id} />oferta {id}</label>
        ))}
      </SavedJobsCompareForm>,
    ));
    const submit = screen.getByRole('button', { name: pl.dashboard.compareSubmit });
    const box = (id: string) => screen.getByLabelText(`oferta ${id}`) as HTMLInputElement;
    expect(submit).toBeDisabled();
    fireEvent.click(box('a'));
    expect(submit).toBeDisabled();
    fireEvent.click(box('b'));
    expect(submit).toBeEnabled();
    fireEvent.click(box('c'));
    expect(box('d')).toBeDisabled();
    expect(screen.getByText(pl.dashboard.compareLimit)).toBeInTheDocument();
    fireEvent.click(box('c'));
    expect(box('d')).toBeEnabled();
  });

  const model: CompareModel = {
    columns: [
      { id: 'a', title: 'Magazynier', companyName: 'Firma A', city: 'Gent', slug: 'magazynier', state: 'available' },
      { id: 'b', title: 'Kierowca', companyName: 'Firma B', city: 'Liège', slug: null, state: 'expired' },
    ],
    rows: [
      { key: 'salary', cells: [{ kind: 'text', lines: ['15–18 € za godzinę'] }, { kind: 'unavailable' }] },
      { key: 'contract', cells: [{ kind: 'none' }, { kind: 'unavailable' }] },
      { key: 'hours', cells: [{ kind: 'none' }, { kind: 'unavailable' }] },
      { key: 'shifts', cells: [{ kind: 'none' }, { kind: 'unavailable' }] },
      { key: 'accommodation', cells: [{ kind: 'text', lines: ['Zapewnione', 'bez kosztów'] }, { kind: 'unavailable' }] },
      { key: 'transport', cells: [{ kind: 'none' }, { kind: 'unavailable' }] },
      { key: 'requirements', cells: [{ kind: 'list', items: ['VCA', 'Prawo jazdy B'] }, { kind: 'unavailable' }] },
    ],
  };
  const labels = {
    title: 'Porównanie', caption: 'Opis tabeli', offerColumn: 'Warunek', noData: 'Brak danych',
    unavailableCell: 'Oferta niedostępna', viewOffer: 'zobacz ofertę', close: 'Zamknij', detailsError: 'Błąd szczegółów',
    rows: {
      salary: 'Wynagrodzenie', contract: 'Rodzaj umowy', hours: 'Godziny', shifts: 'Zmiany',
      accommodation: 'Zakwaterowanie', transport: 'Transport', requirements: 'Wymagania',
    },
    state: () => 'Oferta wygasła',
  } as const;

  it('tabela z nagłówkami kolumn i wierszy, jawny brak danych i stan oferty niedostępnej', () => {
    render(<SavedJobsComparison model={model} labels={labels} closeHref="/candidate/zapisane" headingId="h" />);
    expect(screen.getByRole('region', { name: 'Opis tabeli' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Magazynier/ })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Wynagrodzenie' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Magazynier/ }).getAttribute('href')).toBe('/oferty-pracy/magazynier');
    // Oferta bez strony: tytuł bez linku i stan.
    expect(screen.queryByRole('link', { name: /Kierowca/ })).toBeNull();
    expect(screen.getByText('Oferta wygasła')).toBeInTheDocument();
    expect(screen.getAllByText('Brak danych').length).toBe(4);
    expect(screen.getAllByText('Oferta niedostępna').length).toBe(7);
    expect(screen.getByText('bez kosztów')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zamknij' }).getAttribute('href')).toBe('/candidate/zapisane');
  });
});
