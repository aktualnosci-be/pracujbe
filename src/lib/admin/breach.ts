/**
 * Rejestr incydentów i naruszeń danych osobowych (#490) — reguły wspólne dla formularza
 * (przeglądarka), Server Actions i eksportu. Te same limity i zasady egzekwuje baza
 * (`breach_incident_validate`, CHECK-i `breach_incidents`, migracja 0106) — test
 * `tests/unit/breach-register.test.ts` porównuje listy wartości z migracją.
 *
 * Moduł jest czystą logiką (bez I/O i bez env).
 */

export const BREACH_KINDS = ['personal_data_breach', 'security_incident'] as const;
export type BreachKind = (typeof BREACH_KINDS)[number];

export const BREACH_DATA_CATEGORIES = [
  'identity',
  'contact',
  'cv_files',
  'applications',
  'messages',
  'account_credentials',
  'location',
  'special_category',
  'other',
] as const;
export type BreachDataCategory = (typeof BREACH_DATA_CATEGORIES)[number];

export const BREACH_RISK_LEVELS = ['not_assessed', 'no_risk', 'risk', 'high_risk'] as const;
export type BreachRiskLevel = (typeof BREACH_RISK_LEVELS)[number];

export const BREACH_AUTHORITY_DECISIONS = ['pending', 'notify', 'not_required'] as const;
export type BreachAuthorityDecision = (typeof BREACH_AUTHORITY_DECISIONS)[number];

export const BREACH_SUBJECTS_DECISIONS = ['pending', 'notify', 'not_required', 'exception'] as const;
export type BreachSubjectsDecision = (typeof BREACH_SUBJECTS_DECISIONS)[number];

export const BREACH_STATUSES = ['open', 'closed'] as const;
export type BreachStatus = (typeof BREACH_STATUSES)[number];

export const BREACH_LIMITS = {
  title: 200,
  description: 5000,
  riskAssessment: 5000,
  authorityDecisionReason: 2000,
  authorityReference: 200,
  authorityDelayReason: 2000,
  subjectsDecisionReason: 2000,
  actionsTaken: 5000,
  closureSummary: 2000,
  reopenReason: 2000,
  noticeSubject: 200,
  noticeText: 5000,
  affectedCount: 100_000_000,
  recipients: 5000,
} as const;

/** Termin zgłoszenia do organu nadzorczego od stwierdzenia naruszenia (art. 33 ust. 1). */
export const BREACH_AUTHORITY_DEADLINE_HOURS = 72;
const HOUR_MS = 3_600_000;
/** Tolerancja zegara przy dacie „w przyszłości” — jak `v_future` w bazie. */
const FUTURE_SLACK_MS = 5 * 60_000;

/**
 * Pola formularza (klucze = klucze jsonb w RPC). Daty jako ISO UTC albo pusty tekst,
 * liczba osób jako tekst (puste = nieznana).
 */
export interface BreachForm {
  kind: string;
  title: string;
  description: string;
  detectedAt: string;
  occurredAt: string;
  dataCategories: string[];
  affectedCount: string;
  affectedCountEstimated: boolean;
  riskLevel: string;
  riskAssessment: string;
  authorityDecision: string;
  authorityDecisionReason: string;
  authorityNotifiedAt: string;
  authorityReference: string;
  authorityDelayReason: string;
  subjectsDecision: string;
  subjectsDecisionReason: string;
  subjectsNotifiedAt: string;
  actionsTaken: string;
}

export type BreachField = keyof BreachForm;

export const BREACH_FIELDS: readonly BreachField[] = [
  'kind',
  'title',
  'description',
  'detectedAt',
  'occurredAt',
  'dataCategories',
  'affectedCount',
  'affectedCountEstimated',
  'riskLevel',
  'riskAssessment',
  'authorityDecision',
  'authorityDecisionReason',
  'authorityNotifiedAt',
  'authorityReference',
  'authorityDelayReason',
  'subjectsDecision',
  'subjectsDecisionReason',
  'subjectsNotifiedAt',
  'actionsTaken',
];

