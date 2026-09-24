import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import {
  AUDIT_ACTION_KEY,
  AUDIT_ENTITY_TYPES,
  EMAIL_SUPPRESSION_REASON_KEY,
  normalizeAdminSearch,
  parseAuditAction,
  parseAuditEntity,
  parseUuid,
  parseYmd,
} from '@/lib/admin/list-params';
import { AUDIT_ACTOR_SYSTEM, listAuditLogs, type AdminAuditRow } from '@/lib/data/admin';
import { createAppDateFormatter } from '@/lib/datetime';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import {
  AdminEmptyState,
  AdminPageHeader,
  AdminPager,
} from '@/components/admin/AdminListControls';
import { COMPANY_STATUS_KEY, REPORT_STATUS_KEY } from '@/components/admin/AdminStatusBadge';
import {
  BTN_PRIMARY,
  FIELD,
  FIELD_LABEL,
  INLINE_LINK,
  PANEL,
  ROW,
  ROW_META,
  ROW_TITLE,
  SEARCH_BOX,
  TAG,
  TEXT_LINK,
} from '@/components/admin/admin-styles';
import { cn } from '@/lib/utils';

/**
 * Panel administratora — Dziennik zdarzeń (#417). Tylko odczyt `audit_logs` service-rolem po
 * potwierdzeniu roli admina (`listAuditLogs` → `requireAdmin`). Data (Europe/Brussels), aktor
 * (nazwa albo „System”), akcja jako etykieta i18n, obiekt z linkiem, zmiana statusu przed → po.
 * Filtry w URL (typ obiektu, akcja, aktor, zakres dat, `id` = historia jednego obiektu),
 * stronicowanie kursorem. Błąd odczytu → `AdminLoadError` (#311). NOINDEX (z layoutu).
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/dziennik';

const ENTITY_LABEL: Record<string, string> = {
  company: 'targetCompany',
  report: 'entityReport',
  application: 'entityApplication',
  offer: 'entityOffer',
  email_suppression: 'entityEmailSuppression',
};

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `offer_sent` → `offerSent` (klucze namespace `status`). */
function camel(value: string): string {
  return value.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return {
    title: t('auditTitle'),
    robots: { index: false, follow: false },
  };
}

