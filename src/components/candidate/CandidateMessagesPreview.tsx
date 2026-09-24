import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { CandidateSectionError } from '@/components/candidate/CandidateSectionError';
import type { CandidateSectionLoad, LatestMessage } from '@/lib/data/candidate';

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
    <section className="min-w-0 rounded-[1.75rem] border border-border bg-card">
      <div className="rounded-t-[1.75rem] border-b border-border bg-soft p-5 sm:px-6">
        <h2 className="text-xl font-bold text-foreground">{labels.title}</h2>
      </div>
      {result.status === 'error' ? (
        <CandidateSectionError message={labels.loadError} retry={labels.retry} />
      ) : result.items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground sm:px-5">{labels.empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {result.items.map((msg) => (
            <li key={msg.id} className="min-w-0">
              {/* Cała pozycja otwiera rozmowę (#340); stan nieprzeczytania dostępny tekstowo. */}
              <Link
                href={`/candidate/wiadomosci?c=${encodeURIComponent(msg.id)}`}
                className="flex min-h-11 min-w-0 gap-3 p-5 transition-colors hover:bg-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:px-6"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-soft text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                  aria-hidden="true"
                >
                  {initials(msg.title)}
                </span>
                <span className="block min-w-0 flex-1">
                  <span className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 break-words text-sm font-semibold text-foreground">{msg.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatShort(msg.time, locale)}
                    </span>
                  </span>
                  <span className="mt-1 block break-words text-sm text-muted-foreground">{msg.preview}</span>
                </span>
                {msg.unread ? (
                  <>
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                    <span className="sr-only">{labels.unread}</span>
                  </>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-border p-3">
        <Button asChild variant="outline" className="min-h-12 w-full whitespace-normal rounded-xl text-center">
          <Link href="/candidate/wiadomosci">{labels.seeAll}</Link>
        </Button>
      </div>
    </section>
  );
}
