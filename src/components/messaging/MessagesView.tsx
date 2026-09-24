import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/routing';
import {
  getConversationsResult,
  getConversationThread,
  type ConversationThreadResult,
} from '@/lib/data/messages';
import { markConversationRead } from '@/lib/actions/messages';
import { threadDisplayName } from '@/lib/messaging/thread-view';
import { captureError } from '@/lib/sentry';

import { ConversationList } from './ConversationList';
import { MessageThread } from './MessageThread';
import { MessageComposer } from './MessageComposer';
import { ThreadRetryButton } from './ThreadRetryButton';

/**
 * MessagesView — współdzielony widok wątku wiadomości panelu (kandydat/pracodawca).
 *
 * Ładuje listę konwersacji (pod sesją/RLS lub DEMO bez env). Gdy `?c=<id>` wskazuje
 * konwersację użytkownika: oznacza ją jako przeczytaną, pobiera wątek i renderuje
 * MessageThread + MessageComposer; brak dostępu i awaria mają osobne stany.
 * Układ 2-kolumnowy na desktopie (lista | wątek), na mobile widoczna lista ALBO wątek.
 *
 * `basePath` to trasa panelu bez prefiksu locale (`/candidate/wiadomosci` lub
 * `/employer/wiadomosci`) — steruje linkami listy i przyciskiem „wróć".
 */

const LIST_HEADING_ID = 'conversations-heading';
const THREAD_HEADING_ID = 'thread-heading';

export interface MessagesViewProps {
  locale: Locale;
  basePath: string;
  /** Wartość `?c` z `searchParams` (może wskazywać nieistniejącą/cudzą konwersację). */
  activeParam?: string;
}

export async function MessagesView({
  locale,
  basePath,
  activeParam,
}: MessagesViewProps) {
  const t = await getTranslations({ locale, namespace: 'messages' });

  const result = await getConversationsResult(locale);
  const conversations = result.items;

  // Aktywna konwersacja tylko wtedy, gdy należy do użytkownika (jest na jego liście).
  const activeId =
    activeParam && conversations.some((conversation) => conversation.id === activeParam)
      ? activeParam
      : null;

  let threadResult: ConversationThreadResult = { status: 'not-found' };
  let markedRead = false;
  if (activeId) {
    threadResult = await getConversationThread(activeId, locale);
    if (threadResult.status === 'ready') {
      // Oznaczamy tylko wątek, który udało się odczytać; licznik zmieniamy po sukcesie RPC.
      try {
        markedRead = (await markConversationRead(activeId)).ok;
      } catch (error) {
        captureError(error, { area: 'messages.markConversationRead' });
      }
    }
  }

  const showThreadPanel = result.status === 'ready' && Boolean(activeParam);
  const threadReady = showThreadPanel && threadResult.status === 'ready';

  // Po udanym oznaczeniu przeczytania odbij to w liście natychmiast.
  const listItems = conversations.map((conversation) =>
    markedRead && conversation.id === activeId
      ? { ...conversation, unread: false, unreadCount: 0 }
      : conversation,
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid min-h-[28rem] grid-cols-1 overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:h-[calc(100vh-14rem)] lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
        {/* Lista konwersacji — nazwany region (nie drugi nienazwany `complementary`, #358);
            na mobile ukryta, gdy otwarty wątek */}
        <section
          aria-labelledby={LIST_HEADING_ID}
          className={cn(
            'min-h-0 overflow-y-auto border-border lg:block lg:border-r',
            showThreadPanel ? 'hidden' : 'block',
          )}
        >
          <h2 id={LIST_HEADING_ID} className="sr-only">
            {t('conversationsHeading')}
          </h2>
          {result.status === 'error' ? (
            <div role="alert" className="p-6 text-center">
              <p className="text-base font-semibold text-foreground">{t('loadError')}</p>
              <p className="mt-2 text-sm text-muted-foreground">{t('loadErrorHint')}</p>
              <Link href={basePath} className="mt-4 inline-flex min-h-12 items-center rounded-xl border border-border px-4 font-semibold text-foreground hover:bg-soft">
                {t('retry')}
              </Link>
            </div>
          ) : <ConversationList
            items={listItems}
            activeId={activeId}
            basePath={basePath}
            locale={locale}
          />}
        </section>

        {/* Wątek — na mobile ukryty, gdy nic nie wybrano */}
        {/* Region wątku nazwany nagłówkiem `<h2>` z nazwą rozmówcy (#358). */}
        <section
          aria-labelledby={threadReady ? THREAD_HEADING_ID : undefined}
          className={cn('min-h-0 flex-col', showThreadPanel ? 'flex' : 'hidden lg:flex')}
        >
          {showThreadPanel ? (
            <>
              {/* Powrót do listy — tylko mobile */}
              <div className="shrink-0 border-b border-border p-2 lg:hidden">
                <Link
                  href={basePath}
                  className="inline-flex min-h-12 max-w-full items-center gap-1.5 rounded-md px-3 py-2 text-base font-medium whitespace-normal text-accent hover:underline"
                >
                  <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{t('back')}</span>
                </Link>
              </div>
              {threadResult.status === 'ready' && activeId ? (
                <>
                  <MessageThread
                    thread={threadResult.thread}
                    locale={locale}
                    headingId={THREAD_HEADING_ID}
                  />
                  <MessageComposer
                    conversationId={activeId}
                    recipientName={threadDisplayName(threadResult.thread, t('title'))}
                  />
                </>
              ) : (
                <div role={threadResult.status === 'error' ? 'alert' : undefined} className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                  <p className="text-base font-semibold text-foreground">
                    {threadResult.status === 'error' ? t('threadLoadError') : t('threadUnavailable')}
                  </p>
                  {threadResult.status === 'error' && activeId ? (
                    <>
                      <p className="text-sm text-muted-foreground">{t('threadLoadErrorHint')}</p>
                      <ThreadRetryButton label={t('retry')} />
                    </>
                  ) : null}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center">
              <p className="text-base text-muted-foreground">{t('selectConversation')}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
