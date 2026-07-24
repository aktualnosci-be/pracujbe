import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { StatusPill } from '@/components/ui/status-pill';
import { ApplicationActions } from '@/components/candidate/ApplicationActions';
import { getMyApplications } from '@/lib/data/candidate';

/**
 * Panel kandydata — Moje aplikacje (pełna lista; makieta 04, sekcja „Moje aplikacje").
 *
 * Dane realne pod sesją (RLS) z `getMyApplications`; bez env te same struktury z danymi DEMO.
 * NOINDEX + guard dziedziczone z `candidate/layout.tsx`. Wiersze bez literałów (i18n `dashboard`).
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return {
    title: t('navApplications'),
    robots: { index: false, follow: false },
  };
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

export default async function CandidateApplicationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const applications = await getMyApplications(locale);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('navApplications')}</h1>

      <section className="rounded-lg border border-border bg-card">
        {applications.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground sm:px-5">{t('emptyState')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {applications.map((app) => {
              const date = formatDate(app.date, locale);
              return (
                <li key={app.id} className="flex items-center gap-3 p-4 sm:px-5">
                  <div className="min-w-0 flex-1">
                    {app.slug ? (
                      <Link
                        href={`/oferty-pracy/${app.slug}`}
                        className="truncate text-sm font-medium text-foreground hover:text-accent hover:underline"
                      >
                        {app.jobTitle || '—'}
                      </Link>
                    ) : (
                      <p className="truncate text-sm font-medium text-foreground">
                        {app.jobTitle || '—'}
                      </p>
                    )}
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
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
                  <ApplicationActions applicationId={app.id} status={app.status} slug={app.slug} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
