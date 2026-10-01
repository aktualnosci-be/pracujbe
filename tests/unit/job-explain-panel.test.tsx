import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobExplainPanel } from '@/components/public/JobExplainPanel';
import { explainJobOffer, type JobExplainResult } from '@/lib/actions/job-explain';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * #773 — panel „Wyjaśnij ofertę”: informacja o AI i zastrzeżenie przed użyciem, wybór języka,
 * blokada podczas zapytania i stan ładowania, błąd `role="alert"` z ponowieniem, wynik ze
 * źródłem każdego objaśnienia (w oryginale, z `lang`), luki i liczba pominiętych, fokus na wyniku.
 */

vi.mock('@/lib/actions/job-explain', () => ({ explainJobOffer: vi.fn() }));

const OK: JobExplainResult = {
  ok: true,
  targetLocale: 'nl',
  dropped: 1,
  items: [
    {
      topic: 'pay',
      explanation: 'De werkgever betaalt van 2000 tot 2500 EUR per maand.',
      sources: [{ id: 'S2', field: 'salary', text: '2 000–2 500 EUR / mies.', lang: 'pl' }],
    },
  ],
  gaps: [{ topic: 'accommodation', kind: 'missing', note: 'De vacature zegt niets over huisvesting.', sources: [] }],
};

function renderPanel(messages: typeof pl = pl, locale: 'pl' | 'nl' | 'fr' | 'en' = 'pl') {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Brussels">
      <JobExplainPanel slug="orderpicker" locale={locale} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.mocked(explainJobOffer).mockReset());
afterEach(cleanup);

describe('JobExplainPanel (#773)', () => {
  it.each([
    ['pl', pl],
    ['nl', nl],
    ['fr', fr],
    ['en', en],
  ] as const)('%s: informacja o AI powiązana z przyciskiem, domyślny język = język strony', (locale, messages) => {
    renderPanel(messages as typeof pl, locale);
    const button = screen.getByRole('button', { name: messages.jobExplain.button });
    const describedBy = button.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)?.textContent).toBe(messages.jobExplain.intro);
    expect((screen.getByRole('combobox', { name: messages.jobExplain.languageLabel }) as HTMLSelectElement).value).toBe(locale);
    expect(screen.getByRole('region', { name: messages.jobExplain.title })).toBeTruthy();
  });

  it('wysyła slug, język strony i wybrany język; w trakcie przycisk zablokowany i stan ładowania', async () => {
    let resolve!: (r: JobExplainResult) => void;
    vi.mocked(explainJobOffer).mockReturnValue(new Promise((r) => (resolve = r)));
    renderPanel();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nl' } });
    fireEvent.click(screen.getByRole('button', { name: pl.jobExplain.button }));
    expect(explainJobOffer).toHaveBeenCalledWith({ slug: 'orderpicker', locale: 'pl', targetLocale: 'nl' });
    const busy = screen.getByRole('button', { name: pl.jobExplain.loading });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe(pl.jobExplain.loading);
    // Drugie kliknięcie w trakcie nie wysyła drugiego żądania.
    fireEvent.click(busy);
    expect(explainJobOffer).toHaveBeenCalledTimes(1);
    resolve(OK);
    await waitFor(() => expect(screen.getByTestId('job-explain-result')).toBeTruthy());
  });

  it('wynik: objaśnienie w wybranym języku, źródło z lang, luka, pominięte; fokus na nagłówku wyniku', async () => {
    vi.mocked(explainJobOffer).mockResolvedValue(OK);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: pl.jobExplain.button }));
    const heading = await screen.findByRole('heading', { name: /Wyjaśnienie przygotowane przez AI/ });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByText(OK.ok ? OK.items[0]!.explanation : '').getAttribute('lang')).toBe('nl');
    const quote = screen.getByText('2 000–2 500 EUR / mies.');
    expect(quote.tagName).toBe('Q');
    expect(quote.getAttribute('lang')).toBe('pl');
    expect(screen.getByText(`${pl.jobExplain.fields.salary}:`, { exact: false })).toBeTruthy();
    expect(screen.getByText(new RegExp(pl.jobExplain.gapKinds.missing))).toBeTruthy();
    expect(screen.getByText(/Pominęliśmy 1 objaśnienie/)).toBeTruthy();
    expect(screen.getByText(pl.jobExplain.disclaimer)).toBeTruthy();
    expect(screen.getByRole('button', { name: pl.jobExplain.again })).toBeTruthy();
  });

  it('błąd: komunikat z kodu (bez treści technicznej) i ponowienie; brak sieci = osobny komunikat', async () => {
    vi.mocked(explainJobOffer).mockResolvedValueOnce({ ok: false, error: 'JOB_EXPLAIN_FAILED' });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: pl.jobExplain.button }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(pl.errors.jobExplainFailed);
    vi.mocked(explainJobOffer).mockRejectedValueOnce(new Error('fetch failed: ECONNRESET'));
    fireEvent.click(screen.getByRole('button', { name: pl.jobExplain.retry }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(pl.jobExplain.errorNetwork));
    expect(screen.getByRole('alert').textContent).not.toMatch(/ECONNRESET/);
    expect(explainJobOffer).toHaveBeenCalledTimes(2);
  });

  it('pusty wynik = osobny komunikat (nie pusta sekcja)', async () => {
    vi.mocked(explainJobOffer).mockResolvedValue({ ok: true, targetLocale: 'pl', items: [], gaps: [], dropped: 0 });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: pl.jobExplain.button }));
    expect(await screen.findByText(pl.jobExplain.empty)).toBeTruthy();
  });
});