export default async function AdminAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'admin' });
  const tStatus = await getTranslations({ locale, namespace: 'status' });
  const tOffer = await getTranslations({ locale, namespace: 'offerStatus' });

  const sp = await searchParams;
  const entity = parseAuditEntity(firstValue(sp['entity']));
  const action = parseAuditAction(firstValue(sp['action']));
  const entityId = parseUuid(firstValue(sp['id']));
  const actor = normalizeAdminSearch(firstValue(sp['actor']));
  const from = parseYmd(firstValue(sp['from']));
  const to = parseYmd(firstValue(sp['to']));
  const cursor = firstValue(sp['cursor']) ?? null;

  const listQuery = { entity, action, id: entityId, actor, from, to };
  const result = await listAuditLogs({ entity, action, entityId, actor, from, to, cursor });
  const rows = result.status === 'ok' ? result.rows : [];
  const formatDate = createAppDateFormatter(locale, { withTime: true });
  const retryParams = new URLSearchParams(
    Object.entries({ ...listQuery, cursor }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();

  const statusLabel = (entityType: string | null, value: string | null): string | null => {
    if (!value) return null;
    if (entityType === 'company' && COMPANY_STATUS_KEY[value]) return t(COMPANY_STATUS_KEY[value]);
    if (entityType === 'report' && REPORT_STATUS_KEY[value]) return t(REPORT_STATUS_KEY[value]);
    if (entityType === 'application' && tStatus.has(camel(value))) return tStatus(camel(value));
    if (entityType === 'offer' && tOffer.has(value)) return tOffer(value);
    if (entityType === 'email_suppression') {
      if (value === 'lifted') return t('emailStatusLifted');
      if (EMAIL_SUPPRESSION_REASON_KEY[value]) return t(EMAIL_SUPPRESSION_REASON_KEY[value]);
    }
    return t('statusUnknown');
  };

  const changeText = (row: AdminAuditRow): string => {
    const before = statusLabel(row.entityType, row.statusBefore);
    const after = statusLabel(row.entityType, row.statusAfter);
    if (before && after) return t('auditChange', { from: before, to: after });
    if (after) return after;
    return '—';
  };

  const actorText = (row: AdminAuditRow): string =>
    row.actorId ? (row.actorName ?? t('auditActorUnknown')) : t('auditActorSystem');

  const fieldClass = FIELD;

  return (
    <div className="min-w-0 space-y-[22px]">
      <AdminPageHeader
        eyebrow={t('brandTag')}
        title={t('auditTitle')}
        subtitle={t('auditSubtitle')}
      />

      {entityId ? (
        <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-foreground">
          {t('auditObjectHistory')}{' '}
          <Link href={{ pathname: BASE_PATH }} className={TEXT_LINK}>
            {t('auditFilterReset')}
          </Link>
        </p>
      ) : null}

      <form
        method="get"
        action={`/${locale}${BASE_PATH}`}
        aria-label={t('auditFiltersLabel')}
        className={cn(
          SEARCH_BOX,
          'grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] [&>div]:p-1',
        )}
      >
        {entityId ? <input type="hidden" name="id" value={entityId} /> : null}
        <div>
          <label htmlFor="audit-entity" className={FIELD_LABEL}>
            {t('auditFilterEntity')}
          </label>
          <select id="audit-entity" name="entity" defaultValue={entity ?? ''} className={fieldClass}>
            <option value="">{t('auditEntityAll')}</option>
            {AUDIT_ENTITY_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(ENTITY_LABEL[value] ?? 'targetUnknown')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audit-action" className={FIELD_LABEL}>
            {t('auditFilterAction')}
          </label>
          <select id="audit-action" name="action" defaultValue={action ?? ''} className={fieldClass}>
            <option value="">{t('auditActionAll')}</option>
            {Object.entries(AUDIT_ACTION_KEY).map(([value, key]) => (
              <option key={value} value={value}>
                {t(key)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audit-actor" className={FIELD_LABEL}>
            {t('auditFilterActor')}
          </label>
          <input
            id="audit-actor"
            type="search"
            name="actor"
            defaultValue={actor ?? ''}
            maxLength={100}
            aria-describedby="audit-actor-hint"
            className={fieldClass}
          />
          <p id="audit-actor-hint" className="mt-1 text-[11px] text-muted-foreground">
            {t('auditFilterActorHint', { system: AUDIT_ACTOR_SYSTEM })}
          </p>
        </div>
        <div>
          <label htmlFor="audit-from" className={FIELD_LABEL}>
            {t('auditFilterFrom')}
          </label>
          <input id="audit-from" type="date" name="from" defaultValue={from ?? ''} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="audit-to" className={FIELD_LABEL}>
            {t('auditFilterTo')}
          </label>
          <input id="audit-to" type="date" name="to" defaultValue={to ?? ''} className={fieldClass} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={BTN_PRIMARY}>
            {t('auditFilterApply')}
          </button>
        </div>
      </form>

      {result.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}${retryParams ? `?${retryParams}` : ''}`} />
      ) : (
        <section className={PANEL}>
          {rows.length === 0 ? (
            <AdminEmptyState message={t('auditEmpty')} />
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => {
                const actionKey = AUDIT_ACTION_KEY[row.action] ?? 'auditActionOther';
                const typeLabel = row.entityType
                  ? t(ENTITY_LABEL[row.entityType] ?? 'targetUnknown')
                  : t('targetUnknown');
                return (
                  <li
                    key={row.id}
                    className={cn(ROW, 'grid gap-1 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-[18px]')}
                  >
                    <p className={cn(ROW_META, 'tabular-nums')}>
                      <time dateTime={row.createdAt ?? undefined}>{formatDate(row.createdAt)}</time>
                    </p>
                    <div className="min-w-0 space-y-1">
                      <p className={cn(ROW_TITLE, 'mb-0')}>
                        {t(actionKey)}
                        <span className="font-normal text-muted-foreground"> · {changeText(row)}</span>
                      </p>
                      <p className="break-words text-[13px] text-foreground">
                        <span className="text-muted-foreground">{typeLabel}: </span>
                        {row.entityHref ? (
                          <Link
                            href={row.entityHref}
                            className={cn(INLINE_LINK, 'underline')}
                          >
                            {row.entityLabel ?? typeLabel}
                          </Link>
                        ) : (
                          <span className="font-medium">
                            {row.entityLabel ?? (row.entityId ? row.entityId.slice(0, 8) : '—')}
                          </span>
                        )}
                      </p>
                      {row.reason ? (
                        <p className="break-words text-[13px] text-foreground">
                          {t('auditReason', { reason: row.reason })}
                        </p>
                      ) : null}
                      <span className={cn(TAG, 'mt-1.5')}>
                        {t('auditActor', { name: actorText(row) })}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {result.status === 'ok' ? (
        <AdminPager
          pathname={BASE_PATH}
          query={listQuery}
          nextCursor={result.nextCursor}
          hasCursor={Boolean(cursor)}
          count={rows.length}
        />
      ) : null}
    </div>
  );
}
