import { getTranslations } from 'next-intl/server';

import type { Locale } from '@/i18n/routing';
import type { ConversationThread } from '@/lib/data/messages';
import { threadDisplayName, toMessageViews } from '@/lib/messaging/thread-view';

import { ThreadMessageList } from './ThreadMessageList';

/**
 * MessageThread — wątek jednej konwersacji (makieta „Wiadomości").
 *
 * Serwerowy nagłówek: `<h2>` z nazwą rozmówcy (etykieta regionu wątku — `headingId`, #358)
 * + temat. Lista wiadomości to wyspa kliencka `ThreadMessageList` (najnowsza strona z SSR,
 * „Wczytaj starsze" przez Server Action — #146). Czas formatowany tu, na serwerze.
 * Kompozytor wiadomości dokłada rodzic (osobny komponent kliencki).
 */

export interface MessageThreadProps {
  thread: ConversationThread;
  locale: Locale;
  /** `id` nagłówka `<h2>` — rodzic wskazuje go w `aria-labelledby` regionu wątku. */
  headingId: string;
}

export async function MessageThread({ thread, locale, headingId }: MessageThreadProps) {
  const t = await getTranslations({ locale, namespace: 'messages' });
  const displayName = threadDisplayName(thread, t('title'));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Nagłówek wątku */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <h2 id={headingId} className="truncate text-sm font-semibold text-foreground">
          {displayName}
        </h2>
        {thread.subject && thread.counterpartyName ? (
          <p className="truncate text-xs text-muted-foreground">{thread.subject}</p>
        ) : null}
      </div>

      {/* `key` = nowy stan listy przy zmianie rozmowy (bez przenoszenia starszych stron). */}
      <ThreadMessageList
        key={thread.id}
        locale={locale}
        conversationId={thread.id}
        displayName={displayName}
        initialMessages={toMessageViews(thread.messages, locale)}
        initialOlderCursor={thread.olderCursor}
      />
    </div>
  );
}
