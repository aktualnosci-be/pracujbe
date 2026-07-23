import { getTranslations } from 'next-intl/server';

import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/routing';
import type { ConversationThread } from '@/lib/data/messages';

/**
 * MessageThread — prezentacyjny wątek jednej konwersacji (makieta „Wiadomości").
 *
 * Serwerowy komponent: nagłówek (temat + druga strona), lista dymków (moje po prawej,
 * pozostałe po lewej), etykieta systemowa dla wiadomości `isSystem`, czas wg `locale`
 * (Intl) oraz pusty stan wątku. Teksty chrome z i18n (`messages`). Kompozytor wiadomości
 * dokłada rodzic (osobny komponent kliencki).
 */

export interface MessageThreadProps {
  thread: ConversationThread;
  locale: Locale;
}

/** Godzina + krótka data wiadomości wg locale. */
function formatTime(iso: string, locale: Locale): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ts);
}

export async function MessageThread({
  thread,
  locale,
}: MessageThreadProps) {
  const t = await getTranslations({ locale, namespace: 'messages' });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Nagłówek wątku */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <p className="truncate text-sm font-semibold text-foreground">
          {thread.counterpartyName || thread.subject || t('title')}
        </p>
        {thread.subject && thread.counterpartyName ? (
          <p className="truncate text-xs text-muted-foreground">{thread.subject}</p>
        ) : null}
      </div>

      {/* Lista wiadomości */}
      {thread.messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="text-sm text-muted-foreground">{t('threadEmpty')}</p>
        </div>
      ) : (
        <ul className="flex-1 space-y-3 overflow-y-auto p-4">
          {thread.messages.map((message) => {
            if (message.isSystem) {
              return (
                <li key={message.id} className="flex justify-center">
                  <div className="max-w-[85%] rounded-full bg-soft px-3 py-1 text-center text-xs text-muted-foreground">
                    <span className="font-medium">{t('systemLabel')}</span>
                    {' · '}
                    {message.body}
                  </div>
                </li>
              );
            }
            return (
              <li
                key={message.id}
                className={cn('flex flex-col', message.mine ? 'items-end' : 'items-start')}
              >
                <div
                  className={cn(
                    'max-w-[85%] rounded-lg px-3 py-2 text-sm leading-snug sm:max-w-[70%]',
                    message.mine
                      ? 'rounded-br-sm bg-primary text-primary-foreground'
                      : 'rounded-bl-sm bg-soft text-foreground',
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                </div>
                <span className="mt-1 px-1 text-[11px] text-muted-foreground">
                  {message.mine ? t('you') : message.senderName}
                  {' · '}
                  {formatTime(message.createdAt, locale)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
