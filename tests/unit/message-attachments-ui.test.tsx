import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

const { sendMessage, refresh, uploadMessageAttachment, discardMessageAttachment, prepareMessageAttachmentDownload } =
  vi.hoisted(() => ({
    sendMessage: vi.fn(),
    refresh: vi.fn(),
    uploadMessageAttachment: vi.fn(),
    discardMessageAttachment: vi.fn(),
    prepareMessageAttachmentDownload: vi.fn(),
  }));
vi.mock('@/lib/actions/messages', () => ({ sendMessage }));
vi.mock('@/lib/actions/message-attachments', () => ({
  uploadMessageAttachment,
  discardMessageAttachment,
  prepareMessageAttachmentDownload,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { MessageAttachmentList } from '@/components/messaging/MessageAttachmentList';
import { MessageComposer } from '@/components/messaging/MessageComposer';

/**
 * Załączniki w UI (0119): upload od razu po wyborze pliku, blokada wysyłki w trakcie, reguły
 * pliku przed wysłaniem bajtów, ponowienie tym samym kluczem, wysyłka z identyfikatorami
 * gotowych plików; w wątku — pobranie przez krótki link i stan kwarantanny.
 */

const CONV = '00000000-0000-4000-8000-000000000001';
const translations = { pl, nl, fr, en } as const;
const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]));

function renderComposer(locale: keyof typeof translations = 'pl') {
  return render(
    <NextIntlClientProvider locale={locale} messages={translations[locale]}>
      <MessageComposer conversationId={CONV} recipientName="Anna Nowak" />
    </NextIntlClientProvider>,
  );
}

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

async function choose(...files: File[]): Promise<void> {
  await act(async () => {
    fireEvent.change(fileInput(), { target: { files } });
  });
}

