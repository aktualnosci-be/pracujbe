import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import pl from '@/messages/pl.json';
import type { Locale } from '@/i18n/routing';
import { newMessageAttachmentsLabel } from '@/emails/copy';
import { messageAttachmentCount, renderEmail } from '@/emails/templates';
import { buildDeliveryData } from '@/lib/email/delivery-data';
import { EMAIL_PAYLOAD_FIELDS } from '@/lib/email/payload-fields';
import type { ThreadAttachment } from '@/lib/data/messages';

const { prepareMessageAttachmentDownload } = vi.hoisted(() => ({ prepareMessageAttachmentDownload: vi.fn() }));
vi.mock('@/lib/actions/message-attachments', () => ({ prepareMessageAttachmentDownload }));

import { hasAttachmentPreview, MessageAttachmentList } from '@/components/messaging/MessageAttachmentList';

/**
 * Podgląd JPG/PNG w wątku i liczba załączników w e-mailu `newMessage` (0131, #503).
 * Miniatura używa tego samego krótkiego linku co pobranie, dopiero po wejściu w widok, i nigdy
 * dla pliku w kwarantannie; e-mail mówi tylko, ile plików dołączono — bez nazw.
 */

type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void;
const observers: Array<{ cb: ObserverCallback; disconnect: ReturnType<typeof vi.fn> }> = [];

function stubObserver() {
  observers.length = 0;
  vi.stubGlobal('IntersectionObserver', class {
    cb: ObserverCallback;
    disconnect = vi.fn();
    constructor(cb: ObserverCallback) {
      this.cb = cb;
      observers.push(this);
    }
    observe() {}
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const image = (over: Partial<ThreadAttachment> = {}): ThreadAttachment => ({
  id: 'att-img', fileName: 'skan.png', mimeType: 'image/png', sizeBytes: 2048, downloadable: true, ...over,
});

function renderList(attachments: ThreadAttachment[]) {
  return render(
    <NextIntlClientProvider locale="pl" messages={pl}>
      <MessageAttachmentList attachments={attachments} />
    </NextIntlClientProvider>,
  );
}

const alt = (name: string) => pl.messages.attachmentPreviewAlt.replace('{name}', name);

describe('MessageAttachmentList — podgląd obrazów', () => {
  it('miniatura dopiero po wejściu w widok: krótki link, lazy, alt z nazwy pliku', async () => {
    stubObserver();
    prepareMessageAttachmentDownload.mockResolvedValue({ ok: true, url: '/api/files/message/att-img?t=signed' });
    renderList([image()]);
    expect(prepareMessageAttachmentDownload).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).toBeNull();

    await act(async () => { observers[0]!.cb([{ isIntersecting: true }]); });
    expect(prepareMessageAttachmentDownload).toHaveBeenCalledExactlyOnceWith('att-img');
    const img = screen.getByRole('img', { name: alt('skan.png') });
    expect(img).toHaveAttribute('src', '/api/files/message/att-img?t=signed');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(observers[0]!.disconnect).toHaveBeenCalled();
    // Nazwa z pobraniem zostaje obok miniatury.
    expect(screen.getByRole('button', { name: /skan\.png/ })).toBeInTheDocument();
  });

  it('kwarantanna: brak podglądu i brak wystawienia linku (kontrola ujemna do pierwszego testu)', async () => {
    stubObserver();
    renderList([image({ downloadable: false })]);
    expect(observers).toHaveLength(0);
    expect(prepareMessageAttachmentDownload).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it.each([
    ['application/pdf', 'umowa.pdf'],
    ['image/svg+xml', 'logo.svg'],
    ['image/webp', 'foto.webp'],
  ])('%s: bez podglądu', (mimeType, fileName) => {
    expect(hasAttachmentPreview({ mimeType, downloadable: true })).toBe(false);
    stubObserver();
    renderList([image({ mimeType, fileName })]);
    expect(observers).toHaveLength(0);
  });

  it('JPG i PNG mają podgląd; błąd linku albo obrazu = brak miniatury, pobranie zostaje', async () => {
    expect(hasAttachmentPreview({ mimeType: 'image/jpeg', downloadable: true })).toBe(true);
    stubObserver();
    prepareMessageAttachmentDownload.mockResolvedValueOnce({ ok: false, error: 'NOT_FOUND' });
    renderList([image()]);
    await act(async () => { observers[0]!.cb([{ isIntersecting: true }]); });
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();

    stubObserver();
    prepareMessageAttachmentDownload.mockResolvedValueOnce({ ok: true, url: '/api/files/message/att-img?t=x' });
    renderList([image()]);
    await act(async () => { observers[0]!.cb([{ isIntersecting: true }]); });
    fireEvent.error(screen.getByRole('img', { name: alt('skan.png') }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('button', { name: /skan\.png/ })).toBeInTheDocument();
  });
});

const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];
const SITE = 'https://pracuj.be';

function newMessageRow(payload: Record<string, unknown>) {
  return {
    template: 'newMessage',
    locale: 'pl',
    profile_id: '11111111-1111-4111-8111-111111111111',
    payload: {
      senderName: 'Firma A',
      panel: 'candidate',
      conversationId: '2f1c1b8e-8c1a-4a4c-9d7e-3a1f0c2b9e11',
      ...payload,
    },
  };
}

describe('e-mail newMessage: liczba załączników (#503)', () => {
  it('pole jest na liście dozwolonych pól workera', () => {
    expect(EMAIL_PAYLOAD_FIELDS.newMessage).toContain('attachmentCount');
  });

  it.each(LOCALES)('%s: liczba w HTML i tekście, bez nazw plików z payloadu', async (locale) => {
    const row = { ...newMessageRow({ attachmentCount: 2, fileName: 'CANARY-plik.pdf', fileNames: ['CANARY-2.png'] }), locale };
    const { locale: loc, data } = buildDeliveryData(row as never, SITE);
    const email = await renderEmail('newMessage', loc, data as never);
    const line = newMessageAttachmentsLabel[locale].replace('{count}', '2');
    expect(email.text).toContain(line);
    expect(email.html).toContain(line.split(':')[0]!);
    expect(`${email.subject}${email.html}${email.text}`).not.toContain('CANARY');
  });

  it.each([0, null, undefined, '', 'x', 4, 1.5, -1])('attachmentCount = %j → bez wiersza', async (value) => {
    expect(messageAttachmentCount(value)).toBeNull();
    const { locale, data } = buildDeliveryData(newMessageRow({ attachmentCount: value }) as never, SITE);
    const email = await renderEmail('newMessage', locale, data as never);
    expect(email.text).not.toContain(newMessageAttachmentsLabel.pl.split(':')[0]!);
  });

  it('liczba jako tekst z JSON (np. "3") jest akceptowana w zakresie 1–3', () => {
    expect(messageAttachmentCount('3')).toBe(3);
    expect(messageAttachmentCount(1)).toBe(1);
  });
});
