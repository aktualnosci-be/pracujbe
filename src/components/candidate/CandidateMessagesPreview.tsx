import { Link } from '@/i18n/navigation';
import { CandidateSectionError } from '@/components/candidate/CandidateSectionError';
import type { CandidateSectionLoad, LatestMessage } from '@/lib/data/candidate';
import { BTN_SECONDARY, EMPTY, ICON_BOX, PANEL, PANEL_H2, SECTION_HEAD } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

interface Labels {
  title: string;
  empty: string;
  loadError: string;
  retry: string;
  seeAll: string;
  /** Tekstowy odpowiednik kropki nieprzeczytania (`messages.unreadBadge`). */
  unread: string;
}

/** Inicjały nadawcy (placeholder avatara). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '•';
}

/** Formatuje czas ostatniej wiadomości do krótkiej postaci wg locale. */
function formatShort(iso: string, locale: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(ts);
}

/** Najnowsze wiadomości na pulpicie: awaria odczytu nigdy nie udaje braku rozmów (#244). */
export function CandidateMessagesPreview({
  result,
  locale,
  labels,
}: {
  result: CandidateSectionLoad<LatestMessage>;
  locale: string;
  labels: Labels;
}) {
  return (
    <section className={PANEL}>
      <div className={SECTION_HEAD}>
        <h2 className={PANEL_H2}>{labels.title}</h2>
      </div>
      {result.status === 'error' ? (
        <CandidateSectionError message={labels.loadError} retry={labels.retry} />
      ) : result.items.length === 0 ? (
        <p className={EMPTY}>{labels.empty}</p>
      ) : (
        <ul className="-mx-2 min-w-0">
          {result.items.map((msg) => (
            <li key={msg.id} className="min-w-0 border-t border-border first:border-t-0">
              {/* Cała pozycja otwiera rozmowę (#340); stan nieprzeczytania dostępny tekstowo. */}
              <Link
                href={`/candidate/wiadomosci?c=${encodeURIComponent(msg.id)}`}
                className="flex min-h-11 min-w-0 gap-3 rounded-[10px] px-2 py-[18px] transition-colors hover:bg-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
              >
                <span
                  className={cn(ICON_BOX, 'size-[42px]')}
                  aria-hidden="true"
                >
                  {initials(msg.title)}
                </span>
                <span className="block min-w-0 flex-1">
                  <span className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 break-words text-[15px] font-semibold tracking-[-0.03em] text-foreground">{msg.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatShort(msg.time, locale)}
                    </span>
                  </span>
                  <span className="mt-1 block break-words text-xs leading-[18px] text-muted-foreground">{msg.preview}</span>
                </span>
                {msg.unread ? (
                  <>
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    <span className="sr-only">{labels.unread}</span>
                  </>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 border-t border-border pt-4">
        <Link href="/candidate/wiadomosci" className={cn(BTN_SECONDARY, 'w-full')}>
          {labels.seeAll}
        </Link>
      </div>
    </section>
  );
}
