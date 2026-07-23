'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { sendMessage } from '@/lib/actions/messages';
import { cn } from '@/lib/utils';

/**
 * MessageComposer — pole tworzenia wiadomości (Etap 6).
 *
 * Komponent kliencki: wysyła przez server action `sendMessage(conversationId, body)`.
 * `useTransition` blokuje pole/przycisk w trakcie zapisu (bez podwójnego wysłania —
 * Invariant #11). Po sukcesie: `router.refresh()` (odświeża wątek RSC) + czyszczenie pola.
 * Błąd → komunikat z i18n (`messages.sendError`, bez technikaliów — Invariant #8).
 * Enter = wyślij, Shift+Enter = nowa linia. Teksty z i18n.
 */

export interface MessageComposerProps {
  conversationId: string;
}

export function MessageComposer({ conversationId }: MessageComposerProps): React.JSX.Element {
  const t = useTranslations('messages');
  const router = useRouter();
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(): void {
    const body = value.trim();
    if (body.length === 0 || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await sendMessage(conversationId, body);
      if (result.ok) {
        setValue('');
        router.refresh();
      } else {
        setError(t('sendError'));
      }
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
      {error ? (
        <p role="alert" className="mb-2 text-sm text-error">
          {error}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          disabled={pending}
          placeholder={t('composerPlaceholder')}
          aria-label={t('composerPlaceholder')}
          className="min-h-[2.75rem] flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled}
          className={cn(
            'inline-flex h-11 shrink-0 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          <Send className="size-4" aria-hidden="true" />
          <span>{pending ? t('sending') : t('send')}</span>
        </button>
      </div>
    </div>
  );
}
