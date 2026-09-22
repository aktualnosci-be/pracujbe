import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/routing';
import {
  getConversations,
  getConversationThread,
  type ConversationThread,
} from '@/lib/data/messages';
import { markConversationRead } from '@/lib/actions/messages';

import { ConversationList } from './ConversationList';
import { MessageThread } from './MessageThread';
import { MessageComposer } from './MessageComposer';

/**
 * MessagesView — współdzielony widok wątku wiadomości panelu (kandydat/pracodawca).
 *
 * Ładuje listę konwersacji (pod sesją/RLS lub DEMO bez env). Gdy `?c=<id>` wskazuje
 * konwersację użytkownika: oznacza ją jako przeczytaną, pobiera wątek i renderuje
 * MessageThread + MessageComposer; inaczej pokazuje stan „wybierz konwersację".
 * Układ 2-kolumnowy na desktopie (lista | wątek), na mobile widoczna lista ALBO wątek.
 *
 * `basePath` to trasa panelu bez prefiksu locale (`/candidate/wiadomosci` lub
 * `/employer/wiadomosci`) — steruje linkami listy i przyciskiem „wróć".
 */

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

  const conversations = await getConversations();

  // Aktywna konwersacja tylko wtedy, gdy należy do użytkownika (jest na jego liście).
  const activeId =
    activeParam && conversations.some((conversation) => conversation.id === activeParam)
      ? activeParam
      : null;

  let thread: ConversationThread | null = null;
  if (activeId) {
    // Otwarcie = oznaczenie przeczytane (idempotentne; RLS w RPC). Potem pobranie wątku.
    await markConversationRead(activeId);
    thread = await getConversationThread(activeId);
  }

  // Po oznaczeniu przeczytania odbij to w liście natychmiast (bez czekania na kolejny render).
  const listItems = conversations.map((conversation) =>
    conversation.id === activeId
      ? { ...conversation, unread: false, unreadCount: 0 }
      : conversation,
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid h-[calc(100vh-14rem)] min-h-[28rem] grid-cols-1 overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-[20rem_1fr]">
        {/* Lista konwersacji — na mobile ukryta, gdy otwarty wątek */}
        <aside
          className={cn(
            'min-h-0 overflow-y-auto border-border lg:block lg:border-r',
            activeId ? 'hidden' : 'block',
          )}
        >
          <ConversationList
            items={listItems}
            activeId={activeId}
            basePath={basePath}
            locale={locale}
          />
        </aside>

        {/* Wątek — na mobile ukryty, gdy nic nie wybrano */}
        <section
          className={cn('min-h-0 flex-col', activeId ? 'flex' : 'hidden lg:flex')}
        >
          {activeId && thread ? (
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
              <MessageThread thread={thread} locale={locale} />
              <MessageComposer conversationId={activeId} />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center">
              <p className="text-sm text-muted-foreground">{t('selectConversation')}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
