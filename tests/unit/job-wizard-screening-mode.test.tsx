import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobWizard, type JobWizardInitialValues } from '@/components/employer/JobWizard';

/**
 * #1137 — decyzja produktowa: portal ogłoszeniowy. Krok 7 kreatora bez sekcji pytań
 * screeningowych, gdy serwer nie włączył ich propem `screeningEnabled` (domyślnie wyłączone,
 * fail-closed); pytania zapisane w szkicu sprzed trybu nie trafiają do wysyłanych danych.
 * Kontrola ujemna: z `screeningEnabled` sekcja i pytania są jak dotąd (#101).
 */

const { createJobDraft, updateJobDraft, publishJob, updatePublishedJob, push } = vi.hoisted(() => ({
  createJobDraft: vi.fn(),
  updateJobDraft: vi.fn(),
  publishJob: vi.fn(),
  updatePublishedJob: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@/lib/actions/jobs', () => ({ createJobDraft, updateJobDraft, publishJob, updatePublishedJob }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useLocale: () => 'pl',
}));

const JOB = '11111111-1111-4111-8111-111111111111';

const VALUES: JobWizardInitialValues = {
  title: 'Operator wózka widłowego',
  category: 'warehouse',
  occupation: 'Operator wózka',
  contractType: 'permanent',
  workingHours: '38 h / tydzień',
  city: 'Antwerpia',
  region: 'Flandria',
  description: 'Obsługa wózka widłowego w magazynie centralnym, załadunek i rozładunek.',
  responsibilities: ['Załadunek towaru'],
  requirementsMandatory: ['Uprawnienia UDT'],
  companyDescription: 'Rodzinna firma logistyczna z Antwerpii.',
  contactEmail: 'hr@example.be',
  screeningQuestions: [{ type: 'yes_no', required: true, prompt: { pl: 'Czy masz uprawnienia UDT?' }, options: [] }],
};

function renderWizard(screeningEnabled?: boolean) {
  return render(
    <JobWizard
      initialJobId={JOB}
      initialValues={VALUES}
      published={{ status: 'active', slug: 'operator-wozka-abc', updatedAt: '2026-09-24T10:00:00+00:00' }}
      {...(screeningEnabled === undefined ? {} : { screeningEnabled })}
    />,
  );
}

async function goToStep7(): Promise<void> {
  for (let step = 2; step <= 7; step++) {
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    await screen.findByRole('heading', { level: 2, name: `step${step}Title` });
  }
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  updatePublishedJob.mockResolvedValue({ ok: true, slug: 'operator-wozka-abc', updatedAt: '2026-09-24T10:05:00+00:00' });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('JobWizard — pytania screeningowe a tryb portalu (#1137)', () => {
  it('domyślnie (tryb ogłoszeniowy): krok 7 bez sekcji pytań, wysyłana lista pytań pusta', async () => {
    renderWizard();
    await goToStep7();
    expect(screen.queryByRole('heading', { level: 3, name: 'screeningTitle' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'saveChanges' }));
    await waitFor(() => expect(updatePublishedJob).toHaveBeenCalledTimes(1));
    const steps = updatePublishedJob.mock.calls[0]![1] as Record<string, unknown>[];
    expect(steps[6]).toMatchObject({ screeningQuestions: [] });
  });

  it('kontrola ujemna: screeningEnabled → sekcja pytań i zapisane pytanie w danych kroku', async () => {
    renderWizard(true);
    await goToStep7();
    expect(screen.getByRole('heading', { level: 3, name: 'screeningTitle' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'saveChanges' }));
    await waitFor(() => expect(updatePublishedJob).toHaveBeenCalledTimes(1));
    const steps = updatePublishedJob.mock.calls[0]![1] as { screeningQuestions: unknown[] }[];
    expect(steps[6]!.screeningQuestions).toHaveLength(1);
  });
});