export type BreachFieldError =
  | 'required'
  | 'tooLong'
  | 'invalid'
  | 'future'
  | 'afterDetected'
  | 'beforeDetected'
  | 'decisionMismatch'
  | 'conflictsWithRisk';

export const BREACH_FIELD_ERRORS: readonly BreachFieldError[] = [
  'required',
  'tooLong',
  'invalid',
  'future',
  'afterDetected',
  'beforeDetected',
  'decisionMismatch',
  'conflictsWithRisk',
];

export type BreachFormErrors = Partial<Record<BreachField, BreachFieldError>>;

export function emptyBreachForm(): BreachForm {
  return {
    kind: 'personal_data_breach',
    title: '',
    description: '',
    detectedAt: '',
    occurredAt: '',
    dataCategories: [],
    affectedCount: '',
    affectedCountEstimated: true,
    riskLevel: 'not_assessed',
    riskAssessment: '',
    authorityDecision: 'pending',
    authorityDecisionReason: '',
    authorityNotifiedAt: '',
    authorityReference: '',
    authorityDelayReason: '',
    subjectsDecision: 'pending',
    subjectsDecisionReason: '',
    subjectsNotifiedAt: '',
    actionsTaken: '',
  };
}

const includes = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

const str = (value: unknown, max = 20_000): string =>
  typeof value === 'string' ? value.slice(0, max) : '';

/** Niezaufane wejście (Server Action) → formularz o znanym kształcie. */
export function normalizeBreachForm(input: unknown): BreachForm {
  const r = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const categories = Array.isArray(r['dataCategories'])
    ? [...new Set(r['dataCategories'].filter((c): c is string => typeof c === 'string'))].slice(0, 20)
    : [];
  return {
    kind: str(r['kind'], 40),
    title: str(r['title']),
    description: str(r['description']),
    detectedAt: str(r['detectedAt'], 40),
    occurredAt: str(r['occurredAt'], 40),
    dataCategories: categories,
    affectedCount: str(r['affectedCount'], 20),
    affectedCountEstimated: r['affectedCountEstimated'] !== false,
    riskLevel: str(r['riskLevel'], 40),
    riskAssessment: str(r['riskAssessment']),
    authorityDecision: str(r['authorityDecision'], 40),
    authorityDecisionReason: str(r['authorityDecisionReason']),
    authorityNotifiedAt: str(r['authorityNotifiedAt'], 40),
    authorityReference: str(r['authorityReference']),
    authorityDelayReason: str(r['authorityDelayReason']),
    subjectsDecision: str(r['subjectsDecision'], 40),
    subjectsDecisionReason: str(r['subjectsDecisionReason']),
    subjectsNotifiedAt: str(r['subjectsNotifiedAt'], 40),
    actionsTaken: str(r['actionsTaken']),
  };
}

function parseInstant(value: string): number | null | 'invalid' {
  const v = value.trim();
  if (v.length === 0) return null;
  const ts = Date.parse(v);
  return Number.isNaN(ts) ? 'invalid' : ts;
}

/**
 * Wszystkie błędy pól (formularz pokazuje je naraz). Kolejność i kody jak w
 * `breach_incident_validate` — baza zwraca pierwszy z nich.
 */
