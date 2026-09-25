'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Paperclip, Send, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { discardMessageAttachment, uploadMessageAttachment } from '@/lib/actions/message-attachments';
import { sendMessage } from '@/lib/actions/messages';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { MESSAGE_BODY_MAX_LENGTH } from '@/lib/validation/message';
import {
  ATTACHMENT_ACCEPT,
  MESSAGE_ATTACHMENTS_MAX,
  checkAttachmentFile,
  type AttachmentFileProblem,
} from '@/lib/validation/message-attachment';
import { BTN_PRIMARY, BTN_SMALL, FORM_CONTROL } from '@/components/dashboard/panel-styles';

/**
 * MessageComposer — pole tworzenia wiadomości (Etap 6).
 *
 * Komponent kliencki: wysyła przez server action `sendMessage(conversationId, body, clientMessageId)`.
 * W trakcie zapisu pole jest `readOnly` + `aria-busy` (NIE `disabled` — to zdejmowało fokus,
 * #335), a przycisk zablokowany: bez podwójnego wysłania (Invariant #11). Po sukcesie:
 * czyszczenie pola, fokus zostaje w polu, `router.refresh()` (odświeża wątek RSC).
 * Limit długości = `MESSAGE_BODY_MAX_LENGTH` (CHECK w bazie), z licznikiem powiązanym przez
 * `aria-describedby`. Błąd przy polu z klucza i18n wg kodu (Invariant #8), treść zostaje.
 * Enter = wyślij, Shift+Enter = nowa linia. Etykieta: „Wiadomość do {rozmówca}" (#358).
 * Klucz idempotencji (#147): jeden UUID na operację wysyłki danej treści; ponowienie tej
 * samej treści po błędzie używa tego samego klucza (retry po utracie odpowiedzi nie dubluje
 * wiadomości), sukces lub zmiana treści zaczyna nową operację.
 * Załączniki (0113): „Dołącz plik” wgrywa każdy plik osobno od razu po wyborze (reguły
 * `checkAttachmentFile` przed wysyłką, każdy upload ma własny stały klucz — ponowienie nie
 * dubluje pliku), a „Wyślij” łączy gotowe pliki z wiadomością w jednej transakcji. W trakcie
 * wgrywania albo przy nieudanym pliku wysyłka jest zablokowana; plik można usunąć lub ponowić.
 */

interface DraftAttachment {
  /** Klucz operacji uploadu (`clientUploadId`) — stały dla ponowień tego pliku. */
  key: string;
  file: File;
  status: 'uploading' | 'ready' | 'error';
  attachmentId?: string;
  error?: string;
}

export interface MessageComposerProps {
  conversationId: string;
  /** Nazwa rozmówcy do etykiety pola. */
  recipientName: string;
}

