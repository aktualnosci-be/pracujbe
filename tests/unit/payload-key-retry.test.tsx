import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { payloadKey, type PayloadKeyState } from '@/lib/idempotency/payload-key';
import { ContactForm } from '@/components/public/ContactForm';
import { ContentReportForm } from '@/components/public/ContentReportForm';
import { AppealForm } from '@/components/moderation/AppealForm';
import { submitContactMessage } from '@/lib/actions/contact';
import { submitContentReport } from '@/lib/actions/content-reports';
import { submitModerationAppeal } from '@/lib/actions/appeals';
import pl from '@/messages/pl.json';

/**
 * #1103 (UX13-02) — po utraconej odpowiedzi (błąd sieci) ponowienie BEZ zmian idzie z tym samym
 * kluczem idempotencji (brak duplikatu), a ponowienie z POPRAWIONĄ treścią dostaje nowy klucz
 * (inaczej serwer zwróciłby zapis starej treści jako sukces i poprawka zniknęłaby po cichu).
 * Wzorzec z #926 (ApplyModal).
 */

vi.mock('@/lib/actions/contact', () => ({ submitContactMessage: vi.fn() }));
vi.mock('@/lib/actions/content-reports', () => ({
  submitContentReport: vi.fn(),
  lookupReportCase: vi.fn(),
  submitReportAppeal: vi.fn(),
}));
vi.mock('@/lib/actions/appeals', () => ({
  submitModerationAppeal: vi.fn(),
  submitReportAppeal: vi.fn(),
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/auth/TurnstileWidget', () => ({
  isTurnstileWidgetEnabled: () => false,
  TurnstileWidget: () => null,
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="pl" messages={pl}>
    {node}
  </NextIntlClientProvider>
);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('payloadKey', () => {
  it('ta sama treść → ten sam klucz; zmieniona treść → nowy klucz', () => {
    const ref: { current: PayloadKeyState | null } = { current: null };
    let n = 0;
    const make = () => `k${++n}`;
    expect(payloadKey(ref, { a: 1 }, make)).toBe('k1');
    expect(payloadKey(ref, { a: 1 }, make)).toBe('k1');
    expect(payloadKey(ref, { a: 2 }, make)).toBe('k2');
    // Kontrola ujemna: powrót do starej treści to znowu inna wysyłka niż ostatnia.
    expect(payloadKey(ref, { a: 1 }, make)).toBe('k3');
  });
});

const callKey = (mock: unknown, index: number): string => {
  const call = (mock as { mock: { calls: unknown[][] } }).mock.calls[index]!;
  return (call[0] as { idempotencyKey: string }).idempotencyKey;
};

describe('formularz kontaktu', () => {
  const fill = (message: string) => {
    fireEvent.change(screen.getByLabelText(pl.contact.topicLabel), { target: { value: 'other' } });
    fireEvent.change(screen.getByLabelText(pl.contact.messageLabel), { target: { value: message } });
    fireEvent.change(screen.getByLabelText(pl.contact.emailLabel), { target: { value: 'jan@example.com' } });
  };
  const send = () => fireEvent.click(screen.getByRole('button', { name: pl.contact.submit }));

  it('bez zmian po błędzie sieci → ten sam klucz, bez duplikatu', async () => {
    vi.mocked(submitContactMessage)
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({ ok: true, reference: 'KON-AAAA-AAAA', created: true });
    render(wrap(<ContactForm />));
    fill('Treść wiadomości do zespołu, dość długa.');
    send();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    send();
    await waitFor(() => expect(submitContactMessage).toHaveBeenCalledTimes(2));
    expect(callKey(submitContactMessage, 1)).toBe(callKey(submitContactMessage, 0));
  });

  it('poprawiona treść po błędzie sieci → nowy klucz i nowa treść w wysyłce', async () => {
    vi.mocked(submitContactMessage)
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({ ok: true, reference: 'KON-AAAA-AAAA', created: true });
    render(wrap(<ContactForm />));
    fill('Treść wiadomości do zespołu, dość długa.');
    send();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(pl.contact.messageLabel), {
      target: { value: 'Poprawiona treść wiadomości do zespołu.' },
    });
    send();
    await waitFor(() => expect(submitContactMessage).toHaveBeenCalledTimes(2));
    expect(callKey(submitContactMessage, 1)).not.toBe(callKey(submitContactMessage, 0));
    expect((vi.mocked(submitContactMessage).mock.calls[1]![0] as { message: string }).message).toBe(
      'Poprawiona treść wiadomości do zespołu.',
    );
  });
});

describe('zgłoszenie treści (DSA)', () => {
  const props = {
    jobId: '6f0f4b1e-8a1b-4d7e-9c1a-2b3c4d5e6f70',
    jobTitle: 'Magazynier',
    companyName: 'Firma',
    jobSlug: 'magazynier',
    jobUrl: 'https://pracuj.be/pl/oferty-pracy/magazynier',
    initialTarget: 'job' as const,
  };
  const fill = (details: string) => {
    fireEvent.click(screen.getByRole('radio', { name: pl.contentReport.categoryFraud }));
    fireEvent.change(screen.getByLabelText(pl.contentReport.detailsLabel), { target: { value: details } });
    fireEvent.change(screen.getByLabelText(pl.contentReport.reporterEmailLabel), {
      target: { value: 'jan@example.com' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: pl.contentReport.goodFaithLabel }));
  };
  const send = () => fireEvent.click(screen.getByRole('button', { name: pl.contentReport.submit }));

  it('bez zmian → ten sam klucz i ten sam kod dostępu; poprawiona treść → nowy klucz, ten sam kod', async () => {
    vi.mocked(submitContentReport)
      .mockRejectedValueOnce(new Error('net'))
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({ ok: true, caseNumber: 'DSA-AAAA-AAAA-AAAA-AAAA', created: false });
    render(wrap(<ContentReportForm {...props} />));
    fill('Opis problemu z ogłoszeniem, wystarczająco długi.');
    send();
    await waitFor(() => expect(submitContentReport).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    send();
    await waitFor(() => expect(submitContentReport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: pl.contentReport.submit })).toBeEnabled());
    expect(callKey(submitContentReport, 1)).toBe(callKey(submitContentReport, 0));

    fireEvent.change(screen.getByLabelText(pl.contentReport.detailsLabel), {
      target: { value: 'Poprawiony opis problemu z ogłoszeniem, długi.' },
    });
    send();
    await waitFor(() => expect(submitContentReport).toHaveBeenCalledTimes(3));
    expect(callKey(submitContentReport, 2)).not.toBe(callKey(submitContentReport, 0));
    const code = (i: number) =>
      (vi.mocked(submitContentReport).mock.calls[i]![0] as { accessCode: string }).accessCode;
    expect(code(2)).toBe(code(0));
    // Sprawa już istniała (created: false) i poprawka NIE została do niej dopisana — komunikat mówi to wprost.
    await waitFor(() =>
      expect(screen.getByText(pl.contentReport.successDuplicateEdited)).toBeInTheDocument(),
    );
  });
});

