import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobSearchAssist } from '@/components/public/JobSearchAssist';
import { suggestJobSearchFilters } from '@/lib/actions/job-search-assist';
import { proposalHref, selectedProposalParams, withoutFilterItem, type JobSearchProposal } from '@/lib/ai-search/proposal';
import pl from '@/messages/pl.json';

/**
 * #711 — formularz wyszukiwania opisem: propozycja NIE zmienia listy (brak nawigacji) do
 * kliknięcia „Zastosuj filtry”; odznaczone filtry i wybór miejscowości trafiają do adresu;
 * błąd dostawcy pokazuje komunikat z drogą do zwykłego wyszukiwania i zostawia tekst.
 */

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/actions/job-search-assist', () => ({ suggestJobSearchFilters: vi.fn() }));

const PROPOSAL: JobSearchProposal = {
  schemaVersion: 'job-search-filters-v1',
  model: 'fixture',
  params: { category: 'warehouse,logistics', location: 'Gandawa', immediate: '1', salaryMin: '2500', salaryMax: '4500' },
  items: [
    { id: 'cat-warehouse', label: 'Magazyn', removeKey: 'category', removeValue: 'warehouse' },
    { id: 'cat-logistics', label: 'Logistyka', removeKey: 'category', removeValue: 'logistics' },
    { id: 'loc-Gandawa', label: 'Gandawa', removeKey: 'location', removeValue: 'Gandawa' },
    { id: 'salary', label: 'od 2500', removeKey: 'salary' },
    { id: 'immediate', label: 'Od zaraz', removeKey: 'immediate' },
  ],
  places: ['Puurs'],
  uncertain: ['blisko szkoły'],
  droppedCount: 2,
};

function renderForm() {
  return render(
    <NextIntlClientProvider locale="pl" messages={pl}>
      <JobSearchAssist locale="pl" />
    </NextIntlClientProvider>,
  );
}

const a = pl.jobSearchAssist;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('selectedProposalParams', () => {
  it('bez decyzji = parametry propozycji; odznaczenie usuwa tylko tę wartość', () => {
    expect(selectedProposalParams(PROPOSAL, new Set(), null)).toEqual(PROPOSAL.params);
    expect(selectedProposalParams(PROPOSAL, new Set(['cat-logistics', 'salary']), null)).toEqual({
      category: 'warehouse',
      location: 'Gandawa',
      immediate: '1',
    });
  });

  it('miejscowość tylko z listy propozycji (kontrola ujemna: obca wartość ignorowana)', () => {
    expect(selectedProposalParams(PROPOSAL, new Set(), 'Puurs')['city']).toBe('Puurs');
    expect(selectedProposalParams(PROPOSAL, new Set(), 'Paryż')['city']).toBeUndefined();
  });

  it('lokalizacja z przecinkiem (#845) usuwana pojedynczo', () => {
    const params = { location: 'Bruxelles\\, Belgique,Gent' };
    expect(withoutFilterItem(params, { removeKey: 'location', removeValue: 'Gent' })).toEqual({ location: 'Bruxelles\\, Belgique' });
    expect(proposalHref({})).toBe('/oferty-pracy');
  });
});

describe('JobSearchAssist', () => {
  it('propozycja nie zmienia listy przed „Zastosuj filtry”; potem adres z decyzjami użytkownika', async () => {
    vi.mocked(suggestJobSearchFilters).mockResolvedValue({ ok: true, proposal: PROPOSAL });
    renderForm();
    expect(screen.getByText(a.aiNotice)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(a.textLabel), { target: { value: 'magazyn Gandawa od zaraz' } });
    fireEvent.change(screen.getByLabelText(a.inputLocaleLabel), { target: { value: 'nl' } });
    fireEvent.click(screen.getByRole('button', { name: a.suggest }));
    await waitFor(() => expect(screen.getByRole('heading', { name: a.resultTitle })).toBeTruthy());
    expect(suggestJobSearchFilters).toHaveBeenCalledWith({ text: 'magazyn Gandawa od zaraz', inputLocale: 'nl', locale: 'pl' });
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: a.resultTitle }));
    // Kontrola ujemna: sama propozycja niczego nie stosuje.
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText('blisko szkoły')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Logistyka' }));
    fireEvent.click(screen.getByRole('radio', { name: a.placeOption.replace('{place}', 'Puurs') }));
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: a.apply }));
    expect(push).toHaveBeenCalledTimes(1);
    const url = new URL(`https://x${push.mock.calls[0]![0] as string}`);
    expect(url.pathname).toBe('/oferty-pracy');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      category: 'warehouse',
      location: 'Gandawa',
      immediate: '1',
      salaryMin: '2500',
      salaryMax: '4500',
      city: 'Puurs',
    });
  });

  it('odznaczenie wszystkiego blokuje „Zastosuj filtry”', async () => {
    vi.mocked(suggestJobSearchFilters).mockResolvedValue({
      ok: true,
      proposal: { ...PROPOSAL, params: { immediate: '1' }, items: [PROPOSAL.items[4]!], places: [] },
    });
    renderForm();
    fireEvent.change(screen.getByLabelText(a.textLabel), { target: { value: 'od zaraz' } });
    fireEvent.click(screen.getByRole('button', { name: a.suggest }));
    await waitFor(() => screen.getByRole('checkbox', { name: 'Od zaraz' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Od zaraz' }));
    expect(screen.getByText(a.nothingSelected)).toBeTruthy();
    expect((screen.getByRole('button', { name: a.apply }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: a.apply }));
    expect(push).not.toHaveBeenCalled();
  });

  it('błąd dostawcy: komunikat + droga do zwykłego wyszukiwania, tekst zostaje, bez nawigacji', async () => {
    vi.mocked(suggestJobSearchFilters).mockResolvedValue({ ok: false, error: 'JOB_SEARCH_ASSIST_FAILED' });
    renderForm();
    fireEvent.change(screen.getByLabelText(a.textLabel), { target: { value: 'magazyn' } });
    fireEvent.click(screen.getByRole('button', { name: a.suggest }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(pl.errors.jobSearchAssistFailed);
    expect(alert.textContent).toContain(a.fallback);
    expect((screen.getByLabelText(a.textLabel) as HTMLTextAreaElement).value).toBe('magazyn');
    expect(push).not.toHaveBeenCalled();
  });

  it('za krótki opis: przycisk zablokowany, akcja niewołana', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(a.textLabel), { target: { value: 'a' } });
    expect((screen.getByRole('button', { name: a.suggest }) as HTMLButtonElement).disabled).toBe(true);
    expect(suggestJobSearchFilters).not.toHaveBeenCalled();
  });
});