export function MessageComposer({
  conversationId,
  recipientName,
}: MessageComposerProps): React.JSX.Element {
  const t = useTranslations('messages');
  const tRoot = useTranslations();
  const router = useRouter();
  const fieldId = React.useId();
  const counterId = `${fieldId}-counter`;
  const errorId = `${fieldId}-error`;
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const operationRef = React.useRef<{ body: string; key: string } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const attachHintId = `${fieldId}-attach-hint`;
  const [drafts, setDrafts] = React.useState<DraftAttachment[]>([]);
  const [attachNotice, setAttachNotice] = React.useState<string | null>(null);

  const tooLongMessage = t('composerTooLong', { max: MESSAGE_BODY_MAX_LENGTH });

  function problemMessage(problem: AttachmentFileProblem | undefined): string {
    if (problem === 'tooLarge') return tRoot('files.errorTooLarge');
    if (problem === 'empty') return tRoot('files.errorEmpty');
    if (problem === 'type') return t('attachmentErrorType');
    return t('attachmentUploadError');
  }

  function updateDraft(key: string, patch: Partial<DraftAttachment>): void {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  }

  async function upload(key: string, file: File): Promise<void> {
    const formData = new FormData();
    formData.set('conversationId', conversationId);
    formData.set('clientUploadId', key);
    formData.set('file', file);
    try {
      const result = await uploadMessageAttachment(formData);
      if (result.ok) {
        updateDraft(key, { status: 'ready', attachmentId: result.id, error: undefined });
      } else {
        const message =
          result.error === 'VALIDATION_FAILED' && result.reason
            ? problemMessage(result.reason)
            : result.error === 'RATE_LIMITED' ||
                result.error === 'PERMISSION_DENIED' ||
                result.error === 'DEMO_UNAVAILABLE'
              ? tRoot(toUserMessageKey(result.error))
              : t('attachmentUploadError');
        updateDraft(key, { status: 'error', error: message });
      }
    } catch {
      // Wynik niejednoznaczny: ponowienie użyje tego samego klucza (bez duplikatu pliku).
      updateDraft(key, { status: 'error', error: t('attachmentUploadError') });
    }
  }

  function onFilesChosen(event: React.ChangeEvent<HTMLInputElement>): void {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (chosen.length === 0) return;
    const free = MESSAGE_ATTACHMENTS_MAX - drafts.length;
    setAttachNotice(chosen.length > free ? t('attachmentLimit', { max: MESSAGE_ATTACHMENTS_MAX }) : null);
    const accepted = chosen.slice(0, Math.max(free, 0)).map((file): DraftAttachment => {
      const problem = checkAttachmentFile(file);
      return problem
        ? { key: crypto.randomUUID(), file, status: 'error', error: problemMessage(problem) }
        : { key: crypto.randomUUID(), file, status: 'uploading' };
    });
    if (accepted.length === 0) return;
    setDrafts((current) => [...current, ...accepted]);
    for (const draft of accepted) {
      if (draft.status === 'uploading') void upload(draft.key, draft.file);
    }
  }

  function retryDraft(draft: DraftAttachment): void {
    if (checkAttachmentFile(draft.file)) return;
    updateDraft(draft.key, { status: 'uploading', error: undefined });
    void upload(draft.key, draft.file);
  }

  function removeDraft(draft: DraftAttachment): void {
    setDrafts((current) => current.filter((item) => item.key !== draft.key));
    setAttachNotice(null);
    // Najlepsza próba: niewysłany plik i tak sprząta zadanie konserwacji (0113).
    if (draft.attachmentId) void discardMessageAttachment(draft.attachmentId).catch(() => undefined);
    textareaRef.current?.focus();
  }

  function errorMessage(code: ErrorCode, length: number): string {
    if (code === 'VALIDATION_FAILED') {
      return length > MESSAGE_BODY_MAX_LENGTH ? tooLongMessage : tRoot(toUserMessageKey(code));
    }
    if (code === 'RATE_LIMITED' || code === 'PERMISSION_DENIED') return tRoot(toUserMessageKey(code));
    return t('sendError');
  }

  const readyIds = drafts.flatMap((draft) => (draft.status === 'ready' && draft.attachmentId ? [draft.attachmentId] : []));
  const attachmentsBlocked = drafts.some((draft) => draft.status !== 'ready');

  function submit(): void {
    const body = value.trim();
    if ((body.length === 0 && readyIds.length === 0) || pending || attachmentsBlocked) return;
    if (body.length > MESSAGE_BODY_MAX_LENGTH) {
      setError(tooLongMessage);
      textareaRef.current?.focus();
      return;
    }
    setError(null);
    // Jedna operacja = ta sama treść i te same pliki; zmiana któregokolwiek = nowy klucz.
    const signature = `${body}\u0000${readyIds.join(',')}`;
    if (operationRef.current?.body !== signature) {
      operationRef.current = { body: signature, key: crypto.randomUUID() };
    }
    const clientMessageId = operationRef.current.key;
    const attachmentIds = readyIds;
    startTransition(async () => {
      try {
        const result =
          attachmentIds.length > 0
            ? await sendMessage(conversationId, body, clientMessageId, attachmentIds)
            : await sendMessage(conversationId, body, clientMessageId);
        if (result.ok) {
          operationRef.current = null;
          setValue('');
          setDrafts([]);
          setAttachNotice(null);
          router.refresh();
        } else {
          setError(errorMessage(result.error, body.length));
        }
      } catch {
        // Wynik niejednoznaczny (np. zerwane połączenie): ponowienie użyje tego samego klucza.
        setError(t('sendErrorUncertain'));
      }
      textareaRef.current?.focus();
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  const disabled =
    pending || attachmentsBlocked || (value.trim().length === 0 && readyIds.length === 0);
  const attachDisabled = pending || drafts.length >= MESSAGE_ATTACHMENTS_MAX;

  return (
    <div className="shrink-0 border-t border-border px-7 py-5 max-[600px]:px-5">
      <label htmlFor={fieldId} className="sr-only">
        {t('composerLabel', { name: recipientName })}
      </label>
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <textarea
          ref={textareaRef}
          id={fieldId}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={MESSAGE_BODY_MAX_LENGTH}
          readOnly={pending}
          aria-busy={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${errorId} ${counterId}` : counterId}
          placeholder={t('composerPlaceholder')}
          className={cn(FORM_CONTROL, 'min-w-[12rem] flex-1 basis-60 resize-y read-only:opacity-60')}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={attachDisabled}
          aria-describedby={attachHintId}
          className={cn(BTN_SMALL, 'min-h-[49px] shrink-0 border-[color:var(--pp-line)] text-foreground hover:bg-soft disabled:opacity-60')}
        >
          <Paperclip className="size-4" aria-hidden="true" />
          <span>{t('attachFile')}</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          onChange={onFilesChosen}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled}
          className={cn(BTN_PRIMARY, 'shrink-0 disabled:opacity-60')}
        >
          <Send className="size-4" aria-hidden="true" />
          <span>{pending ? t('sending') : t('send')}</span>
        </button>
      </div>
      {drafts.length > 0 ? (
        <ul aria-label={t('attachmentsLabel')} className="mt-3 flex flex-col gap-2">
          {drafts.map((draft) => (
            <li key={draft.key} className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 break-all text-foreground">{draft.file.name}</span>
              {draft.status === 'uploading' ? (
                <span role="status" className="text-xs text-muted-foreground">
                  {t('attachmentUploading')}
                </span>
              ) : null}
              {draft.status === 'error' ? (
                <span role="alert" className="text-xs text-error">
                  {draft.error}
                </span>
              ) : null}
              {draft.status === 'error' && !checkAttachmentFile(draft.file) ? (
                <button
                  type="button"
                  onClick={() => retryDraft(draft)}
                  className="min-h-11 rounded-[8px] px-2 text-xs font-semibold text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('retry')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => removeDraft(draft)}
                disabled={draft.status === 'uploading' || pending}
                aria-label={t('attachmentRemove', { name: draft.file.name })}
                className="inline-flex size-11 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {attachNotice ? (
        <p role="alert" className="mt-2 text-[13px] text-error">
          {attachNotice}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="mt-2 text-[13px] text-error">
          {error}
        </p>
      ) : null}
      <p id={counterId} className="mt-1 text-xs text-muted-foreground">
        {t('composerCounter', { count: value.length, max: MESSAGE_BODY_MAX_LENGTH })}
      </p>
      <p id={attachHintId} className="mt-0.5 text-xs text-muted-foreground">
        {t('attachHint', { max: MESSAGE_ATTACHMENTS_MAX })}
      </p>
    </div>
  );
}