export function breachFormErrors(form: BreachForm, now: number = Date.now()): BreachFormErrors {
  const errors: BreachFormErrors = {};
  const set = (field: BreachField, error: BreachFieldError) => {
    if (!errors[field]) errors[field] = error;
  };
  const text = (field: BreachField, value: string, max: number, required: boolean) => {
    const trimmed = value.trim();
    if (required && trimmed.length === 0) set(field, 'required');
    else if (trimmed.length > max) set(field, 'tooLong');
  };
  const future = now + FUTURE_SLACK_MS;

  if (!includes(BREACH_KINDS, form.kind)) set('kind', 'invalid');
  text('title', form.title, BREACH_LIMITS.title, true);
  text('description', form.description, BREACH_LIMITS.description, true);

  const detected = parseInstant(form.detectedAt);
  if (detected === null) set('detectedAt', 'required');
  else if (detected === 'invalid') set('detectedAt', 'invalid');
  else if (detected > future) set('detectedAt', 'future');
  const detectedTs = typeof detected === 'number' ? detected : null;

  const occurred = parseInstant(form.occurredAt);
  if (occurred === 'invalid') set('occurredAt', 'invalid');
  else if (occurred !== null && detectedTs !== null && occurred > detectedTs) set('occurredAt', 'afterDetected');

  if (!form.dataCategories.every((c) => includes(BREACH_DATA_CATEGORIES, c))) set('dataCategories', 'invalid');

  const count = form.affectedCount.trim();
  if (count.length > 0 && (!/^[0-9]{1,9}$/.test(count) || Number(count) > BREACH_LIMITS.affectedCount)) {
    set('affectedCount', 'invalid');
  }

  if (!includes(BREACH_RISK_LEVELS, form.riskLevel)) set('riskLevel', 'invalid');
  text('riskAssessment', form.riskAssessment, BREACH_LIMITS.riskAssessment, form.riskLevel !== 'not_assessed');

  const riskLikely = form.riskLevel === 'risk' || form.riskLevel === 'high_risk';
  if (!includes(BREACH_AUTHORITY_DECISIONS, form.authorityDecision)) set('authorityDecision', 'invalid');
  else if (riskLikely && form.authorityDecision === 'not_required') set('authorityDecision', 'conflictsWithRisk');
  text(
    'authorityDecisionReason',
    form.authorityDecisionReason,
    BREACH_LIMITS.authorityDecisionReason,
    form.authorityDecision !== 'pending',
  );

  const authorityAt = parseInstant(form.authorityNotifiedAt);
  if (authorityAt === 'invalid') set('authorityNotifiedAt', 'invalid');
  else if (authorityAt !== null) {
    if (form.authorityDecision !== 'notify') set('authorityNotifiedAt', 'decisionMismatch');
    else if (detectedTs !== null && authorityAt < detectedTs) set('authorityNotifiedAt', 'beforeDetected');
    else if (authorityAt > future) set('authorityNotifiedAt', 'future');
  }
  text('authorityReference', form.authorityReference, BREACH_LIMITS.authorityReference, false);
  const late =
    typeof authorityAt === 'number' &&
    detectedTs !== null &&
    authorityAt > detectedTs + BREACH_AUTHORITY_DEADLINE_HOURS * HOUR_MS;
  text('authorityDelayReason', form.authorityDelayReason, BREACH_LIMITS.authorityDelayReason, late);

  if (!includes(BREACH_SUBJECTS_DECISIONS, form.subjectsDecision)) set('subjectsDecision', 'invalid');
  else if (form.riskLevel === 'high_risk' && form.subjectsDecision === 'not_required') {
    set('subjectsDecision', 'conflictsWithRisk');
  }
  text(
    'subjectsDecisionReason',
    form.subjectsDecisionReason,
    BREACH_LIMITS.subjectsDecisionReason,
    form.subjectsDecision !== 'pending',
  );
  const subjectsAt = parseInstant(form.subjectsNotifiedAt);
  if (subjectsAt === 'invalid') set('subjectsNotifiedAt', 'invalid');
  else if (subjectsAt !== null) {
    if (form.subjectsDecision !== 'notify') set('subjectsNotifiedAt', 'decisionMismatch');
    else if (detectedTs !== null && subjectsAt < detectedTs) set('subjectsNotifiedAt', 'beforeDetected');
    else if (subjectsAt > future) set('subjectsNotifiedAt', 'future');
  }
  text('actionsTaken', form.actionsTaken, BREACH_LIMITS.actionsTaken, false);
  return errors;
}

