import { Link } from '@/i18n/navigation';
import { StatusPill } from '@/components/ui/status-pill';
import { ApplicationActions } from '@/components/candidate/ApplicationActions';
import { CandidateSectionError } from '@/components/candidate/CandidateSectionError';
import type { CandidateSectionLoad, MyApplication } from '@/lib/data/candidate';

interface Labels {
  title: string;
  seeAll: string;
  empty: string;
  loadError: string;
  retry: string;
}

/** Formatuje datę ISO do krótkiej postaci wg locale (bez rzucania na złej wartości). */
function formatDate(iso: string, locale: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(ts);
}

/** Ostatnie zgłoszenia na pulpicie: awaria odczytu nigdy nie udaje braku zgłoszeń (#244). */
export function CandidateApplicationsPreview({
  result,
  locale,
  labels,
}: {
  result: CandidateSectionLoad<MyApplication>;
  locale: string;
  labels: Labels;
}) {
  return (
    <section className="min-w-0 rounded-[1.75rem] border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-[1.75rem] border-b border-border bg-soft p-5 sm:px-7">
        <h2 className="text-xl font-bold text-foreground">{labels.title}</h2>
        <Link
          href="/candidate/aplikacje"
          className="inline-flex min-h-11 items-center break-words text-sm font-semibold text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {labels.seeAll}
        </Link>
      </div>
      {result.status === 'error' ? (
        <CandidateSectionError message={labels.loadError} retry={labels.retry} />
      ) : result.items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground sm:px-5">{labels.empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {result.items.map((app) => {
            const date = formatDate(app.date, locale);
            return (
              <li key={app.id} className="flex min-w-0 flex-wrap items-start gap-3 p-5 sm:px-7">
                <div className="min-w-0 flex-1">
                  {app.slug ? (
                    <Link
                      href={`/oferty-pracy/${app.slug}`}
                      className="block max-w-full break-words text-base font-semibold text-foreground hover:text-accent hover:underline"
                    >
                      {app.jobTitle || '—'}
                    </Link>
                  ) : (
                    <p className="break-words text-base font-semibold text-foreground">
                      {app.jobTitle || '—'}
                    </p>
                  )}
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {app.companyName ? (
                      <>
                        {app.companyName} <span className="text-border">·</span> {date}
                      </>
                    ) : (
                      date
                    )}
                  </p>
                </div>
                <StatusPill status={app.status} className="shrink-0" />
                <ApplicationActions
                  applicationId={app.id}
                  status={app.status}
                  slug={app.slug}
                  jobTitle={app.jobTitle || undefined}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
