/**
 * Parametry list panelu administratora (#416, #418) — czyste funkcje, bez dostępu do DB.
 *
 *   - kursor stronicowania (`created_at` + `id`, stabilny przy równych datach),
 *   - wyszukiwanie (bezpieczne dla składni filtrów PostgREST),
 *   - filtry statusu zgłoszeń i roli użytkownika,
 *   - słownik powodów zgłoszeń (etykieta i18n zamiast surowego kodu — Invariant #2).
 *
 * Wszystkie wartości pochodzą z URL (niezaufane) i są walidowane tutaj, zanim trafią do zapytania.
 */

/** Rozmiar strony list admina. */
export const ADMIN_PAGE_SIZE = 50;

/** Maksymalna długość frazy wyszukiwania. */
export const ADMIN_SEARCH_MAX = 100;

/* ---------------------------------------------------------------------------
 * Kursor
 * ------------------------------------------------------------------------- */

export interface AdminCursor {
  /** `created_at` dokładnie jak z bazy (mikrosekundy — nie przepuszczamy przez `Date`). */
  createdAt: string;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** Kursor → token do URL (base64url; `+` ze strefy nie zamienia się w spację). */
export function encodeAdminCursor(cursor: AdminCursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, 'utf8').toString('base64url');
}

/** Token z URL → kursor albo null (zły format = pierwsza strona, nie błąd). */
export function decodeAdminCursor(token: string | undefined | null): AdminCursor | null {
  if (!token || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  let raw: string;
  try {
    raw = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const sep = raw.lastIndexOf('|');
  if (sep <= 0) return null;
  const createdAt = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if (!TIMESTAMP_RE.test(createdAt) || !UUID_RE.test(id)) return null;
  return { createdAt, id };
}

/* ---------------------------------------------------------------------------
 * Wyszukiwanie
 * ------------------------------------------------------------------------- */

/**
 * Normalizuje frazę: przycina, skraca do `ADMIN_SEARCH_MAX`, usuwa znaki sterujące składnią
 * filtrów PostgREST (`,()"\`) i symbole wieloznaczne LIKE (`%*`). Pusta fraza → null.
 */
export function normalizeAdminSearch(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[,()"\\%*]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ADMIN_SEARCH_MAX)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Dopasowanie frazy w danych DEMO (bez bazy). */
export function matchesSearch(values: Array<string | null | undefined>, q: string | null): boolean {
  if (!q) return true;
  const needle = q.toLocaleLowerCase();
  return values.some((v) => (v ?? '').toLocaleLowerCase().includes(needle));
}

/* ---------------------------------------------------------------------------
 * Filtry zgłoszeń i użytkowników
 * ------------------------------------------------------------------------- */

/** Filtr domyślny listy zgłoszeń: otwarte + w analizie (#416). */
export const REPORT_ACTIVE_FILTER = 'active';

export const REPORT_FILTERS = [
  REPORT_ACTIVE_FILTER,
  'open',
  'reviewing',
  'resolved',
  'dismissed',
  'all',
] as const;
export type ReportFilter = (typeof REPORT_FILTERS)[number];

/** Wartość z URL → filtr (brak/nieznany → `active`). */
export function parseReportFilter(raw: string | undefined | null): ReportFilter {
  return raw && (REPORT_FILTERS as readonly string[]).includes(raw)
    ? (raw as ReportFilter)
    : REPORT_ACTIVE_FILTER;
}

/** Statusy `report_status` dla filtra (null = bez ograniczenia). */
export function reportStatusesFor(filter: ReportFilter): string[] | null {
  if (filter === 'all') return null;
  if (filter === REPORT_ACTIVE_FILTER) return ['open', 'reviewing'];
  return [filter];
}

/**
 * Rodzaj zgłoszenia (#41): `dsa_notice` — sprawa z publicznego formularza zgłoszeń treści
 * (osobna kolejka), `quality` — pozostałe zgłoszenia. `all` = bez filtra (domyślnie).
 */
export const REPORT_KIND_FILTERS = ['all', 'dsa_notice', 'quality'] as const;
export type ReportKindFilter = (typeof REPORT_KIND_FILTERS)[number];

export function parseReportKindFilter(raw: string | undefined | null): ReportKindFilter {
  return raw && (REPORT_KIND_FILTERS as readonly string[]).includes(raw)
    ? (raw as ReportKindFilter)
    : 'all';
}

/** Role, które aplikacja faktycznie nadaje (bez `moderator` — nic go nie obsługuje, #418). */
export const USER_ROLE_FILTERS = ['candidate', 'employer', 'admin'] as const;
export type UserRoleFilter = (typeof USER_ROLE_FILTERS)[number];

export function parseUserRoleFilter(raw: string | undefined | null): UserRoleFilter | null {
  return raw && (USER_ROLE_FILTERS as readonly string[]).includes(raw)
    ? (raw as UserRoleFilter)
    : null;
}

/* ---------------------------------------------------------------------------
 * Blokady adresów e-mail (#44)
 * ------------------------------------------------------------------------- */

/** Filtr listy blokad: domyślnie aktywne. */
export const EMAIL_SUPPRESSION_FILTERS = ['active', 'lifted', 'all'] as const;
export type EmailSuppressionFilter = (typeof EMAIL_SUPPRESSION_FILTERS)[number];

export function parseEmailSuppressionFilter(raw: string | undefined | null): EmailSuppressionFilter {
  return raw && (EMAIL_SUPPRESSION_FILTERS as readonly string[]).includes(raw)
    ? (raw as EmailSuppressionFilter)
    : 'active';
}

/** Filtr rejestru naruszeń (#490, `breach_incidents.status`); domyślnie otwarte. */
export const BREACH_LIST_FILTERS = ['open', 'closed', 'all'] as const;
export type BreachListFilter = (typeof BREACH_LIST_FILTERS)[number];

export function parseBreachFilter(raw: string | undefined | null): BreachListFilter {
  return raw && (BREACH_LIST_FILTERS as readonly string[]).includes(raw)
    ? (raw as BreachListFilter)
    : 'open';
}

/** Filtr kolejki przeglądu pytań screeningowych (#497, 0103). Domyślnie oczekujące. */
export const SCREENING_REVIEW_FILTERS = ['pending', 'decided', 'all'] as const;
export type ScreeningReviewFilter = (typeof SCREENING_REVIEW_FILTERS)[number];

export function parseScreeningReviewFilter(raw: string | undefined | null): ScreeningReviewFilter {
  return raw && (SCREENING_REVIEW_FILTERS as readonly string[]).includes(raw)
    ? (raw as ScreeningReviewFilter)
    : 'pending';
}

/** Powód blokady (`email_suppressions.reason`, 0098) → klucz i18n (namespace `admin`). */
export const EMAIL_SUPPRESSION_REASON_KEY: Record<string, string> = {
  hard_bounce: 'emailReasonHardBounce',
  complaint: 'emailReasonComplaint',
};

/* ---------------------------------------------------------------------------
 * Powody zgłoszeń
 * ------------------------------------------------------------------------- */

/** Kody powodów zgłoszeń → klucz i18n (namespace `admin`). */
export const REPORT_REASON_KEY: Record<string, string> = {
  spam: 'reasonSpam',
  misleading: 'reasonMisleading',
  fraud: 'reasonFraud',
  scam: 'reasonFraud',
  harassment: 'reasonHarassment',
  discrimination: 'reasonDiscrimination',
  inappropriate: 'reasonInappropriate',
  offensive: 'reasonInappropriate',
  impersonation: 'reasonImpersonation',
  illegal_conditions: 'reasonIllegalConditions',
  data_misuse: 'reasonDataMisuse',
  duplicate: 'reasonDuplicate',
  outdated: 'reasonOutdated',
  expired: 'reasonOutdated',
  other: 'reasonOther',
};

export interface ReportReasonView {
  /** Klucz i18n etykiety (namespace `admin`). */
  key: string;
  /** Własne słowa zgłaszającego (tekst swobodny, nie kod) albo null. */
  freeText: string | null;
}

/**
 * Znany kod → etykieta słownikowa. Nieznany kod techniczny (`snake_case`) → neutralne „Inny
 * powód” bez surowej wartości. Tekst swobodny wpisany przez zgłaszającego → „Inny powód” +
 * ten tekst jako treść zgłoszenia (to dane użytkownika, nie kod).
 */
export function reportReasonView(reason: string): ReportReasonView {
  const value = reason.trim();
  const key = REPORT_REASON_KEY[value.toLowerCase()];
  if (key) return { key, freeText: null };
  if (value.length === 0 || /^[a-z0-9]+([_-][a-z0-9]+)*$/.test(value)) {
    return { key: 'reasonOther', freeText: null };
  }
  return { key: 'reasonOther', freeText: value };
}

/* ---------------------------------------------------------------------------
 * Dziennik zdarzeń (audit_logs, #417)
 * ------------------------------------------------------------------------- */

/** Typy obiektów zapisywane w `audit_logs.entity_type` (0017, 0019, 0072, 0098, 0106). */
export const AUDIT_ENTITY_TYPES = [
  'company',
  'report',
  'application',
  'offer',
  'email_suppression',
  'breach_incident',
  'screening_question_review',
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/** Akcje audytu → klucz i18n (namespace `admin`). Nieznana akcja → `auditActionOther`. */
export const AUDIT_ACTION_KEY: Record<string, string> = {
  'company.created': 'auditActionCompanyCreated',
  'company.status_changed': 'auditActionCompanyStatus',
  'company.reverification_requested': 'auditActionCompanyReverification',
  'company.vies_checked': 'auditActionCompanyVies',
  'report.resolved': 'auditActionReportStatus',
  'moderation.decided': 'auditActionModerationDecided',
  'moderation.restored': 'auditActionModerationRestored',
  'moderation.appeal_submitted': 'auditActionAppealSubmitted',
  'moderation.appeal_decided': 'auditActionAppealDecided',
  'dsa.retention_run': 'auditActionRetentionRun',
  'application.status_changed': 'auditActionApplicationStatus',
  'offer.sent': 'auditActionOfferSent',
  'offer.status_changed': 'auditActionOfferStatus',
  'email.suppressed': 'auditActionEmailSuppressed',
  'email.suppression_lifted': 'auditActionEmailSuppressionLifted',
  'breach.created': 'auditActionBreachCreated',
  'breach.updated': 'auditActionBreachUpdated',
  'breach.closed': 'auditActionBreachClosed',
  'breach.reopened': 'auditActionBreachReopened',
  'breach.exported': 'auditActionBreachExported',
  'breach.subjects_notified': 'auditActionBreachSubjectsNotified',
  'screening_question.review_requested': 'auditActionScreeningRequested',
  'screening_question.reviewed': 'auditActionScreeningReviewed',
};

export function parseAuditEntity(raw: string | undefined | null): AuditEntityType | null {
  return raw && (AUDIT_ENTITY_TYPES as readonly string[]).includes(raw)
    ? (raw as AuditEntityType)
    : null;
}

export function parseAuditAction(raw: string | undefined | null): string | null {
  return raw && Object.hasOwn(AUDIT_ACTION_KEY, raw) ? raw : null;
}

/** UUID z URL (np. `?id=` historii jednej firmy) albo null. */
export function parseUuid(raw: string | undefined | null): string | null {
  return raw && UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

/** Data `YYYY-MM-DD` z URL albo null. */
export function parseYmd(raw: string | undefined | null): string | null {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}
