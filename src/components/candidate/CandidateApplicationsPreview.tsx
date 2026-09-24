import { Link } from '@/i18n/navigation';
import { StatusPill } from '@/components/ui/status-pill';
import { ApplicationActions } from '@/components/candidate/ApplicationActions';
import { CandidateSectionError } from '@/components/candidate/CandidateSectionError';
import type { CandidateSectionLoad, MyApplication } from '@/lib/data/candidate';
import { ArrowRight } from 'lucide-react';
import { EMPTY, PANEL, PANEL_H2, ROW, ROW_META, ROW_TITLE, SECTION_HEAD, TEXT_LINK } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

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
    <section className={PANEL}>
      <div className={SECTION_HEAD}>
        <h2 className={PANEL_H2}>{labels.title}</h2>
        <Link href="/candidate/aplikacje" className={TEXT_LINK}>
          {labels.seeAll}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      {result.status === 'error' ? (
        <CandidateSectionError message={labels.loadError} retry={labels.retry} />
      ) : result.items.length === 0 ? (
        <p className={EMPTY}>{labels.empty}</p>
      ) : (
        <ul className="min-w-0">
          {result.items.map((app) => {
            const date = formatDate(app.date, locale);
            return (
              <li key={app.id} className={cn(ROW, 'flex-wrap items-start')}>
                <div className="min-w-0 flex-1">
                  {app.slug ? (
                    <h3 className={ROW_TITLE}>
                      <Link
                        href={`/oferty-pracy/${app.slug}`}
                        className="break-words hover:text-primary hover:underline"
                      >
                        {app.jobTitle || '—'}
                      </Link>
                    </h3>
                  ) : (
                    <h3 className={ROW_TITLE}>{app.jobTitle || '—'}</h3>
                  )}
                  <p className={ROW_META}>
                    {app.companyName ? (
                      <>
                        {app.companyName} <span aria-hidden="true">·</span> {date}
                      </>
                    ) : (
                      date
                    )}
                  </p>
                </div>
                <StatusPill status={app.status} className="shrink-0 rounded-[8px] px-3 py-2" />
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