const png = (name = 'zdjecie.png', size = 10) => new File([new Uint8Array(size)], name, { type: 'image/png' });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MessageComposer — załączniki', () => {
  it.each(['pl', 'nl', 'fr', 'en'] as const)('przycisk „Dołącz plik” z opisem formatów: %s', (locale) => {
    renderComposer(locale);
    const m = translations[locale].messages;
    const button = screen.getByRole('button', { name: m.attachFile });
    expect(button).toHaveAccessibleDescription(fill(m.attachHint, { max: 3 }));
    expect(fileInput()).toHaveAttribute('accept', '.pdf,.doc,.docx,.jpg,.jpeg,.png');
  });

  it('wysyła gotowy plik z pustą treścią; w trakcie uploadu wysyłka zablokowana', async () => {
    let finish!: (value: unknown) => void;
    uploadMessageAttachment.mockReturnValue(new Promise((r) => { finish = r; }));
    sendMessage.mockResolvedValue({ ok: true, id: 'm-1' });
    renderComposer();
    await choose(png());
    const send = screen.getByRole('button', { name: pl.messages.send });
    expect(screen.getByRole('status')).toHaveTextContent(pl.messages.attachmentUploading);
    expect(send).toBeDisabled();
    const form = uploadMessageAttachment.mock.calls[0]![0] as FormData;
    expect(form.get('conversationId')).toBe(CONV);
    expect(form.get('clientUploadId')).toMatch(/^[0-9a-f-]{36}$/);

    await act(async () => { finish({ ok: true, id: 'att-1' }); });
    expect(send).toBeEnabled();
    await act(async () => { fireEvent.click(send); });
    expect(sendMessage).toHaveBeenCalledWith(CONV, '', expect.stringMatching(/^[0-9a-f-]{36}$/), ['att-1']);
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole('list', { name: pl.messages.attachmentsLabel })).toBeNull();
  });

  it('plik za duży albo w złym formacie — komunikat przy pliku, bez uploadu', async () => {
    renderComposer();
    await choose(png('duzy.png', 5 * 1024 * 1024 + 1), new File(['x'], 'a.gif', { type: 'image/gif' }));
    const alerts = screen.getAllByRole('alert').map((node) => node.textContent);
    expect(alerts).toContain(pl.files.errorTooLarge);
    expect(alerts).toContain(pl.messages.attachmentErrorType);
    expect(uploadMessageAttachment).not.toHaveBeenCalled();
    // Kontrola ujemna: błędny plik blokuje wysyłkę, dopóki go nie usunięto.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Treść' } });
    expect(screen.getByRole('button', { name: pl.messages.send })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: fill(pl.messages.attachmentRemove, { name: 'duzy.png' }) }));
    fireEvent.click(screen.getByRole('button', { name: fill(pl.messages.attachmentRemove, { name: 'a.gif' }) }));
    expect(screen.getByRole('button', { name: pl.messages.send })).toBeEnabled();
  });

  it.each(['pl', 'nl', 'fr', 'en'] as const)(
    'nazwa pliku z numerem NISS — komunikat przy pliku, bez uploadu (#495): %s',
    async (locale) => {
      renderComposer(locale);
      await choose(png('NISS_85.07.30-033.28.png'));
      expect(screen.getByRole('alert')).toHaveTextContent(translations[locale].messages.attachmentSensitiveId);
      expect(uploadMessageAttachment).not.toHaveBeenCalled();
    },
  );

  it('błąd serwera sensitiveId → ten sam komunikat przy pliku (kontrola ujemna: zwykła nazwa idzie do uploadu)', async () => {
    uploadMessageAttachment.mockResolvedValue({ ok: false, error: 'VALIDATION_FAILED', reason: 'sensitiveId' });
    renderComposer();
    await choose(png('skan.png'));
    expect(uploadMessageAttachment).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent(pl.messages.attachmentSensitiveId);
  });

  it('ponowienie nieudanego uploadu używa tego samego klucza operacji', async () => {
    uploadMessageAttachment.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ok: true, id: 'att-2' });
    renderComposer();
    await choose(png());
    expect(screen.getByRole('alert')).toHaveTextContent(pl.messages.attachmentUploadError);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: pl.messages.retry })); });
    const key = (call: number) => (uploadMessageAttachment.mock.calls[call]![0] as FormData).get('clientUploadId');
    expect(key(1)).toBe(key(0));
  });

  it('najwyżej 3 pliki — nadmiar z komunikatem; usunięcie gotowego pliku woła discard', async () => {
    uploadMessageAttachment.mockImplementation(async (form: FormData) => ({ ok: true, id: `id-${String((form.get('file') as File).name)}` }));
    discardMessageAttachment.mockResolvedValue({ ok: true });
    renderComposer();
    await choose(png('1.png'), png('2.png'), png('3.png'), png('4.png'));
    expect(uploadMessageAttachment).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('alert')).toHaveTextContent(fill(pl.messages.attachmentLimit, { max: 3 }));
    expect(screen.getByRole('button', { name: pl.messages.attachFile })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: fill(pl.messages.attachmentRemove, { name: '2.png' }) }));
    expect(discardMessageAttachment).toHaveBeenCalledWith('id-2.png');
    const list = screen.getByRole('list', { name: pl.messages.attachmentsLabel });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('MessageAttachmentList', () => {
  function renderList(downloadable = true) {
    return render(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <MessageAttachmentList
          attachments={[{ id: 'att-1', fileName: 'umowa.pdf', mimeType: 'application/pdf', sizeBytes: 2048, downloadable }]}
        />
      </NextIntlClientProvider>,
    );
  }

  it('klik pobiera krótki link i przechodzi do trasy aplikacji', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    prepareMessageAttachmentDownload.mockResolvedValue({ ok: true, url: '/api/files/message/att-1?t=signed' });
    renderList();
    const button = screen.getByRole('button', { name: /umowa\.pdf/ });
    await act(async () => { fireEvent.click(button); });
    expect(prepareMessageAttachmentDownload).toHaveBeenCalledWith('att-1');
    expect(assign).toHaveBeenCalledWith('/api/files/message/att-1?t=signed');
    vi.unstubAllGlobals();
  });

  it('błąd linku → komunikat przy pliku', async () => {
    prepareMessageAttachmentDownload.mockResolvedValue({ ok: false, error: 'NOT_FOUND' });
    renderList();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /umowa\.pdf/ })); });
    expect(screen.getByRole('alert')).toHaveTextContent(pl.messages.attachmentDownloadError);
  });

  it('plik w kwarantannie: nazwa bez przycisku pobrania', () => {
    renderList(false);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(pl.messages.attachmentUnavailable)).toBeInTheDocument();
  });
});
