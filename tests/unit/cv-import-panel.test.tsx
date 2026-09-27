import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CvImportPanel } from '@/components/candidate/CvImportPanel';
import { applyCvProposals, prepareCvImportAction, proposeFromCvAction } from '@/lib/actions/cv-import';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

/**
 * #487 — UI importu CV: podgląd przed wysłaniem, propozycje domyślnie NIEzaznaczone,
 * zapis tylko zaznaczonych, odrzucenie wszystkich = brak zapisu.
 */

vi.mock('@/lib/actions/cv-import', () => ({
  prepareCvImportAction: vi.fn(),
  proposeFromCvAction: vi.fn(),
  applyCvProposals: vi.fn(),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Omit<React.ComponentProps<'a'>, 'href'> & { href: string }) => (
    <a {...props} href={href}>{children}</a>
  ),
}));

const PREVIEW_TEXT = 'Magazynier\nObsługa wózka widłowego';

function setup(locale: 'pl' | 'en' = 'pl') {
  vi.mocked(prepareCvImportAction).mockResolvedValue({
    ok: true,
    text: PREVIEW_TEXT,
    summary: { referenceSections: 1, personalSections: 0, thirdPartyLines: 1, personalLines: 0, specialCategoryLines: 0, contacts: 2 },
  });
  vi.mocked(proposeFromCvAction).mockResolvedValue({
    ok: true,
    suspicious: false,
    proposals: [
      { id: 'occupation-0', kind: 'occupation', value: 'Magazynier', evidence: 'Magazynier', uncertain: false },
      { id: 'skill-0', kind: 'skill', value: 'Obsługa wózka widłowego', evidence: '', uncertain: true },
      { id: 'language-0', kind: 'language', value: 'Niderlandzki', level: 'basic', evidence: '', uncertain: true },
    ],
  });
  vi.mocked(applyCvProposals).mockResolvedValue({
    ok: true,
    added: { occupations: 0, skills: 1, languages: 1, certificates: 0, experienceYears: false },
  });
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'pl' ? pl : en}>
      <CvImportPanel />
    </NextIntlClientProvider>,
  );
}