/** Błąd pola z komunikatu bazy (`VALIDATION_FAILED: <pole>:<kod>`) albo null. */
export function breachFieldFromDbMessage(
  message: string | null | undefined,
): { field: string; error: BreachFieldError } | null {
  const m = /VALIDATION_FAILED: ([A-Za-z_]+):([A-Za-z]+)/.exec(message ?? '');
  if (!m) return null;
  const error = m[2] as BreachFieldError;
  return BREACH_FIELD_ERRORS.includes(error) ? { field: m[1]!, error } : { field: m[1]!, error: 'invalid' };
}

/** Krok zamknięcia, którego brakuje (`BREACH_NOT_READY: <pole>`), albo null. */
export function breachNotReadyField(message: string | null | undefined): string | null {
  const m = /BREACH_NOT_READY: ([A-Za-z]+)/.exec(message ?? '');
  return m ? m[1]! : null;
}

/** Uzasadnienie zamknięcia / ponownego otwarcia — błąd albo null. */
export function breachNoteError(value: string | null | undefined, max: number): 'required' | 'tooLong' | null {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) return 'required';
  if (trimmed.length > max) return 'tooLong';
  return null;
}

/* ---------------------------------------------------------------------------
 * Termin 72 h (art. 33 ust. 1) — liczony od stwierdzenia naruszenia
 * ------------------------------------------------------------------------- */

export type BreachDeadlineState =
  /** Incydent bez danych osobowych albo decyzja: zgłoszenie nie jest wymagane. */
  | { state: 'notApplicable' }
  /** Zgłoszono do organu; `late` — po terminie. */
  | { state: 'notified'; late: boolean; deadlineAt: string }
  /** Termin biegnie; `hoursLeft` zaokrąglone w dół (min. 0). */
  | { state: 'running'; hoursLeft: number; deadlineAt: string }
  /** Termin minął bez zgłoszenia. */
  | { state: 'overdue'; hoursOver: number; deadlineAt: string };

export function breachDeadline(
  input: {
    kind: string;
    detectedAt: string | null;
    authorityDecision: string;
    authorityNotifiedAt: string | null;
    status?: string;
  },
  now: number = Date.now(),
): BreachDeadlineState {
  if (input.kind !== 'personal_data_breach' || input.authorityDecision === 'not_required') {
    return { state: 'notApplicable' };
  }
  const detected = input.detectedAt ? Date.parse(input.detectedAt) : Number.NaN;
  if (Number.isNaN(detected)) return { state: 'notApplicable' };
  const deadline = detected + BREACH_AUTHORITY_DEADLINE_HOURS * HOUR_MS;
  const deadlineAt = new Date(deadline).toISOString();
  const notified = input.authorityNotifiedAt ? Date.parse(input.authorityNotifiedAt) : Number.NaN;
  if (!Number.isNaN(notified)) return { state: 'notified', late: notified > deadline, deadlineAt };
  if (input.status === 'closed') return { state: 'notApplicable' };
  if (now <= deadline) {
    return { state: 'running', hoursLeft: Math.floor((deadline - now) / HOUR_MS), deadlineAt };
  }
  return { state: 'overdue', hoursOver: Math.floor((now - deadline) / HOUR_MS), deadlineAt };
}

/* ---------------------------------------------------------------------------
 * Zawiadomienie osób — lista odbiorców
 * ------------------------------------------------------------------------- */

const RECIPIENT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECIPIENT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Tekst z pola „Odbiorcy” (UUID konta albo e-mail; oddzielone nową linią, przecinkiem lub
 * średnikiem) → pozycje bez duplikatów + pozycje w złym formacie.
 */
export function parseBreachRecipients(text: string): { entries: string[]; malformed: string[] } {
  const seen = new Set<string>();
  const entries: string[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const value = raw.trim();
    if (value.length === 0) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (value.length <= 320 && (RECIPIENT_UUID_RE.test(value) || RECIPIENT_EMAIL_RE.test(value))) {
      entries.push(value);
    } else {
      malformed.push(value);
    }
  }
  return { entries, malformed };
}

