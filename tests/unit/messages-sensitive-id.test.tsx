import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PortalIdentity } from '@/lib/auth/session';
import { containsPersonalIdentifier } from '@/lib/privacy/sensitive-data';
import { checkRateLimit } from '@/lib/rate-limit';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';
import { fakeDb, fakeSession, resetFakeDb } from '../helpers/fake-db';

/**
 * #495 („Otwarte: wiadomości w rozmowach”) — w treści wiadomości nie wysyłamy numeru
 * NISS/BIS (mod 97), PESEL, numeru karty eID ani numeru po „paszport nr…”.
 * Akcja: błąd przy polu `body` (`VALIDATION_FAILED` + `sensitiveId`) i BRAK wywołania RPC
 * (nic nie jest zapisywane) — także w trybie demo i przed limitem. Kompozytor: błąd przy
 * polu z i18n, treść zostaje, podpowiedź pod polem w 4 językach.
 * Kontrola ujemna: `send_message` w atrapie bazy zawsze się udaje, więc bez blokady asercje
 * „brak RPC” i „błąd przy polu” są czerwone; zwykła treść (kwota, telefon, data, „paszport”
 * bez numeru) przechodzi do RPC. Numery są syntetyczne.
 */

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/data/messages', () => ({ getOlderThreadMessages: vi.fn() }));

import * as actions from '@/lib/actions/messages';
import { MessageComposer } from '@/components/messaging/MessageComposer';

const USER = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '55555555-5555-4555-8555-555555555555';
const CLIENT_MSG = '66666666-6666-4666-8666-666666666666';
const ATTACHMENT = '77777777-7777-4777-8777-777777777777';

const NISS_BODY = 'Mój numer NISS to 85.07.30-033.28, proszę o umowę.';
const PESEL_BODY = 'PESEL: 44051401359';
const BENIGN_BODY = 'Dzień dobry, mogę zacząć 01.10.2026, stawka 15,50 EUR/h, tel. +32 470 12 34 56.';

const SENSITIVE: Array<[string, string]> = [
  ['NISS', NISS_BODY],
  ['BIS', 'Numer BIS: 85473003317'],
  ['PESEL', PESEL_BODY],
  ['karta eID', 'Numer mojej karty eID 591-2345678-29'],
  ['paszport nr', 'Mogę przesłać dane: paszport nr EA1234567'],
];

const BENIGN = [
  BENIGN_BODY,
  'Mam ważny paszport i prawo jazdy kat. B.',
];

const SENSITIVE_RESULT = {
  ok: false,
  error: 'VALIDATION_FAILED',
  field: 'body',
  reason: 'sensitiveId',
};

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: USER, role: 'candidate' } as PortalIdentity);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  fakeDb.rpc('send_message', 'message-1');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('sendMessage — numery identyfikacyjne (#495)', () => {
  it.each(SENSITIVE)('%s w treści → błąd pola „body” bez zapisu i bez limitu', async (_, body) => {
    expect(containsPersonalIdentifier(body)).toBe(true);
    expect(await actions.sendMessage(CONVERSATION, body, CLIENT_MSG)).toEqual(SENSITIVE_RESULT);
    expect(fakeDb.calls).toHaveLength(0);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it('także z załącznikiem i w trybie demo', async () => {
    expect(
      await actions.sendMessage(CONVERSATION, NISS_BODY, CLIENT_MSG, [ATTACHMENT]),
    ).toEqual(SENSITIVE_RESULT);
    fakeSession.configured = false;
    expect(await actions.sendMessage(CONVERSATION, PESEL_BODY, CLIENT_MSG)).toEqual(
      SENSITIVE_RESULT,
    );
    expect(fakeDb.calls).toHaveLength(0);
  });

  it.each(BENIGN)('kontrola ujemna: zwykła treść jest zapisywana — %s', async (body) => {
    expect(await actions.sendMessage(CONVERSATION, body, CLIENT_MSG)).toEqual({
      ok: true,
      id: 'message-1',
    });
    expect(fakeDb.callsTo('send_message')[0]).toMatchObject({ args: { p_body: body }, as: USER });
  });
});

const translations = { pl, nl, fr, en } as const;

function renderComposer(locale: keyof typeof translations = 'pl') {
  return render(
    <NextIntlClientProvider locale={locale} messages={translations[locale]}>
      <MessageComposer conversationId={CONVERSATION} recipientName="Anna Nowak" />
    </NextIntlClientProvider>,
  );
}

describe('MessageComposer — numery identyfikacyjne (#495)', () => {
  it.each(['pl', 'nl', 'fr', 'en'] as const)('podpowiedź pod polem: %s', (locale) => {
    renderComposer(locale);
    const hint = translations[locale].messages.composerSensitiveIdHint;
    expect(hint.length).toBeGreaterThan(0);
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription(expect.stringContaining(hint));
  });

  it.each(['pl', 'nl', 'fr', 'en'] as const)(
    'numer w treści: błąd przy polu, bez wysyłki, treść zostaje: %s',
    async (locale) => {
      const spy = vi.spyOn(actions, 'sendMessage');
      renderComposer(locale);
      const m = translations[locale].messages;
      const field = screen.getByRole('textbox');
      fireEvent.change(field, { target: { value: NISS_BODY } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: m.send }));
      });
      expect(screen.getByRole('alert')).toHaveTextContent(m.composerSensitiveId);
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field).toHaveAccessibleDescription(expect.stringContaining(m.composerSensitiveId));
      expect(field).toHaveValue(NISS_BODY);
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it('odmowa serwera z powodem `sensitiveId` → ten sam komunikat przy polu, treść zostaje', async () => {
    vi.spyOn(actions, 'sendMessage').mockResolvedValue(
      SENSITIVE_RESULT as Awaited<ReturnType<typeof actions.sendMessage>>,
    );
    renderComposer();
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Treść' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(pl.messages.composerSensitiveId);
    expect(field).toHaveValue('Treść');
  });

  it('kontrola ujemna: zwykła treść jest wysyłana', async () => {
    const spy = vi
      .spyOn(actions, 'sendMessage')
      .mockResolvedValue({ ok: true, id: 'message-1' });
    renderComposer();
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: BENIGN_BODY } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    expect(spy).toHaveBeenCalledWith(CONVERSATION, BENIGN_BODY, expect.any(String));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
