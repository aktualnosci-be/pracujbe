import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NewJobWizard } from '@/components/employer/NewJobWizard';

/**
 * #465 — krok „Zaimportuj z ogłoszenia": bez flagi kreator bez zmian; z flagą import wypełnia
 * formularz, pokazuje pola do sprawdzenia i nie publikuje. Akcje serwera są atrapami.
 */

const { importJobListing, createJobDraft, updateJobDraft, publishJob, push } = vi.hoisted(() => ({
  importJobListing: vi.fn(),
  createJobDraft: vi.fn(),
  updateJobDraft: vi.fn(),
  publishJob: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@/lib/actions/job-import', () => ({ importJobListing }));
vi.mock('@/lib/actions/jobs', () => ({ createJobDraft, updateJobDraft, publishJob }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (key: string) => (ns ? `${ns}.${key}` : key),
  useLocale: () => 'pl',
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  vi.clearAllMocks();
});
afterEach(cleanup);

function openPanel(): void {
  fireEvent.click(screen.getByRole('button', { name: 'jobImport.title' }));
}

describe('NewJobWizard', () => {
  it('bez flagi: brak kroku importu', () => {
    render(<NewJobWizard importEnabled={false} />);
    expect(screen.queryByRole('button', { name: 'jobImport.title' })).toBeNull();
    expect(screen.getByLabelText('jobWizard.titleLabel')).toBeInTheDocument();
  });

  it('kontrola ujemna: zły typ pliku zatrzymany w przeglądarce, bez wywołania serwera', async () => {
    render(<NewJobWizard importEnabled />);
    openPanel();
    const input = screen.getByLabelText('jobImport.fileLabel');
    fireEvent.change(input, { target: { files: [new File(['%PDF'], 'ad.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'jobImport.importImage' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('jobImport.errorFileType');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(importJobListing).not.toHaveBeenCalled();
  });

  it('błąd serwera (adres wewnętrzny) pokazany przy polu, adres zostaje w polu', async () => {
    importJobListing.mockResolvedValue({ ok: false, error: 'JOB_IMPORT_INVALID_URL' });
    render(<NewJobWizard importEnabled />);
    openPanel();
    const url = screen.getByLabelText('jobImport.urlLabel');
    fireEvent.change(url, { target: { value: 'http://169.254.169.254/' } });
    fireEvent.click(screen.getByRole('button', { name: 'jobImport.importUrl' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('errors.jobImportInvalidUrl');
    expect(url).toHaveValue('http://169.254.169.254/');
  });

  it('sukces: formularz wypełniony, lista pól do sprawdzenia, ostrzeżenie o poleceniach dla AI', async () => {
    importJobListing.mockResolvedValue({
      ok: true,
      jobId: '11111111-1111-4111-8111-111111111111',
      values: { title: 'Orderpicker magazijn', category: 'warehouse', occupation: 'Orderpicker' },
      review: ['title', 'category', 'city'],
      suspicious: true,
      sourceLanguage: 'nl',
      savedSteps: [],
    });
    render(<NewJobWizard importEnabled />);
    openPanel();
    fireEvent.change(screen.getByLabelText('jobImport.urlLabel'), { target: { value: 'https://jobs.example/1' } });
    fireEvent.click(screen.getByRole('button', { name: 'jobImport.importUrl' }));

    await waitFor(() => expect(screen.getByLabelText('jobWizard.titleLabel')).toHaveValue('Orderpicker magazijn'));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('jobImport.successTitle');
    expect(status).toHaveTextContent('jobImport.suspiciousWarning');
    expect(status).toHaveTextContent('jobImport.successDraftPending');
    expect(status).toHaveFocus();

    const note = screen.getByRole('note');
    expect(within(note).getByText('jobWizard.titleLabel')).toBeInTheDocument();
    expect(within(note).getByText('jobWizard.categoryLabel')).toBeInTheDocument();
    // `city` należy do kroku 3 — nie jest wymienione na kroku 1.
    expect(within(note).queryByText('jobWizard.cityLabel')).toBeNull();
    expect(publishJob).not.toHaveBeenCalled();
  });
});
