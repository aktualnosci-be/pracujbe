/**
 * Parametry listy ofert w panelu administratora (`/admin/oferty`) — czyste funkcje, bez DB.
 *
 * Filtr statusu działa na statusie EFEKTYWNYM (jak panel pracodawcy, `src/lib/job-expiry.ts`):
 * aktywna oferta po `expires_at` to już `expired`, nawet gdy cron maintenance jeszcze jej nie
 * przestawił (#72). `moderated` = oferta z blokadą decyzji moderacyjnej (`moderation_decision_id`,
 * 0099) niezależnie od statusu.
 *
 * Wartości pochodzą z URL (niezaufane): nieznany filtr = wszystkie, zły UUID firmy = brak filtra.
 * Warunki SQL to stałe fragmenty (bez wartości z URL) — wartości idą w parametrach `$n`.
 */

export const ADMIN_JOB_FILTERS = [
  'all',
  'active',
  'draft',
  'paused',
  'closed',
  'expired',
  'moderated',
] as const;
export type AdminJobFilter = (typeof ADMIN_JOB_FILTERS)[number];

/** Etykiety chipów filtra (namespace `admin`). */
export const ADMIN_JOB_FILTER_LABEL: Record<AdminJobFilter, string> = {
  all: 'filterAll',
  active: 'jobStatusActive',
  draft: 'jobStatusDraft',
  paused: 'jobStatusPaused',
  closed: 'jobStatusClosed',
  expired: 'jobStatusExpired',
  moderated: 'jobsFilterModerated',
};

/** Etykieta statusu efektywnego (namespace `admin`). */
export const ADMIN_JOB_STATUS_KEY: Record<string, string> = {
  draft: 'jobStatusDraft',
  active: 'jobStatusActive',
  paused: 'jobStatusPaused',
  closed: 'jobStatusClosed',
  expired: 'jobStatusExpired',
};

/** Wartość z URL → filtr (brak/nieznany → `all`). */
export function parseAdminJobFilter(raw: string | undefined | null): AdminJobFilter {
  return raw && (ADMIN_JOB_FILTERS as readonly string[]).includes(raw)
    ? (raw as AdminJobFilter)
    : 'all';
}

/**
 * Warunek SQL filtra (alias tabeli ofert `j`) albo null dla `all`. Ten sam predykat terminu
 * co publiczne odczyty (0048): `expires_at <= now()` = po terminie.
 */
export function adminJobFilterCondition(filter: AdminJobFilter): string | null {
  switch (filter) {
    case 'all':
      return null;
    case 'active':
      return "(j.status = 'active' AND (j.expires_at IS NULL OR j.expires_at > now()))";
    case 'expired':
      return "(j.status = 'expired' OR (j.status = 'active' AND j.expires_at <= now()))";
    case 'moderated':
      return 'j.moderation_decision_id IS NOT NULL';
    case 'draft':
    case 'paused':
    case 'closed':
      return `j.status = '${filter}'`;
  }
}
