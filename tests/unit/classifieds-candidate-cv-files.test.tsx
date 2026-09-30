import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CandidateSettingsPage from '@/app/[locale]/candidate/ustawienia/page';
import { CvUpload } from '@/components/candidate/CvUpload';
import { deleteCandidateFile, prepareCvDownload, uploadCandidateCv } from '@/lib/actions/files';
import { loadCandidateFiles } from '@/lib/data/candidate-files';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import { withClassifiedsMode, withRecruitmentMode } from '../helpers/portal-mode';

/**
 * #1226 — decyzja produktowa: portal ogłoszeniowy (#1128). Profil zawodowy (z listą CV) jest
 * w trybie ogłoszeniowym 404 (#1142), więc CV wgrane wcześniej kandydat pobiera albo usuwa
 * w ustawieniach konta. Sama lista: bez przycisku „Wgraj” i pola pliku (#1138).
 * Kontrole ujemne: tryb RECRUITMENT (lista zostaje w profilu, loader niewołany) i `allowUpload`.
 */

const messages = { pl, nl, fr, en } as const;
type LocaleKey = keyof typeof messages;

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async ({ locale, namespace }: { locale: LocaleKey; namespace: string }) =>
    (key: string) =>
      (messages[locale] as unknown as Record<string, Record<string, string>>)[namespace]![key],
}));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/actions/files', () => ({
  uploadCandidateCv: vi.fn(),
  deleteCandidateFile: vi.fn(),
  prepareCvDownload: vi.fn(),
}));
vi.mock('@/lib/files/client-download', () => ({ downloadPrivateFile: vi.fn(async () => true) }));
vi.mock('@/lib/data/candidate-files', () => ({ loadCandidateFiles: vi.fn() }));
// Pozostałe sekcje ustawień mają własne testy — tutaj tylko lista plików.
vi.mock('@/lib/data/notification-preferences', () => ({
  loadNotificationPreferences: async () => ({ status: 'error' }),
}));
vi.mock('@/components/settings/NotificationPreferencesLoadError', () => ({ NotificationPreferencesLoadError: () => null }));
vi.mock('@/components/settings/NotificationPreferencesForm', () => ({ NotificationPreferencesForm: () => null }));
vi.mock('@/components/settings/EmailLocaleSection', () => ({ EmailLocaleSection: () => null }));
vi.mock('@/lib/data/company-blocks', () => ({
  loadMyCompanyBlocks: async () => ({ status: 'ready', blocks: [], demo: false }),
}));
vi.mock('@/components/settings/CompanyBlocksSettings', () => ({ CompanyBlocksSettings: () => null }));
vi.mock('@/lib/data/profile-visibility', () => ({ loadProfileVisibility: async () => ({ status: 'error' }) }));
vi.mock('@/components/settings/ProfileVisibilitySettings', () => ({ ProfileVisibilitySettings: () => null }));
vi.mock('@/lib/data/age-policy', () => ({
  loadMyAgeAttestation: async () => ({ status: 'error' }),
}));
vi.mock('@/components/settings/AgeAttestationSettings', () => ({ AgeAttestationSettings: () => null }));
vi.mock('@/components/settings/AccountDataSettings', () => ({ AccountDataSettings: () => null }));
vi.mock('@/components/candidate/CandidatePageHeader', () => ({ CandidatePageHeader: () => null }));

const CV = { id: 'fixture-cv', fileName: 'fixture-cv.pdf', downloadable: true };

async function renderSettings(locale: LocaleKey) {
  const page = await CandidateSettingsPage({ params: Promise.resolve({ locale }) });
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {page}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(loadCandidateFiles).mockResolvedValue({ status: 'ready', items: [CV] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('/candidate/ustawienia w trybie ogłoszeniowym: istniejące CV (#1226)', () => {
  withClassifiedsMode();

  it.each(['pl', 'nl', 'fr', 'en'] as const)('lista z pobraniem i usunięciem, bez wgrywania: %s', async (locale) => {
    await renderSettings(locale);
    const f = messages[locale].files;

    expect(loadCandidateFiles).toHaveBeenCalledTimes(1);
    const section = screen.getByRole('region', { name: f.existingTitle });
    expect(section).toHaveAttribute('id', 'pliki-cv');
    expect(within(section).getByRole('heading', { level: 2, name: f.existingTitle })).toBeInTheDocument();
    expect(within(section).getByText(f.existingHint)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: `${f.download}: ${CV.fileName}` })).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: `${f.delete}: ${CV.fileName}` })).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: f.upload })).toBeNull();
    expect(section.querySelector('input[type="file"]')).toBeNull();
  });

  it('pusty stan: sekcja zostaje (np. po usunięciu ostatniego pliku), z komunikatem o braku plików', async () => {
    vi.mocked(loadCandidateFiles).mockResolvedValue({ status: 'ready', items: [] });
    await renderSettings('pl');
    const section = screen.getByRole('region', { name: pl.files.existingTitle });
    expect(within(section).getByText(pl.files.empty)).toBeInTheDocument();
  });

  it('błąd odczytu = komunikat z ponowieniem, nie pusta lista', async () => {
    vi.mocked(loadCandidateFiles).mockResolvedValue({ status: 'error' });
    await renderSettings('pl');
    const section = screen.getByRole('region', { name: pl.files.existingTitle });
    expect(within(section).getByRole('alert')).toHaveTextContent(pl.files.loadError);
    expect(within(section).queryByText(pl.files.empty)).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: pl.common.retry }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('usunięcie po potwierdzeniu woła akcję i odświeża stronę; pobranie woła akcję linku', async () => {
    vi.mocked(deleteCandidateFile).mockResolvedValue({ ok: true });
    vi.mocked(prepareCvDownload).mockResolvedValue({ ok: true, url: '/api/files/cv/fixture-cv?t=x' });
    await renderSettings('pl');

    fireEvent.click(screen.getByRole('button', { name: `${pl.files.download}: ${CV.fileName}` }));
    await waitFor(() => expect(prepareCvDownload).toHaveBeenCalledWith(CV.id));

    fireEvent.click(screen.getByRole('button', { name: `${pl.files.delete}: ${CV.fileName}` }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: pl.files.delete }));
    await waitFor(() => expect(deleteCandidateFile).toHaveBeenCalledWith(CV.id));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByRole('status')).toHaveTextContent(pl.files.deleteSuccess);
    expect(uploadCandidateCv).not.toHaveBeenCalled();
  });
});

describe('kontrola ujemna: tryb RECRUITMENT', () => {
  withRecruitmentMode();

  it('lista CV zostaje w profilu — ustawienia jej nie czytają ani nie renderują', async () => {
    await renderSettings('pl');
    expect(loadCandidateFiles).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: pl.files.existingTitle })).toBeNull();
  });
});

describe('kontrola ujemna: wariant ustawień z allowUpload', () => {
  it('pokazuje „Wgraj” — dlatego strona ustawień nie może podawać allowUpload', () => {
    render(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <CvUpload variant="settings" items={[CV]} allowUpload />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('button', { name: pl.files.upload })).toBeInTheDocument();
  });
});
