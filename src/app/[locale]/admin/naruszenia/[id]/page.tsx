import type { Metadata } from 'next';
import { ArrowLeft, Download } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import {
  BREACH_EVENT_KEY,
  BREACH_FIELD_LABEL_KEY,
  BREACH_KIND_KEY,
  breachFieldOfColumn,
  breachFormOf,
  type BreachKind,
} from '@/lib/admin/breach';
import { parseUuid } from '@/lib/admin/list-params';
import { getBreachIncident } from '@/lib/data/admin';
import { isPortalDataConfigured } from '@/lib/db/portal';
import { createAppDateFormatter } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { AdminEmptyState, AdminPageHeader } from '@/components/admin/AdminListControls';
import { BreachDeadlineBadge } from '@/components/admin/BreachDeadlineBadge';
import { BreachIncidentForm } from '@/components/admin/BreachIncidentForm';
import { BreachNoticeForm } from '@/components/admin/BreachNoticeForm';
import { BreachStatusActions } from '@/components/admin/BreachStatusActions';
import {
  BTN_SECONDARY,
  PANEL,
  PANEL_H2,
  PANEL_P,
  ROW,
  ROW_META,
  ROW_TITLE,
  SECTION_HEAD,
  STATUS,
  TAG,
  TEXT_LINK,
} from '@/components/admin/admin-styles';

/**
 * Panel administratora — wpis rejestru naruszeń (#490).
 *
 * Stan terminu 72 h (od stwierdzenia), eksport do zgłoszenia (JSON/CSV — każdy eksport
 * zostaje w historii), zamknięcie / ponowne otwarcie, formularz wpisu (zamknięty = podgląd),
 * zawiadomienie osób (tylko otwarte naruszenie z decyzją „zawiadamiamy”) i niezmienna
 * historia zmian (pole: przed → po). Odczyt service-rolem po potwierdzeniu roli admina.
 */

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('breachTitle'), robots: { index: false, follow: false } };
}

function BackLink({ label }: { label: string }) {
  return (
    <Link href="/admin/naruszenia" className={TEXT_LINK}>
      <ArrowLeft className="size-4" aria-hidden="true" />
      {label}
    </Link>
  );
}