async function toReview(): Promise<void> {
  const input = screen.getByLabelText(pl.cvImport.fileLabel) as HTMLInputElement;
  const file = new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' });
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: pl.cvImport.prepare }));
  await screen.findByRole('heading', { name: pl.cvImport.previewTitle });
  expect(screen.getByLabelText(pl.cvImport.previewLabel).textContent).toBe(PREVIEW_TEXT);
  expect(proposeFromCvAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: pl.cvImport.send }));
  await screen.findByRole('heading', { name: pl.cvImport.reviewTitle });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CvImportPanel', () => {
  it('podgląd przed wysłaniem; model dopiero po „Wyślij do analizy”', async () => {
    setup();
    await toReview();
    expect(proposeFromCvAction).toHaveBeenCalledWith(PREVIEW_TEXT);
  });

  it('propozycje domyślnie niezaznaczone; zapis bez zaznaczenia jest blokowany', async () => {
    setup();
    await toReview();
    for (const box of screen.getAllByRole('checkbox')) expect(box).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: pl.cvImport.apply }));
    expect(await screen.findByRole('alert')).toHaveTextContent(pl.cvImport.errorNothingSelected);
    expect(applyCvProposals).not.toHaveBeenCalled();
  });

  it('do zapisu trafiają tylko zaznaczone pozycje (z wybranym poziomem języka)', async () => {
    setup();
    await toReview();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Obsługa wózka widłowego' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Niderlandzki' }));
    fireEvent.change(screen.getByLabelText('Poziom: Niderlandzki'), { target: { value: 'fluent' } });
    fireEvent.click(screen.getByRole('button', { name: pl.cvImport.apply }));
    await waitFor(() => expect(applyCvProposals).toHaveBeenCalledTimes(1));
    expect(applyCvProposals).toHaveBeenCalledWith({
      occupations: [],
      skills: ['Obsługa wózka widłowego'],
      languages: [{ language: 'Niderlandzki', level: 'fluent' }],
      certificates: [],
      experienceYears: null,
    });
    expect(await screen.findByRole('heading', { name: pl.cvImport.doneTitle })).toHaveFocus();
  });

  it('poprawione wartości (nazwa, poziom języka, lata) trafiają do zapisu zamiast propozycji modelu', async () => {
    setup();
    vi.mocked(proposeFromCvAction).mockResolvedValueOnce({
      ok: true,
      suspicious: false,
      proposals: [
        { id: 'skill-0', kind: 'skill', value: 'Obsługa wózka widłowego', evidence: '', uncertain: true },
        { id: 'language-0', kind: 'language', value: 'Niderlandzki', level: 'basic', evidence: '', uncertain: true },
        { id: 'experienceYears-0', kind: 'experienceYears', value: '5', evidence: '', uncertain: false },
      ],
    });
    await toReview();
    fireEvent.change(screen.getByLabelText('Popraw wartość: Obsługa wózka widłowego'), {
      target: { value: '  Wózek widłowy (UDT)  ' },
    });
    fireEvent.change(screen.getByLabelText('Popraw wartość: Niderlandzki'), { target: { value: 'Nederlands' } });
    fireEvent.change(screen.getByLabelText('Poziom: Nederlands'), { target: { value: 'intermediate' } });
    fireEvent.change(screen.getByLabelText(pl.cvImport.experienceEditLabel), { target: { value: '7' } });
    // Etykieta pola wyboru pokazuje wartość po edycji.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Wózek widłowy (UDT)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Nederlands' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '7 lat doświadczenia' }));
    fireEvent.click(screen.getByRole('button', { name: pl.cvImport.apply }));
    await waitFor(() => expect(applyCvProposals).toHaveBeenCalledTimes(1));
    expect(applyCvProposals).toHaveBeenCalledWith({
      occupations: [],
      skills: ['Wózek widłowy (UDT)'],
      languages: [{ language: 'Nederlands', level: 'intermediate' }],
      certificates: [],
      experienceYears: 7,
    });
    expect(proposeFromCvAction).toHaveBeenCalledTimes(1);
  });

  it('za długa wartość po edycji: błąd przy polu, fokus na pierwszym błędnym polu, brak zapisu', async () => {
    setup();
    await toReview();
    const occupation = screen.getByLabelText('Popraw wartość: Magazynier');
    const skill = screen.getByLabelText('Popraw wartość: Obsługa wózka widłowego');
    fireEvent.change(occupation, { target: { value: 'M'.repeat(81) } });
    fireEvent.change(skill, { target: { value: '' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'M'.repeat(81) }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Obsługa wózka widłowego' }));
    fireEvent.click(screen.getByRole('button', { name: pl.cvImport.apply }));

    expect(await screen.findByRole('alert')).toHaveTextContent(pl.cvImport.errorFieldsInvalid);
    expect(occupation).toHaveFocus();
    expect(occupation).toHaveAttribute('aria-invalid', 'true');
    expect(occupation).toHaveAccessibleDescription('Za długa wartość. Maksymalnie 80 znaków.');
    expect(skill).toHaveAccessibleDescription(pl.cvImport.errorValueRequired);
    expect(applyCvProposals).not.toHaveBeenCalled();

    // Poprawka usuwa błąd pola; niezaznaczone pole nie blokuje zapisu.
    fireEvent.change(occupation, { target: { value: 'M'.repeat(80) } });
    expect(occupation).not.toHaveAttribute('aria-invalid');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Obsługa wózka widłowego' }));
    fireEvent.click(screen.getByRole('button', { name: pl.cvImport.apply }));
    await waitFor(() => expect(applyCvProposals).toHaveBeenCalledTimes(1));
    expect(vi.mocked(applyCvProposals).mock.calls[0]![0]).toMatchObject({ occupations: ['M'.repeat(80)], skills: [] });
  });

  it('„Odrzuć wszystkie” wraca do wyboru pliku bez zapisu; źródło i niepewność widoczne', async () => {
    setup('pl');
    await toReview();
    expect(screen.getAllByText(pl.cvImport.uncertain)).toHaveLength(2);
    expect(screen.getByText(/Źródło w CV: „Magazynier”/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: pl.cvImport.discard }));
    expect(screen.getByRole('heading', { name: pl.cvImport.fileTitle })).toBeInTheDocument();
    expect(applyCvProposals).not.toHaveBeenCalled();
  });
});
