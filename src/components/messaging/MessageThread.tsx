import { getTranslations } from 'next-intl/server';

import type { Locale } from '@/i18n/routing';
import type { ConversationThread, MyMessageReports } from '@/lib/data/messages';
import { threadDisplayName, toMessageViews } from '@/lib/messaging/thread-view';

import { ConversationCompanyBlockControl } from './ConversationCompanyBlockControl';
import { ReportContentButton } from './ReportContentButton';
import { ThreadMessageList } from './ThreadMessageList';
import { CONVERSATION_HEAD } from '@/components/candidate/candidate-styles';
import { ICON_BOX } from '@/components/dashboard/panel-styles';

/** Inicjały rozmówcy (placeholder `.company-icon`). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '•';
}

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
  /** Otwarte zgłoszenia bieżącego użytkownika w tej rozmowie (0116). */
  reports?: MyMessageReports;
  /**
   * Blokada firmy z wątku (#832) — tylko strona kandydacka rozmowy. `MessagesView` przekazuje
   * `true` wyłącznie na `/candidate/wiadomosci`; domyślne `false` jest bezpiecznikiem, gdyby
   * `thread.companyBlock` kiedyś było ustawione po stronie pracodawcy (np. dane DEMO, które nie
   * rozróżniają widza — w przeciwieństwie do odczytu pod sesją, gdzie o tym decyduje RLS).
   */
  allowCompanyBlock?: boolean;
}

export async function MessageThread({
  thread,
  locale,
  headingId,
  reports,
  allowCompanyBlock = false,
}: MessageThreadProps) {
  const t = await getTranslations({ locale, namespace: 'messages' });
  const displayName = threadDisplayName(thread, t('title'));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Nagłówek wątku */}
      {/* `.conversation header` z prototypu: `.company-icon` + nazwa i temat. */}
      <div className="shrink-0 px-7 pt-6 max-[600px]:px-5">
        <div className={CONVERSATION_HEAD}>
          <span className={ICON_BOX} aria-hidden="true">
            {initialsOf(displayName)}
          </span>
          <div className="min-w-0">
            <h2 id={headingId} className="truncate text-[15px] font-bold text-foreground">
              {displayName}
            </h2>
            {thread.subject && thread.counterpartyName ? (
              <p className="mt-1 truncate text-xs text-muted-foreground">{thread.subject}</p>
            ) : null}
          </div>
          <ReportContentButton
            className="ml-auto shrink-0 self-start"
            conversationId={thread.id}
            messageId={null}
            reported={reports?.conversationReported ?? false}
            label={t('reportConversationLabel', { name: displayName })}
          />
        </div>
        {/* Blokada firmy z wątku (#832) — tylko strona kandydacka, gdy firma rozwiązywalna. */}
        {allowCompanyBlock && thread.companyBlock ? (
          <div className="mt-4">
            <ConversationCompanyBlockControl
              companyId={thread.companyBlock.companyId}
              companyName={thread.companyBlock.companyName}
              initialBlocked={thread.companyBlock.blocked}
            />
          </div>
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
        reportedMessageIds={reports?.messageIds ?? []}
      />
    </div>
  );
}
