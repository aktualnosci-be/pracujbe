'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { loadOlderMessages } from '@/lib/actions/messages';
import type { ThreadCursor } from '@/lib/data/messages';
import { mergeThreadMessages, type ThreadMessageView } from '@/lib/messaging/thread-view';
import { cn } from '@/lib/utils';
import { BTN_SECONDARY } from '@/components/dashboard/panel-styles';
import { BUBBLE, BUBBLE_MINE } from '@/components/candidate/candidate-styles';

import { ReportContentButton } from './ReportContentButton';

/**
 * ThreadMessageList — lista wiadomości wątku ze stronicowaniem od najnowszych (#146).
 *
 * Pierwsza strona (najnowsze wiadomości, chronologicznie) przychodzi z SSR; „Wczytaj starsze"
 * pobiera kolejne strony przez Server Action po kursorze `(created_at, id)` i dokleja je NA
 * POCZĄTEK, zachowując pozycję przewinięcia. Odświeżenie trasy po wysłaniu wiadomości scala
 * nową najnowszą stronę z już wczytanymi (bez luk i duplikatów). Błąd doładowania ma jawny
 * stan `role="alert"` + ponowienie — nie jest przedstawiany jako początek rozmowy.
 *
 * Dostępność (#358): lista nazwana „Wiadomości z {rozmówca}", w każdej pozycji nadawca i czas
 * są PRZED treścią w DOM (wizualnie pod dymkiem dzięki `order-last`).
 */

export interface ThreadMessageListProps {
  locale: string;
  conversationId: string;
  /** Nazwa rozmówcy (lub tematu) — etykieta listy wiadomości. */
  displayName: string;
  initialMessages: ThreadMessageView[];
  initialOlderCursor: ThreadCursor | null;
  /** Wiadomości z otwartym zgłoszeniem bieżącego użytkownika (0113). */
  reportedMessageIds?: string[];
}

export function ThreadMessageList({
  locale,
  conversationId,
  displayName,
  initialMessages,
  initialOlderCursor,
  reportedMessageIds = [],
}: ThreadMessageListProps): React.JSX.Element {
  const t = useTranslations('messages');
  const [messages, setMessages] = React.useState(initialMessages);
  const [olderCursor, setOlderCursor] = React.useState(initialOlderCursor);
  const [loadedOlder, setLoadedOlder] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const startRef = React.useRef<HTMLParagraphElement>(null);
  /** Wysokość/pozycja przewinięcia sprzed doklejenia starszej strony. */
  const prependAnchor = React.useRef<{ height: number; top: number } | null>(null);
  const focusStart = React.useRef(false);
  const newestId = React.useRef<string | null>(null);

  // `router.refresh()` (np. po wysłaniu) daje nową najnowszą stronę — scal ją z wczytanymi.
  // Kursor zostaje przy najstarszej wczytanej wiadomości, chyba że lista była pusta.
  React.useEffect(() => {
    setMessages((current) => mergeThreadMessages(current, initialMessages));
    setOlderCursor((current) => current ?? initialOlderCursor);
  }, [initialMessages, initialOlderCursor]);

  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = prependAnchor.current;
    const last = messages[messages.length - 1]?.id ?? null;
    if (el && anchor) {
      // Starsza strona nad widokiem: zachowaj to, co użytkownik właśnie czytał.
      el.scrollTop = el.scrollHeight - anchor.height + anchor.top;
      prependAnchor.current = null;
    } else if (el && last !== newestId.current) {
      // Pierwsze otwarcie lub nowa wiadomość: pokaż najnowszą.
      el.scrollTop = el.scrollHeight;
    }
    newestId.current = last;
    if (focusStart.current && startRef.current) {
      // Przycisk zniknął (koniec historii) — fokus nie może spaść na <body>.
      startRef.current.focus();
      focusStart.current = false;
    }
  }, [messages, olderCursor]);

  function loadOlder(): void {
    if (!olderCursor || pending) return;
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await loadOlderMessages(locale, conversationId, olderCursor);
        if (result.status !== 'ready') {
          setFailed(true);
          return;
        }
        const el = scrollRef.current;
        if (el) prependAnchor.current = { height: el.scrollHeight, top: el.scrollTop };
        focusStart.current = result.olderCursor === null;
        setMessages((current) => mergeThreadMessages(current, result.messages));
        setOlderCursor(result.olderCursor);
        setLoadedOlder(true);
      } catch {
        setFailed(true);
      }
    });
  }

  // #355: nadawca zawsze podpisany — profil niewidoczny pod RLS → nazwa firmy z danych albo
  // neutralna etykieta strony (bez imienia rekrutera); nigdy wiszący separator „ · ".
  function senderLine(message: ThreadMessageView): string {
    const sender = message.mine
      ? t('you')
      : message.senderName ||
        t(message.senderSide === 'company' ? 'senderCompanyFallback' : 'senderCandidateFallback');
    return [sender, message.timeLabel].filter(Boolean).join(' · ');
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">{t('threadEmpty')}</p>
      </div>
    );
  }

  return (
    <div
        ref={scrollRef}
        // Przewijany obszar z fokusem klawiatury (WCAG 2.1.1, axe `scrollable-region-focusable`):
        // dymki `.bubble` z prototypu są wyższe, więc wątek szybciej wymaga przewijania.
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto px-7 py-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-[600px]:px-5"
      >
      {failed || olderCursor || loadedOlder ? (
        <div className="mb-3 flex flex-col items-center gap-2 text-center">
          {failed ? (
            <p role="alert" className="text-sm text-error">
              {t('loadOlderError')}
            </p>
          ) : null}
          {olderCursor ? (
            <button
              type="button"
              onClick={loadOlder}
              aria-busy={pending}
              aria-disabled={pending}
              className={cn(BTN_SECONDARY, 'aria-disabled:opacity-60')}
            >
              {pending ? t('loadingOlder') : failed ? t('retry') : t('loadOlder')}
            </button>
          ) : loadedOlder ? (
            <p ref={startRef} tabIndex={-1} className="text-xs text-muted-foreground focus:outline-none">
              {t('threadStart')}
            </p>
          ) : null}
        </div>
      ) : null}

      <ul aria-label={t('threadListLabel', { name: displayName })} className="flex flex-col gap-4">
        {messages.map((message) => {
          if (message.isSystem) {
            return (
              <li key={message.id} className="flex justify-center">
                <div className="max-w-[85%] rounded-[8px] bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
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
              {/* Nadawca i czas PRZED treścią w DOM (czytnik), wizualnie pod dymkiem. */}
              <span className="order-last mt-1.5 px-1 text-[11px] text-muted-foreground">
                {senderLine(message)}
              </span>
              {/* `.bubble` / `.bubble.mine` z prototypu „04 Ludzie i praca”. */}
              <div className={message.mine ? BUBBLE_MINE : BUBBLE}>
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
              </div>
              {/* Zgłoszenie wiadomości drugiej strony (0113) — po treści w DOM, wizualnie pod podpisem. */}
              {!message.mine ? (
                <ReportContentButton
                  className="order-last mt-0.5"
                  conversationId={conversationId}
                  messageId={message.id}
                  reported={reportedMessageIds.includes(message.id)}
                  label={t('reportMessageLabel', { sender: senderLine(message) })}
                  quote={message.body}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
