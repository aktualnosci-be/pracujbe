import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { AdminPageHeader } from '@/components/admin/AdminListControls';
import { NOTICE_TEXT, PANEL, PANEL_H2, PANEL_P, SECTION_HEAD } from '@/components/admin/admin-styles';
import { Alert } from '@/components/ui/alert';
import { getOpsDashboard } from '@/lib/data/admin-ops';
import { createAppDateFormatter } from '@/lib/datetime';
import {
  OPS_SECTIONS,
  type OpsNote,
  type OpsRow,
  type OpsRowState,
  type OpsThreshold,
  type OpsValue,
} from '@/lib/ops/dashboard';
import { cn } from '@/lib/utils';

/**
 * Panel administratora — stan operacyjny (#47). Tylko odczyt.
 *
 * Te same liczby i stany czujek co `/api/health/ops` (wspólny odczyt `readOpsStatus`): wiek
 * kolejek e-mail i auth, porzucone dzierżawy, zawieszone webhooki, maintenance (ostatni przebieg
 * i opóźnienie), kolejka usuwania storage, poczta, budżet AI, połączenia bazy i kopia. Każdy
 * wiersz: wartość, próg i stan słowem (kolor nie jest jedynym nośnikiem informacji). Bez danych
 * osobowych, adresów i sekretów; bez akcji zapisu. Guard roli: layout + `requireAdmin` w odczycie.
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/operacje';

const STATE_CLASS: Record<OpsRowState, string> = {
  ok: 'text-success-text',
  warning: 'text-warning-text',
  alert: 'text-error-text',
  noData: 'text-muted-foreground',
};

const SECTION_KEY = {
  queues: 'opsSectionQueues',
  maintenance: 'opsSectionMaintenance',
  storage: 'opsSectionStorage',
  mail: 'opsSectionMail',
  aiBudget: 'opsSectionAiBudget',
  database: 'opsSectionDatabase',
  backup: 'opsSectionBackup',
} as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('opsTitle'), robots: { index: false, follow: false } };
}

export default async function AdminOpsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  const result = await getOpsDashboard();
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const pct = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 });
  const when = createAppDateFormatter(locale, { withTime: true });

  const formatValue = (value: OpsValue): string => {
    switch (value.kind) {
      case 'seconds': {
        const s = value.value;
        if (s < 60) return t('opsDurationSeconds', { value: num.format(s) });
        if (s < 3600) return t('opsDurationMinutes', { value: num.format(s / 60) });
        if (s < 48 * 3600) return t('opsDurationHours', { value: num.format(s / 3600) });
        return t('opsDurationDays', { value: num.format(s / 86_400) });
      }
      case 'count':
        return num.format(value.value);
      case 'percent':
        return pct.format(value.value / 100);
      default:
        return t('opsNoValue');
    }
  };

  const formatThreshold = (threshold: OpsThreshold): string => {
    if (threshold.kind === 'positive') return t('opsThresholdPositive');
    if (threshold.kind === 'budget') {
      return t('opsThresholdBudget', {
        warning: pct.format(threshold.warningPercent / 100),
        alert: pct.format(threshold.alertPercent / 100),
      });
    }
    return t('opsThresholdMax', { value: formatValue(threshold.value) });
  };

  const formatNote = (note: OpsNote): string => {
    switch (note.key) {
      case 'smallSample':
        return t('opsNoteSmallSample', { sent: num.format(note.sent), min: num.format(note.min) });
      case 'queueReady':
        return t('opsNoteQueueReady', { ready: num.format(note.ready) });
      case 'lastRunNever':
        return t('opsNoteLastRunNever');
      case 'lastRunFailed':
        return t('opsNoteLastRunFailed', { task: note.task });
      case 'lastRunUnknown':
        return t('opsNoteLastRunUnknown');
      case 'lagDetail':
        return t('opsNoteLagDetail', {
          jobs: num.format(note.jobs),
          discounts: num.format(note.discounts),
          checkouts: num.format(note.checkouts),
        });
      case 'storagePending':
        return t('opsNoteStoragePending', { pending: num.format(note.pending) });
      case 'connections':
        return t('opsNoteConnections', { used: num.format(note.used), available: num.format(note.available) });
      case 'backupStatus':
        return t(`opsNoteBackup_${note.status}`);
      default:
        return t('opsNoteAiNoLimit');
    }
  };

  const renderRow = (row: OpsRow) => {
    const labelId = `ops-row-${row.id}`;
    return (
      <li key={row.id} data-ops-row={row.id} data-state={row.state} className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-baseline">
        <div className="min-w-0">
          <p id={labelId} className="break-words font-semibold text-foreground">
            {t(`opsRow_${row.id}`)}
          </p>
          {row.note ? <p className="break-words text-muted-foreground">{formatNote(row.note)}</p> : null}
        </div>
        <p className="break-words">
          <span className="text-muted-foreground">{t('opsColValue')}: </span>
          <span className="font-semibold text-foreground">{formatValue(row.value)}</span>
        </p>
        <p className="break-words">
          <span className="text-muted-foreground">{t('opsColThreshold')}: </span>
          <span className="text-foreground">{formatThreshold(row.threshold)}</span>
        </p>
        <p className={cn('font-semibold', STATE_CLASS[row.state])}>
          <span className="sr-only">{t('opsColState')}: </span>
          {t(`opsState_${row.state}`)}
        </p>
      </li>
    );
  };

  return (
    <div className="min-w-0 space-y-[22px]">
      <AdminPageHeader eyebrow={t('brandTag')} title={t('opsTitle')} subtitle={t('opsSubtitle')} />

      {result.status === 'unavailable' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}`} />
      ) : result.status === 'unconfigured' ? (
        <Alert>
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{t('opsUnconfiguredTitle')}</p>
            <p className={cn(NOTICE_TEXT, 'mb-0')}>{t('opsUnconfiguredText')}</p>
          </div>
        </Alert>
      ) : (
        <>
          {result.demo ? <Alert>{t('opsDemoNotice')}</Alert> : null}

          <section aria-labelledby="ops-overall" className={PANEL}>
            <div className={SECTION_HEAD}>
              <h2 id="ops-overall" className={PANEL_H2}>
                {t('opsOverall')}
              </h2>
            </div>
            <p className={cn('text-[15px] font-semibold', STATE_CLASS[result.overall])}>
              {t(`opsOverall_${result.overall}`)}
            </p>
            <p className={`${PANEL_P} mt-2`}>
              {t('opsLastMaintenance', { when: when(result.lastMaintenanceAt) })}
            </p>
            <p className={`${PANEL_P} mt-2`}>{t('opsCheckedAt', { when: when(result.checkedAt) })}</p>
            <p className={`${PANEL_P} mt-2`}>{t('opsSameAsHealth')}</p>
          </section>

          {OPS_SECTIONS.map((section) => {
            const rows = result.rows.filter((row) => row.section === section);
            if (rows.length === 0) return null;
            const headingId = `ops-section-${section}`;
            return (
              <section key={section} aria-labelledby={headingId} className={PANEL}>
                <div className={SECTION_HEAD}>
                  <h2 id={headingId} className={PANEL_H2}>
                    {t(SECTION_KEY[section])}
                  </h2>
                </div>
                <ul className="divide-y divide-border border-y border-border text-[13px]">{rows.map(renderRow)}</ul>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