/* ---------------------------------------------------------------------------
 * Eksport CSV (dla zgłoszenia) — z wyniku `admin_export_breach_incident`
 * ------------------------------------------------------------------------- */

/** Kolumny wpisu w eksporcie (klucze z bazy). Bez `client_key` i `created_by`. */
export const BREACH_EXPORT_COLUMNS = [
  'reference',
  'kind',
  'status',
  'title',
  'description',
  'detected_at',
  'occurred_at',
  'data_categories',
  'affected_count',
  'affected_count_estimated',
  'risk_level',
  'risk_assessment',
  'authority_decision',
  'authority_decision_reason',
  'authority_notified_at',
  'authority_reference',
  'authority_delay_reason',
  'subjects_decision',
  'subjects_decision_reason',
  'subjects_notified_at',
  'actions_taken',
  'closed_at',
  'closure_summary',
  'version',
  'created_at',
  'updated_at',
] as const;

/** Komórka CSV (RFC 4180) z ochroną przed formułami arkusza (`=`, `+`, `-`, `@`). */
export function csvCell(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) text = '';
  else if (Array.isArray(value)) text = value.join('; ');
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV z eksportu: sekcja „pole;wartość” wpisu, potem historia zmian. Separator `,`,
 * koniec linii CRLF, BOM UTF-8 dla arkuszy.
 */
