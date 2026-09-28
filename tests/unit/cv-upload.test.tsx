import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CvUpload } from '@/components/candidate/CvUpload';
import { deleteCandidateFile, prepareCvDownload, uploadCandidateCv } from '@/lib/actions/files';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import { withRecruitmentMode } from '../helpers/portal-mode';

// Przepływ rekrutacyjny (#1128): w trybie ogłoszeniowym ta ścieżka jest wyłączona (#1134/#1138).
withRecruitmentMode();

vi.mock('@/lib/actions/files', () => ({
  uploadCandidateCv: vi.fn(),
  deleteCandidateFile: vi.fn(),
  prepareCvDownload: vi.fn(),
}));
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const messages = { pl, nl, fr, en };
const removeLabels = {
  pl: 'Usuń',
  nl: 'Verwijderen',
  fr: 'Supprimer',
  en: 'Delete',
} as const;
const fileName = 'candidate-cv.pdf';

function renderCv(locale: keyof typeof messages, items = [{ id: 'fixture-cv', fileName, downloadable: true }]) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <CvUpload items={items} allowUpload />
    </NextIntlClientProvider>,
  );
}

describe('Lista CV', () => {
  it.each(['pl', 'nl', 'fr', 'en'] as const)(
    'daje usuwaniu pliku pełną nazwę i cel dotykowy 48 px: %s',
    (locale) => {
      const { container } = renderCv(locale);

      const removeButton = screen.getByRole('button', {
        name: `${removeLabels[locale]}: ${fileName}`,
      });
      expect(removeButton).toHaveClass('min-h-12', 'min-w-12');
      expect(container.firstElementChild).toHaveClass('min-w-0');
      expect(screen.getByText(fileName).parentElement).toHaveClass('overflow-hidden');
      expect(screen.getByText(fileName)).toHaveClass('truncate');
    },
  );

  it('usuwa wskazany plik i odświeża dane po sukcesie', async () => {
    vi.mocked(deleteCandidateFile).mockResolvedValue({ ok: true });
    renderCv('pl');

    fireEvent.click(screen.getByRole('button', { name: `Usuń: ${fileName}` }));
    const dialog = screen.getByRole('alertdialog', { name: messages.pl.files.deleteConfirmTitle });
    expect(dialog).toHaveTextContent(fileName);
    fireEvent.click(screen.getByRole('button', { name: messages.pl.files.delete }));

    await waitFor(() => expect(deleteCandidateFile).toHaveBeenCalledExactlyOnceWith('fixture-cv'));
    expect(refresh).toHaveBeenCalledOnce();
    expect(await screen.findByRole('status')).toHaveTextContent(messages.pl.files.deleteSuccess);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: messages.pl.files.upload })).toHaveFocus(),
    );
  });

  it('anulowanie usunięcia nie woła akcji i oddaje fokus przyciskowi kosza', async () => {
    renderCv('pl');
    const trash = screen.getByRole('button', { name: `Usuń: ${fileName}` });
    fireEvent.click(trash);
    expect(screen.getByRole('button', { name: messages.pl.common.cancel })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: messages.pl.common.cancel }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(deleteCandidateFile).not.toHaveBeenCalled();
    await waitFor(() => expect(trash).toHaveFocus());
  });

  it.each(['pl', 'nl', 'fr', 'en'] as const)(
    'błąd odczytu listy nie udaje pustej listy i nie proponuje ponownego wgrania: %s',
    (locale) => {
      render(
        <NextIntlClientProvider locale={locale} messages={messages[locale]}>
          <CvUpload items={[]} loadFailed allowUpload />
        </NextIntlClientProvider>,
      );
      const m = messages[locale];
      expect(screen.getByRole('alert')).toHaveTextContent(m.files.loadError);
      expect(screen.queryByText(m.files.empty)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: m.files.upload })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: m.common.retry }));
      expect(refresh).toHaveBeenCalledOnce();
      refresh.mockClear();
      cleanup();
    },
  );

  it('pobranie wystawia link dopiero przy kliknięciu i przechodzi pod niego (#26)', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } });
    try {
      vi.mocked(prepareCvDownload).mockResolvedValue({ ok: true, url: '/api/files/cv/fixture-cv?t=signed' });
      renderCv('pl');
      expect(prepareCvDownload).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: `${pl.files.download}: ${fileName}` }));
      await waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith('/api/files/cv/fixture-cv?t=signed'));
      expect(prepareCvDownload).toHaveBeenCalledExactlyOnceWith('fixture-cv');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it.each(['pl', 'nl', 'fr', 'en'] as const)('błąd wystawienia linku daje komunikat: %s', async (locale) => {
    vi.mocked(prepareCvDownload).mockResolvedValue({ ok: false, error: 'NOT_FOUND' });
    renderCv(locale);
    fireEvent.click(screen.getByRole('button', { name: `${messages[locale].files.download}: ${fileName}` }));
    expect(await screen.findByRole('alert')).toHaveTextContent(messages[locale].files.downloadError);
  });

  it.each(['pl', 'nl', 'fr', 'en'] as const)('plik w kwarantannie nie ma akcji pobrania: %s', (locale) => {
    renderCv(locale, [{ id: 'fixture-cv', fileName, downloadable: false }]);
    expect(screen.getByText(messages[locale].files.quarantined)).toBeVisible();
    expect(screen.queryByRole('button', { name: new RegExp(`^${messages[locale].files.download}:`) })).not.toBeInTheDocument();
    // Właściciel może usunąć także plik w kwarantannie.
    expect(screen.getByRole('button', { name: `${removeLabels[locale]}: ${fileName}` })).toBeEnabled();
  });

  it('dla pustej listy nie renderuje akcji usuwania', () => {
    renderCv('pl', []);
    expect(screen.getByText(messages.pl.files.empty)).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Usuń:/ })).not.toBeInTheDocument();
  });
});

