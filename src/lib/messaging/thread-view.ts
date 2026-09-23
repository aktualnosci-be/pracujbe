import type { ConversationThread, ThreadMessage } from '@/lib/data/messages';

/**
 * Wiadomość gotowa do renderu w kliencie: czas sformatowany PO STRONIE SERWERA (SSR i Server
 * Action używają tego samego formatera), aby hydratacja nie zmieniała etykiet przez strefę
 * czasową przeglądarki.
 */
export interface ThreadMessageView extends ThreadMessage {
  timeLabel: string;
}

/** Godzina + krótka data wiadomości wg locale. */
export function formatMessageTime(iso: string, locale: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ts);
}

export function toMessageViews(messages: ThreadMessage[], locale: string): ThreadMessageView[] {
  return messages.map((message) => ({
    ...message,
    timeLabel: formatMessageTime(message.createdAt, locale),
  }));
}

/**
 * Scala wczytane wiadomości (starsze strony + odświeżona najnowsza strona) bez duplikatów,
 * w stabilnej kolejności chronologicznej `(createdAt, id)` — ta sama co kursor w bazie.
 */
export function mergeThreadMessages(
  current: ThreadMessageView[],
  incoming: ThreadMessageView[],
): ThreadMessageView[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => {
    const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (byTime !== 0) return byTime;
    // `Date` gubi mikrosekundy PostgreSQL — ten sam format ISO porównujemy leksykalnie.
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    // UUID małymi literami: kolejność leksykalna = kolejność `uuid` w PostgreSQL.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Nazwa rozmowy do nagłówka i etykiet: rozmówca → temat → ogólny tytuł. */
export function threadDisplayName(
  thread: Pick<ConversationThread, 'counterpartyName' | 'subject'>,
  fallback: string,
): string {
  return thread.counterpartyName || thread.subject || fallback;
}