export default async function AdminBreachDetailPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  const formatDate = createAppDateFormatter(locale, { withTime: true });
  const result = await getBreachIncident(id);

  if (result.status !== 'ok') {
    return (
      <div className="min-w-0 space-y-[22px]">
        <BackLink label={t('breachBack')} />
        <AdminPageHeader
          eyebrow={t('breachEyebrow')}
          title={result.status === 'not_found' ? t('breachNotFoundTitle') : t('breachTitle')}
          subtitle={result.status === 'not_found' ? t('breachNotFoundHint') : t('breachSubtitle')}
        />
        {result.status === 'error' ? (
          <AdminLoadError retryHref={`/${locale}/admin/naruszenia/${encodeURIComponent(id)}`} />
        ) : null}
      </div>
    );
  }

  const incident = result.incident;
  const open = incident.status === 'open';
  const canNotify = open && incident.kind === 'personal_data_breach' && incident.subjectsDecision === 'notify';
  const exportId = parseUuid(incident.id);
  const exportable = Boolean(exportId) && isPortalDataConfigured();
  const now = Date.now();

  const changeLabel = (column: string): string => {
    const field = breachFieldOfColumn(column);
    return field ? t(BREACH_FIELD_LABEL_KEY[field]) : column;
  };

  return (
    <div className="min-w-0 space-y-[22px]">
      <BackLink label={t('breachBack')} />
      <AdminPageHeader
        eyebrow={`${t('breachEyebrow')} · ${incident.reference}`}
        title={incident.title}
        subtitle={t('breachDetailSubtitle')}
      />

      <section aria-labelledby="breach-state-heading" className={PANEL}>
        <div className={SECTION_HEAD}>
          <h2 id="breach-state-heading" className={PANEL_H2}>
            {t('breachSectionState')}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className={TAG}>{t(BREACH_KIND_KEY[incident.kind as BreachKind] ?? 'statusUnknown')}</span>
            <span className={STATUS}>{open ? t('breachStatusOpen') : t('breachStatusClosed')}</span>
            <BreachDeadlineBadge incident={incident} now={now} />
          </div>
        </div>
        <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('breachFieldDetectedAt')}</dt>
            <dd className="mt-1.5 text-[15px] font-semibold text-foreground">{formatDate(incident.detectedAt)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('breachDeadlineLabel')}</dt>
            <dd className="mt-1.5 text-[15px] font-semibold text-foreground">
              {incident.kind === 'personal_data_breach' && incident.detectedAt
                ? formatDate(new Date(Date.parse(incident.detectedAt) + 72 * 3_600_000).toISOString())
                : '—'}
            </dd>
          </div>
          {incident.closedAt ? (
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">{t('breachClosedAtLabel')}</dt>
              <dd className="mt-1.5 whitespace-pre-line break-words text-[15px] text-foreground">
                {formatDate(incident.closedAt)} — {incident.closureSummary}
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-5">
          <BreachStatusActions
            id={incident.id}
            version={incident.version}
            status={incident.status}
            reference={incident.reference}
          />
          {exportable ? (
            <>
              <a
                href={`/api/admin/breaches/${exportId}/export?format=json`}
                className={BTN_SECONDARY}
              >
                <Download className="size-4" aria-hidden="true" />
                {t('breachExportJson')}
              </a>
              <a
                href={`/api/admin/breaches/${exportId}/export?format=csv`}
                className={BTN_SECONDARY}
              >
                <Download className="size-4" aria-hidden="true" />
                {t('breachExportCsv')}
              </a>
            </>
          ) : null}
        </div>
        <p className={cn(PANEL_P, 'mt-3')}>{t('breachExportHint')}</p>
      </section>

      <BreachIncidentForm
        mode="edit"
        incidentId={incident.id}
        version={incident.version}
        initial={breachFormOf(incident)}
        readOnly={!open}
      />

      <section aria-labelledby="breach-notice-heading" className={PANEL}>
        <h2 id="breach-notice-heading" className={PANEL_H2}>
          {t('breachSectionNotice')}
        </h2>
        <p className={cn(PANEL_P, 'mt-1.5')}>{t('breachSectionNoticeHint')}</p>
        {incident.notices.length > 0 ? (
          <ul className="mt-4 min-w-0">
            {incident.notices.map((notice) => (
              <li key={notice.id} className={ROW}>
                <p className={ROW_META}>
                  <time dateTime={notice.createdAt ?? undefined}>{formatDate(notice.createdAt)}</time>
                  {' — '}
                  {t('breachNoticeSummary', {
                    queued: notice.queuedCount,
                    recipients: notice.recipientCount,
                    locales: notice.locales.join(', ').toUpperCase(),
                  })}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-5">
          {canNotify ? <BreachNoticeForm incidentId={incident.id} /> : <p className={PANEL_P}>{t('breachNoticeNotAllowed')}</p>}
        </div>
      </section>

      <section aria-labelledby="breach-history-heading" className={PANEL}>
        <h2 id="breach-history-heading" className={PANEL_H2}>
          {t('breachSectionHistory')}
        </h2>
        <p className={cn(PANEL_P, 'mt-1.5')}>{t('breachSectionHistoryHint')}</p>
        {incident.events.length === 0 ? (
          <AdminEmptyState message={t('breachHistoryEmpty')} />
        ) : (
          <ol className="mt-4 min-w-0">
            {[...incident.events].reverse().map((event) => {
              const fields = Object.keys(event.changes);
              return (
                <li key={event.id} className={ROW}>
                  <div className="min-w-0 flex-1">
                    <h3 className={ROW_TITLE}>
                      {t(BREACH_EVENT_KEY[event.eventType] ?? 'auditActionOther')}
                    </h3>
                    <p className={ROW_META}>
                      <time dateTime={event.createdAt ?? undefined}>{formatDate(event.createdAt)}</time>
                      {' · '}
                      {event.actorName ?? t('adminName')}
                      {' · '}
                      {t('breachHistoryVersion', { version: event.version })}
                    </p>
                    {event.eventType === 'updated' && fields.length > 0 ? (
                      <p className={cn(ROW_META, 'mt-1')}>
                        {t('breachHistoryFields', { list: fields.map(changeLabel).join(', ') })}
                      </p>
                    ) : null}
                    {event.note ? (
                      <p className={cn(ROW_META, 'mt-1 whitespace-pre-line text-foreground')}>{event.note}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