describe('odwołanie od decyzji', () => {
  it('poprawione uzasadnienie po błędzie sieci → nowy klucz; bez zmian → ten sam', async () => {
    vi.mocked(submitModerationAppeal)
      .mockRejectedValueOnce(new Error('net'))
      .mockRejectedValueOnce(new Error('net'))
      .mockRejectedValueOnce(new Error('net'));
    render(wrap(<AppealForm target={{ kind: 'decision', decisionId: 'd1' }} messages="company" />));
    fireEvent.click(screen.getByRole('button', { name: pl.company.appealAction }));
    const grounds = screen.getByLabelText(pl.company.appealGroundsLabel);
    const submit = () => fireEvent.click(screen.getByRole('button', { name: pl.company.appealSubmit }));
    fireEvent.change(grounds, { target: { value: 'Uzasadnienie odwołania numer jeden.' } });
    submit();
    await waitFor(() => expect(submitModerationAppeal).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: pl.company.appealSubmit })).toBeEnabled());
    submit();
    await waitFor(() => expect(submitModerationAppeal).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: pl.company.appealSubmit })).toBeEnabled());
    fireEvent.change(grounds, { target: { value: 'Poprawione uzasadnienie odwołania.' } });
    submit();
    await waitFor(() => expect(submitModerationAppeal).toHaveBeenCalledTimes(3));
    const key = (i: number) => vi.mocked(submitModerationAppeal).mock.calls[i]![2];
    expect(key(1)).toBe(key(0));
    expect(key(2)).not.toBe(key(0));
  });
});
