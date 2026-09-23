'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { ApplicationActions } from '@/components/candidate/ApplicationActions';
import { StatusPill } from '@/components/ui/status-pill';
import { loadMoreApplications } from '@/lib/actions/candidate-applications';
import type { MyApplication, MyApplicationsPage } from '@/lib/data/candidate';

function formatDate(iso: string, locale: string): string {
  const ts = Date.parse(iso);
  return Number.isNaN(ts)
    ? ''
    : new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(ts);
}

export function CandidateApplicationsList({
  locale,
  initialPage,
}: {
  locale: string;
  initialPage: MyApplicationsPage;
}) {
  const t = useTranslations('dashboard');
  const [items, setItems] = useState(initialPage.items);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const generation = useRef(0);

  // Po zmianie statusu ApplicationActions odświeża trasę; zsynchronizuj karty z nowym SSR.
  useEffect(() => {
    generation.current += 1;
    setItems(initialPage.items);
    setCursor(initialPage.nextCursor);
    setFailed(false);
  }, [initialPage]);

  const loadMore = () => {
    if (!cursor || pending) return;
    const startedAt = generation.current;
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await loadMoreApplications(locale, cursor);
        if (generation.current !== startedAt) return;
        if (result.status === 'error') {
          setFailed(true);
          return;
        }
        // A status change or refresh may have returned an already visible record.
        setItems((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...result.page.items.filter((item) => !seen.has(item.id))];
        });
        setCursor(result.page.nextCursor);
      } catch {
        if (generation.current === startedAt) setFailed(true);
      }
    });
  };

  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-foreground">{t('applicationsEmptyTitle')}</h2>
        <p className="mt-2 text-base text-muted-foreground">{t('applicationsEmptyBody')}</p>
        <Link
          href="/oferty-pracy"
          className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('applicationsFindJobs')}
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <ul className="space-y-4">
        {items.map((app: MyApplication) => {
          const date = formatDate(app.date, locale);
          return (
            <li key={app.id} className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6">
              <article className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    {app.companyName ? (
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{app.companyName}</p>
                    ) : null}
                    <h2 className="break-words text-xl font-semibold leading-snug text-foreground">
                      {app.jobTitle || t('applicationUnknownJob')}
                    </h2>
                    {date ? <p className="text-sm text-muted-foreground">{t('applicationSentOn', { date })}</p> : null}
                  </div>
                  <StatusPill status={app.status} />
                </div>
                <div className="border-t border-border pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('applicationCurrentStatus')}
                  </p>
                  <div className="mt-3 border-l-4 border-primary py-1 pl-4 text-sm font-medium text-foreground">
                    <StatusPill status={app.status} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {app.slug ? (
                    <Link
                      href={`/oferty-pracy/${app.slug}`}
                      className="inline-flex min-h-12 items-center font-semibold text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {t('actionView')}
                    </Link>
                  ) : <span />}
                  <ApplicationActions applicationId={app.id} status={app.status} slug={app.slug} />
                </div>
              </article>
            </li>
          );
        })}
      </ul>
      {failed ? <p role="alert" className="text-base text-error">{t('applicationsMoreError')}</p> : null}
      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          aria-busy={pending}
          className="inline-flex min-h-12 items-center rounded-xl border border-border bg-card px-5 font-semibold text-foreground hover:bg-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
        >
          {pending ? t('applicationsLoading') : failed ? t('candidateListRetry') : t('applicationsMore')}
        </button>
      ) : <p className="text-sm text-muted-foreground">{t('applicationsEnd')}</p>}
    </div>
  );
}
