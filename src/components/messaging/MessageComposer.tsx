'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { sendMessage } from '@/lib/actions/messages';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { MESSAGE_BODY_MAX_LENGTH } from '@/lib/validation/message';

/**
 * MessageComposer — pole tworzenia wiadomości (Etap 6).
 *
 * Komponent kliencki: wysyła przez server action `sendMessage(conversationId, body)`.
 * W trakcie zapisu pole jest `readOnly` + `aria-busy` (NIE `disabled` — to zdejmowało fokus,
 * #335), a przycisk zablokowany: bez podwójnego wysłania (Invariant #11). Po sukcesie:
 * czyszczenie pola, fokus zostaje w polu, `router.refresh()` (odświeża wątek RSC).
 * Limit długości = `MESSAGE_BODY_MAX_LENGTH` (CHECK w bazie), z licznikiem powiązanym przez
 * `aria-describedby`. Błąd przy polu z klucza i18n wg kodu (Invariant #8), treść zostaje.
 * Enter = wyślij, Shift+Enter = nowa linia. Etykieta: „Wiadomość do {rozmówca}" (#358).
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
    startTransition(async () => {
      try {
        const result = await sendMessage(conversationId, body);
        if (result.ok) {
          setValue('');
          router.refresh();
        } else {
          setError(errorMessage(result.error, body.length));
        }
      } catch {
        setError(t('sendError'));
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
    <div className="shrink-0 border-t border-border p-3">
      <label htmlFor={fieldId} className="sr-only">
        {t('composerLabel', { name: recipientName })}
      </label>
      <div className="flex items-end gap-2">
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
          className="min-h-[2.75rem] flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent read-only:opacity-60 aria-[invalid=true]:border-error"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled}
          className={cn(
            'inline-flex h-12 shrink-0 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          <Send className="size-4" aria-hidden="true" />
          <span>{pending ? t('sending') : t('send')}</span>
        </button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      ) : null}
      <p id={counterId} className="mt-1 text-xs text-muted-foreground">
        {t('composerCounter', { count: value.length, max: MESSAGE_BODY_MAX_LENGTH })}
      </p>
    </div>
  );
}
