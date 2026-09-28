import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

const { sendMessage, refresh, bulkTransitionApplications } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  refresh: vi.fn(),
  bulkTransitionApplications: vi.fn(),
}));
vi.mock('@/lib/actions/messages', () => ({ sendMessage }));
vi.mock('@/lib/actions/applications', () => ({ bulkTransitionApplications }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { MessageComposer } from '@/components/messaging/MessageComposer';
import { ApplicationsBulkSelection, BulkSelectCheckbox } from '@/components/employer/ApplicationsBulkSelection';
import type { ComposerTemplates } from '@/lib/validation/message-template';

const translations = { pl, nl, fr, en } as const;
const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]));

const CONTEXT: ComposerTemplates = {
  candidateLocale: 'fr',
  companyName: 'Firma RT',
  jobTitle: 'Magazynier',
  templates: [
    { id: 't1', name: 'Zaproszenie', updatedAt: 'x', variants: { pl: 'Dzień dobry {imie}, {stanowisko}', fr: 'Bonjour {imie}, poste {stanowisko} chez {firma}' } },
    { id: 't2', name: 'Odmowa', updatedAt: 'x', variants: { pl: 'Niestety {imie}' } },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderComposer(locale: keyof typeof translations = 'pl') {
  return render(
    <NextIntlClientProvider locale={locale} messages={translations[locale]}>
      <MessageComposer conversationId="00000000-0000-4000-8000-000000000001" recipientName="Luc Roux"
        templates={CONTEXT} templateCandidateName="Luc Roux" />
    </NextIntlClientProvider>,
  );
}

describe('szablon w kompozytorze (0170, Invariant #1)', () => {
  it.each(['pl', 'nl', 'fr', 'en'] as const)('wersja w języku kandydata jest wstawiana z danymi rozmowy: %s', (locale) => {
    renderComposer(locale);
    const m = translations[locale].messageTemplates;
    fireEvent.change(screen.getByRole('combobox', { name: m.pickerLabel }), { target: { value: 't1' } });
    const field = screen.getByRole('textbox', { name: fill(translations[locale].messages.composerLabel, { name: 'Luc Roux' }) });
    expect(field).toHaveValue('Bonjour Luc Roux, poste Magazynier chez Firma RT');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('brak wersji w języku kandydata: komunikat, pole puste; wstawienie innej wersji tylko świadomie', () => {
    renderComposer('pl');
    const m = pl.messageTemplates;
    fireEvent.change(screen.getByRole('combobox', { name: m.pickerLabel }), { target: { value: 't2' } });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(fill(m.pickerMissingVariant, { name: 'Odmowa', language: m.languages.fr }));
    const field = screen.getByRole('textbox', { name: fill(pl.messages.composerLabel, { name: 'Luc Roux' }) });
    expect(field).toHaveValue('');
    fireEvent.click(within(alert).getByRole('button', { name: fill(m.pickerInsertOther, { language: m.languages.pl }) }));
    expect(field).toHaveValue('Niestety Luc Roux');
  });

  it('bez kontekstu szablonów (kandydat, member) kompozytor nie ma wybieraka', () => {
    render(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <MessageComposer conversationId="00000000-0000-4000-8000-000000000001" recipientName="Luc" />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('combobox', { name: pl.messageTemplates.pickerLabel })).toBeNull();
  });
});

describe('akcja zbiorcza na liście zgłoszeń (0170)', () => {
  const COMPANY = '22222222-2222-4222-8222-222222222222';
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
  const B = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';

  function renderBulk() {
    return render(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <ApplicationsBulkSelection companyId={COMPANY} applications={[{ id: A }, { id: B }]}>
          <BulkSelectCheckbox applicationId={A} label="Zgłoszenie A" />
          <BulkSelectCheckbox applicationId={B} label="Zgłoszenie B" />
        </ApplicationsBulkSelection>
      </NextIntlClientProvider>,
    );
  }

  it('zaznaczenie → potwierdzenie → akcja z firmą widoku → raport', async () => {
    bulkTransitionApplications.mockResolvedValue({
      ok: true,
      results: [{ applicationId: A, outcome: 'changed' }, { applicationId: B, outcome: 'invalid_transition' }],
    });
    renderBulk();
    const d = pl.dashboard;
    fireEvent.click(screen.getByRole('checkbox', { name: d.bulkSelectAllOnPage }));
    expect(screen.getByRole('checkbox', { name: 'Zgłoszenie A' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Zmień status 2 zgłoszeń/ }));
    const dialog = screen.getByRole('alertdialog');
    expect(bulkTransitionApplications).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: d.bulkConfirm }));
    });
    expect(bulkTransitionApplications).toHaveBeenCalledWith([A, B], 'rejected', COMPANY);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('1 zgłoszenie zmienione');
    expect(status).toHaveTextContent('1 zgłoszenia nie można przenieść do tego statusu');
    expect(refresh).toHaveBeenCalled();
  });

  it('bez zaznaczenia przycisk jest nieaktywny', () => {
    renderBulk();
    expect(screen.getByRole('button', { name: /Zmień status zaznaczonych/ })).toBeDisabled();
  });

  it('błąd akcji (np. inna aktywna firma) = komunikat, bez raportu', async () => {
    bulkTransitionApplications.mockResolvedValue({ ok: false, error: 'ACTIVE_COMPANY_CHANGED' });
    renderBulk();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Zgłoszenie A' }));
    fireEvent.click(screen.getByRole('button', { name: /Zmień status 1 zgłoszenia/ }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: pl.dashboard.bulkConfirm }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(pl.errors.activeCompanyChanged);
  });
});