/** Plik o zadanym rozmiarze bez alokowania bufora (jsdom). */
function fakeFile(name: string, type: string, size: number): File {
  const file = new File(['%PDF-'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function pick(container: HTMLElement, file: File): void {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe('Wgrywanie CV — rozmiar i format (#362)', () => {
  it.each([
    ['7 MB', 7 * 1024 * 1024],
    ['5,5 MB', 5.5 * 1024 * 1024],
  ])('plik %s odrzucony w przeglądarce, bez żądania do serwera', async (_label, size) => {
    const { container } = renderCv('pl', []);
    pick(container, fakeFile('big.pdf', 'application/pdf', size));

    expect(await screen.findByRole('alert')).toHaveTextContent(pl.files.errorTooLarge);
    expect(uploadCandidateCv).not.toHaveBeenCalled();
  });

  it.each(['pl', 'nl', 'fr', 'en'] as const)('zły format → komunikat o formacie: %s', async (locale) => {
    const { container } = renderCv(locale, []);
    pick(container, fakeFile('photo.png', 'image/png', 1024));

    expect(await screen.findByRole('alert')).toHaveTextContent(messages[locale].files.errorType);
    expect(uploadCandidateCv).not.toHaveBeenCalled();
  });

  it('poprawny plik trafia do akcji; powód z serwera daje konkretny komunikat', async () => {
    vi.mocked(uploadCandidateCv).mockResolvedValue({
      ok: false,
      error: 'VALIDATION_FAILED',
      reason: 'type',
    });
    const { container } = renderCv('en', []);
    pick(container, fakeFile('cv.pdf', 'application/pdf', 1024));

    expect(await screen.findByRole('alert')).toHaveTextContent(en.files.errorType);
    expect(uploadCandidateCv).toHaveBeenCalledTimes(1);
  });

  it('odrzucone żądanie (sieć/413) daje komunikat zamiast wywrócenia strony', async () => {
    vi.mocked(uploadCandidateCv).mockRejectedValue(new Error('Body exceeded 6mb limit'));
    const { container } = renderCv('pl', []);
    pick(container, fakeFile('cv.pdf', 'application/pdf', 1024));

    expect(await screen.findByRole('alert')).toHaveTextContent(pl.files.uploadError);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: pl.files.upload })).toBeEnabled();
    });
  });
});

describe('CvUpload bez wgrywania (#1138 — tryb ogłoszeniowy)', () => {
  const uploadLabels = { pl: pl.files.upload, nl: nl.files.upload, fr: fr.files.upload, en: en.files.upload };

  it.each(['pl', 'nl', 'fr', 'en'] as const)('%s: lista istniejących plików z „Pobierz”/„Usuń”, bez „Wgraj”', (locale) => {
    const { container } = render(
      <NextIntlClientProvider locale={locale} messages={messages[locale]}>
        <CvUpload items={[{ id: 'fixture-cv', fileName, downloadable: true }]} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('button', { name: uploadLabels[locale] })).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByRole('heading', { name: messages[locale].files.existingTitle })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${removeLabels[locale]}: ${fileName}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${messages[locale].files.download}: ${fileName}` })).toBeInTheDocument();
  });

  it('kontrola ujemna: z allowUpload przycisk „Wgraj” i pole pliku są', () => {
    const { container } = renderCv('pl');
    expect(screen.getByRole('button', { name: pl.files.upload })).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('usunięcie pliku bez wgrywania: fokus wraca na nagłówek sekcji', async () => {
    vi.mocked(deleteCandidateFile).mockResolvedValue({ ok: true });
    render(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <CvUpload items={[{ id: 'fixture-cv', fileName, downloadable: true }]} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: `${removeLabels.pl}: ${fileName}` }));
    fireEvent.click(await screen.findByRole('button', { name: pl.files.delete }));
    await waitFor(() => expect(deleteCandidateFile).toHaveBeenCalledWith('fixture-cv'));
    await waitFor(() => expect(screen.getByRole('heading', { name: pl.files.existingTitle })).toHaveFocus());
    expect(uploadCandidateCv).not.toHaveBeenCalled();
  });
});
