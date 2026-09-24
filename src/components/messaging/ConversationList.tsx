import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/routing';
import type { ConversationListItem } from '@/lib/data/messages';

import { ConversationOpenPending } from './ConversationOpenPending';

/**
 * ConversationList — prezentacyjna lista konwersacji panelu (makieta „Wiadomości").
 *
 * Serwerowy komponent (bez interakcji): pozycje to `Link` do TEJ SAMEJ trasy panelu
 * z parametrem `?c=<id>` (rodzic wybiera wątek po `searchParams`). Aktywna pozycja
 * (`activeId`) i nieprzeczytane są wizualnie wyróżnione. Pusty stan (brak konwersacji)
 * obsłużony tu — teksty z i18n (`messages`). Czas formatowany wg `locale` (Intl).
 */

export interface ConversationListProps {
  items: ConversationListItem[];
  /** `id` aktywnej konwersacji (podświetlenie). */
  activeId?: string | null;
  /** Ścieżka trasy panelu BEZ prefiksu locale (np. `/candidate/wiadomosci`). */
  basePath: string;
  locale: Locale;
}

/** Krótki, lokalny format czasu ostatniej wiadomości (dzień/miesiąc). */
function formatWhen(iso: string, locale: Locale): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(ts);
}

/** Inicjały drugiej strony (placeholder awatara/logo). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '•';
}

export async function ConversationList({
  items,
  activeId,
  basePath,
  locale,
}: ConversationListProps) {
  const t = await getTranslations({ locale, namespace: 'messages' });

  if (items.length === 0) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-base font-semibold text-foreground">{t('empty')}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('emptyHint')}</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border" aria-label={t('title')}>
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <li key={item.id}>
            <Link
              href={`${basePath}?c=${item.id}`}
              prefetch={false}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'flex min-h-20 gap-3 border-l-4 px-4 py-4 transition-colors hover:bg-soft',
                active ? 'border-primary bg-soft' : 'border-transparent bg-transparent',
              )}
            >
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-soft text-sm font-semibold text-foreground ring-1 ring-inset ring-border"
                aria-hidden="true"
              >
                {initials(item.counterpartyName)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={cn(
                      'truncate text-base',
                      item.unread ? 'font-semibold text-foreground' : 'font-medium text-foreground',
                    )}
                  >
                    {item.counterpartyName || item.subject}
                  </p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatWhen(item.lastMessageAt, locale)}
                  </span>
                </div>
                {/* #355: bez nazwy drugiej strony temat jest już nazwą pozycji — nie powtarzamy go. */}
                {item.subject && item.counterpartyName ? (
                  <p className="truncate text-xs text-muted-foreground">{item.subject}</p>
                ) : null}
                <div className="mt-0.5 flex items-center gap-2">
                  <p
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm',
                      item.unread ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {item.lastPreview}
                  </p>
                  {item.unread ? (
                    <span
                      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-foreground"
                      aria-label={t('unreadBadge')}
                    >
                      {item.unreadCount > 0 ? item.unreadCount : ''}
                    </span>
                  ) : null}
                </div>
                <ConversationOpenPending />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
