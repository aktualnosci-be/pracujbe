import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

const { sendMessage, refresh } = vi.hoisted(() => ({ sendMessage: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/actions/messages', () => ({ sendMessage }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { MessageComposer } from '@/components/messaging/MessageComposer';
import { MESSAGE_BODY_MAX_LENGTH } from '@/lib/validation/message';

const translations = { pl, nl, fr, en } as const;

function renderComposer(locale: keyof typeof translations = 'pl') {
  return render(
    <NextIntlClientProvider locale={locale} messages={translations[locale]}>
      <MessageComposer conversationId="00000000-0000-4000-8000-000000000001" recipientName="Anna Nowak" />
    </NextIntlClientProvider>,
  );
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MessageComposer (#335, #358)', () => {
  it.each(['pl', 'nl', 'fr', 'en'] as const)('pole ma etykietę z rozmówcą i licznik: %s', (locale) => {
    renderComposer(locale);
    const m = translations[locale].messages;
    const field = screen.getByRole('textbox', { name: fill(m.composerLabel, { name: 'Anna Nowak' }) });
    expect(field).toHaveAttribute('maxLength', String(MESSAGE_BODY_MAX_LENGTH));
    expect(field).toHaveAccessibleDescription(fill(m.composerCounter, { count: 0, max: 4000 }));
  });

  it('limit odpowiada CHECK (length(body) <= 4000) w bazie', () => {
    expect(MESSAGE_BODY_MAX_LENGTH).toBe(4000);
  });

  it('licznik rośnie z treścią', () => {
    renderComposer();
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Dzień dobry' } });
    expect(field).toHaveAccessibleDescription(fill(pl.messages.composerCounter, { count: 11, max: 4000 }));
  });

  it('za długa treść: błąd przy polu z i18n, bez wysyłki, treść zostaje', () => {
    renderComposer();
    const field = screen.getByRole('textbox');
    const long = 'a'.repeat(MESSAGE_BODY_MAX_LENGTH + 1);
    // `maxLength` nie obcina wartości ustawionej skryptem — kontrola w submit jest drugą linią.
    fireEvent.change(field, { target: { value: long } });
    fireEvent.click(screen.getByRole('button', { name: pl.messages.send }));

    const message = fill(pl.messages.composerTooLong, { max: 4000 });
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(field).toHaveValue(long);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['RATE_LIMITED', pl.errors.rateLimited],
    ['PERMISSION_DENIED', pl.errors.permissionDenied],
    ['VALIDATION_FAILED', pl.errors.validationFailed],
    ['INTERNAL', pl.messages.sendError],
  ])('mapuje kod %s na konkretny komunikat', async (code, text) => {
    sendMessage.mockResolvedValue({ ok: false, error: code });
    renderComposer();
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Treść' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(text);
    expect(field).toHaveValue('Treść');
  });

  it('po wysłaniu Enterem fokus zostaje w polu, a pole nie jest disabled w trakcie', async () => {
    let resolve!: (value: unknown) => void;
    sendMessage.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderComposer();
    const field = screen.getByRole('textbox');
    field.focus();
    fireEvent.change(field, { target: { value: 'Cześć' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });

    expect(field).not.toBeDisabled();
    expect(field).toHaveAttribute('readonly');
    expect(field).toHaveAttribute('aria-busy', 'true');
    expect(document.activeElement).toBe(field);

    await act(async () => {
      resolve({ ok: true, id: 'x' });
    });
    expect(field).toHaveValue('');
    expect(field).not.toHaveAttribute('readonly');
    expect(document.activeElement).toBe(field);
    expect(refresh).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});
