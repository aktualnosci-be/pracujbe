'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { sendMessage } from '@/lib/actions/messages';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { MESSAGE_BODY_MAX_LENGTH } from '@/lib/validation/message';
import { BTN_PRIMARY, FORM_CONTROL } from '@/components/dashboard/panel-styles';

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
 */

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

  const tooLongMessage = t('composerTooLong', { max: MESSAGE_BODY_MAX_LENGTH });

  function errorMessage(code: ErrorCode, length: number): string {
    if (code === 'VALIDATION_FAILED') {
      return length > MESSAGE_BODY_MAX_LENGTH ? tooLongMessage : tRoot(toUserMessageKey(code));
    }
    if (code === 'RATE_LIMITED' || code === 'PERMISSION_DENIED') return tRoot(toUserMessageKey(code));
    return t('sendError');
  }

  function submit(): void {
    const body = value.trim();
    if (body.length === 0 || pending) return;
    if (body.length > MESSAGE_BODY_MAX_LENGTH) {
      setError(tooLongMessage);
      textareaRef.current?.focus();
      return;
    }
    setError(null);
    if (operationRef.current?.body !== body) {
      operationRef.current = { body, key: crypto.randomUUID() };
    }
    const clientMessageId = operationRef.current.key;
    startTransition(async () => {
      try {
        const result = await sendMessage(conversationId, body, clientMessageId);
        if (result.ok) {
          operationRef.current = null;
          setValue('');
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

  const disabled = pending || value.trim().length === 0;

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
          onClick={submit}
          disabled={disabled}
          className={cn(BTN_PRIMARY, 'shrink-0 disabled:opacity-60')}
        >
          <Send className="size-4" aria-hidden="true" />
          <span>{pending ? t('sending') : t('send')}</span>
        </button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-2 text-[13px] text-error">
          {error}
        </p>
      ) : null}
      <p id={counterId} className="mt-1 text-xs text-muted-foreground">
        {t('composerCounter', { count: value.length, max: MESSAGE_BODY_MAX_LENGTH })}
      </p>
    </div>
  );
}
