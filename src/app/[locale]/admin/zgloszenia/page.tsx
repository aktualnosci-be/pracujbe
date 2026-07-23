import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { listReports } from '@/lib/data/admin';
import { AdminStatusBadge } from '@/components/admin/AdminStatusBadge';
import { ReportActions } from '@/components/admin/ReportActions';

/**
 * Panel administratora — Zgłoszenia (Etap 7g).
 *
 * Lista zgłoszeń (treści/kont) z akcjami rozstrzygnięcia (ReportActions → RPC
 * `admin_resolve_report`, z audytem po stronie DB). Odczyt service-rolem po potwierdzeniu roli
 * admina w layoucie. NOINDEX + `force-dynamic` (dziedziczone z layoutu).
 */

export const dynamic = 'force-dynamic';

/** Etykieta typu celu zgłoszenia (klucz i18n w namespace `admin`). */
const TARGET_LABEL: Record<string, string> = {
  job: 'targetJob',
  company: 'targetCompany',
  user: 'targetUser',
  message: 'targetMessage',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return {
    title: t('reportsTitle'),
    robots: { index: false, follow: false },
  };
}

export default async function AdminReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'admin' });
  const reports = await listReports();

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const formatDate = (iso: string | null): string => (iso ? dateFmt.format(new Date(iso)) : '—');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('reportsTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('reportsSubtitle')}</p>
      </header>

      <section className="rounded-lg border border-border bg-card">
        {reports.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t('reportsEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {reports.map((report) => (
              <li key={report.id} className="space-y-3 p-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-md bg-soft px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {t(TARGET_LABEL[report.targetType] ?? 'targetJob')}
                      </span>
                      <AdminStatusBadge kind="report" status={report.status} />
                    </div>
                    <p className="text-sm font-semibold text-foreground">{report.reason}</p>
                    {report.details ? (
                      <p className="text-sm text-muted-foreground">{report.details}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {t('reportedBy', {
                        name: report.reporterName ?? t('reporterFallback'),
                      })}{' '}
                      <span className="text-border">·</span> {formatDate(report.createdAt)}
                    </p>
                  </div>
                  <ReportActions reportId={report.id} status={report.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