export function breachExportCsv(exported: unknown): string {
  const root = typeof exported === 'object' && exported !== null ? (exported as Record<string, unknown>) : {};
  const incident =
    typeof root['incident'] === 'object' && root['incident'] !== null
      ? (root['incident'] as Record<string, unknown>)
      : {};
  const events = Array.isArray(root['events']) ? (root['events'] as Array<Record<string, unknown>>) : [];
  const lines: string[] = ['field,value'];
  for (const column of BREACH_EXPORT_COLUMNS) {
    lines.push(`${csvCell(column)},${csvCell(incident[column])}`);
  }
  lines.push(`${csvCell('exported_at')},${csvCell(root['exportedAt'])}`);
  lines.push('');
  lines.push('event_version,event_type,event_at,actor,changes,note');
  for (const event of events) {
    lines.push(
      [event['version'], event['eventType'], event['createdAt'], event['actor'], event['changes'], event['note']]
        .map(csvCell)
        .join(','),
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/* ---------------------------------------------------------------------------
 * Etykiety (klucze i18n w namespace `admin`)
 * ------------------------------------------------------------------------- */

export const BREACH_KIND_KEY: Record<BreachKind, string> = {
  personal_data_breach: 'breachKindPersonal',
  security_incident: 'breachKindSecurity',
};

export const BREACH_CATEGORY_KEY: Record<BreachDataCategory, string> = {
  identity: 'breachCategoryIdentity',
  contact: 'breachCategoryContact',
  cv_files: 'breachCategoryCvFiles',
  applications: 'breachCategoryApplications',
  messages: 'breachCategoryMessages',
  account_credentials: 'breachCategoryCredentials',
  location: 'breachCategoryLocation',
  special_category: 'breachCategorySpecial',
  other: 'breachCategoryOther',
};

export const BREACH_RISK_KEY: Record<BreachRiskLevel, string> = {
  not_assessed: 'breachRiskNotAssessed',
  no_risk: 'breachRiskNone',
  risk: 'breachRiskLikely',
  high_risk: 'breachRiskHigh',
};

export const BREACH_AUTHORITY_KEY: Record<BreachAuthorityDecision, string> = {
  pending: 'breachAuthorityPending',
  notify: 'breachAuthorityNotify',
  not_required: 'breachAuthorityNotRequired',
};

export const BREACH_SUBJECTS_KEY: Record<BreachSubjectsDecision, string> = {
  pending: 'breachSubjectsPending',
  notify: 'breachSubjectsNotify',
  not_required: 'breachSubjectsNotRequired',
  exception: 'breachSubjectsException',
};

export const BREACH_FIELD_LABEL_KEY: Record<BreachField, string> = {
  kind: 'breachFieldKind',
  title: 'breachFieldTitle',
  description: 'breachFieldDescription',
  detectedAt: 'breachFieldDetectedAt',
  occurredAt: 'breachFieldOccurredAt',
  dataCategories: 'breachFieldDataCategories',
  affectedCount: 'breachFieldAffectedCount',
  affectedCountEstimated: 'breachFieldAffectedCountEstimated',
  riskLevel: 'breachFieldRiskLevel',
  riskAssessment: 'breachFieldRiskAssessment',
  authorityDecision: 'breachFieldAuthorityDecision',
  authorityDecisionReason: 'breachFieldAuthorityDecisionReason',
  authorityNotifiedAt: 'breachFieldAuthorityNotifiedAt',
  authorityReference: 'breachFieldAuthorityReference',
  authorityDelayReason: 'breachFieldAuthorityDelayReason',
  subjectsDecision: 'breachFieldSubjectsDecision',
  subjectsDecisionReason: 'breachFieldSubjectsDecisionReason',
  subjectsNotifiedAt: 'breachFieldSubjectsNotifiedAt',
  actionsTaken: 'breachFieldActionsTaken',
};

export const BREACH_FIELD_ERROR_KEY: Record<BreachFieldError, string> = {
  required: 'breachErrorRequired',
  tooLong: 'breachErrorTooLong',
  invalid: 'breachErrorInvalid',
  future: 'breachErrorFuture',
  afterDetected: 'breachErrorAfterDetected',
  beforeDetected: 'breachErrorBeforeDetected',
  decisionMismatch: 'breachErrorDecisionMismatch',
  conflictsWithRisk: 'breachErrorConflictsWithRisk',
};

export const BREACH_EVENT_KEY: Record<string, string> = {
  created: 'breachEventCreated',
  updated: 'breachEventUpdated',
  closed: 'breachEventClosed',
  reopened: 'breachEventReopened',
  subjects_notified: 'breachEventSubjectsNotified',
  exported: 'breachEventExported',
};

/** Kolumna bazy w historii (`detected_at`) → pole formularza (`detectedAt`) albo null. */
export function breachFieldOfColumn(column: string): BreachField | null {
  const camel = column.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
  return (BREACH_FIELDS as readonly string[]).includes(camel) ? (camel as BreachField) : null;
}

/** Wartość w polu formularza z wiersza bazy (daty jako ISO). */
export function breachFormOf(row: {
  kind: string;
  title: string;
  description: string;
  detectedAt: string | null;
  occurredAt: string | null;
  dataCategories: string[];
  affectedCount: number | null;
  affectedCountEstimated: boolean;
  riskLevel: string;
  riskAssessment: string;
  authorityDecision: string;
  authorityDecisionReason: string;
  authorityNotifiedAt: string | null;
  authorityReference: string;
  authorityDelayReason: string;
  subjectsDecision: string;
  subjectsDecisionReason: string;
  subjectsNotifiedAt: string | null;
  actionsTaken: string;
}): BreachForm {
  return {
    kind: row.kind,
    title: row.title,
    description: row.description,
    detectedAt: row.detectedAt ?? '',
    occurredAt: row.occurredAt ?? '',
    dataCategories: row.dataCategories,
    affectedCount: row.affectedCount === null ? '' : String(row.affectedCount),
    affectedCountEstimated: row.affectedCountEstimated,
    riskLevel: row.riskLevel,
    riskAssessment: row.riskAssessment,
    authorityDecision: row.authorityDecision,
    authorityDecisionReason: row.authorityDecisionReason,
    authorityNotifiedAt: row.authorityNotifiedAt ?? '',
    authorityReference: row.authorityReference,
    authorityDelayReason: row.authorityDelayReason,
    subjectsDecision: row.subjectsDecision,
    subjectsDecisionReason: row.subjectsDecisionReason,
    subjectsNotifiedAt: row.subjectsNotifiedAt ?? '',
    actionsTaken: row.actionsTaken,
  };
}
