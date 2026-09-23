import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CvUpload } from '@/components/candidate/CvUpload';
import { deleteCandidateFile } from '@/lib/actions/files';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';

vi.mock('@/lib/actions/files', () => ({
  uploadCandidateCv: vi.fn(),
  deleteCandidateFile: vi.fn(),
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

function renderCv(locale: keyof typeof messages, items = [{ id: 'fixture-cv', fileName, url: null }]) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <CvUpload items={items} />
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
          <CvUpload items={[]} loadFailed />
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

  it('dla pustej listy nie renderuje akcji usuwania', () => {
    renderCv('pl', []);
    expect(screen.getByText(messages.pl.files.empty)).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Usuń:/ })).not.toBeInTheDocument();
  });
});
