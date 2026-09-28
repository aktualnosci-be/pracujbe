import { JOB_FRAUD_CATEGORIES } from '@/lib/job-trust/fraud-risk';

/**
 * Przegląd treści oferty (0167, zaufanie ofert) — wspólne dla kreatora (przeglądarka),
 * Server Actions i panelu admina. Moduł bez zależności serwerowych.
 */

/** Kategorie sygnału: reguły (`JOB_FRAUD_CATEGORIES`) + dodatkowe kategorie analizy AI. */
export const JOB_CONTENT_SIGNAL_CATEGORIES = [
  ...JOB_FRAUD_CATEGORIES,
  'personal_data_request',
  'unrealistic_offer',
  'other',
] as const;
export type JobContentSignalCategory = (typeof JOB_CONTENT_SIGNAL_CATEGORIES)[number];

export function isJobContentSignalCategory(value: unknown): value is JobContentSignalCategory {
  return (
    typeof value === 'string' && (JOB_CONTENT_SIGNAL_CATEGORIES as readonly string[]).includes(value)
  );
}

/** Kategoria → klucz i18n (namespace `jobTrust`). */
export const JOB_CONTENT_CATEGORY_KEY: Record<JobContentSignalCategory, string> = {
  candidate_fee: 'categoryCandidateFee',
  off_platform_contact: 'categoryOffPlatformContact',
  crypto_tasks: 'categoryCryptoTasks',
  payment_request: 'categoryPaymentRequest',
  personal_data_request: 'categoryPersonalDataRequest',
  unrealistic_offer: 'categoryUnrealisticOffer',
  other: 'categoryOther',
};

export type JobContentReviewStatus = 'pending' | 'approved' | 'rejected';

/** Stan treści oferty z RPC `job_trust_state` (0167). */
export interface JobTrustState {
  fingerprint: string;
  /** Kanoniczna migawka treści (wejście analizy AI). */
  content: unknown;
  ruleCategories: JobContentSignalCategory[];
  aiCategories: JobContentSignalCategory[];
  /** `null` = brak przeglądu dla bieżącej treści. */
  status: JobContentReviewStatus | null;
  reason: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function categoriesOf(value: unknown): JobContentSignalCategory[] {
  return Array.isArray(value) ? value.filter(isJobContentSignalCategory) : [];
}

export function parseJobTrustState(raw: unknown): JobTrustState | null {
  const r = asRecord(raw);
  const fingerprint = r['fingerprint'];
  if (typeof fingerprint !== 'string' || fingerprint.length === 0) return null;
  const status = r['status'];
  return {
    fingerprint,
    content: r['content'] ?? null,
    ruleCategories: categoriesOf(r['rule_categories']),
    aiCategories: categoriesOf(r['ai_categories']),
    status: status === 'pending' || status === 'approved' || status === 'rejected' ? status : null,
    reason: typeof r['decision_reason'] === 'string' ? r['decision_reason'] : null,
  };
}

/** Treść blokująca publikację — dla kreatora (ta sama reguła co strażnik w bazie). */
export interface JobContentReviewNotice {
  status: 'pending' | 'rejected';
  categories: JobContentSignalCategory[];
  reason: string | null;
}

export function jobContentReviewNotice(state: JobTrustState | null): JobContentReviewNotice | null {
  if (!state || state.status === 'approved') return null;
  const categories = [...new Set([...state.ruleCategories, ...state.aiCategories])];
  if (state.status === 'rejected') return { status: 'rejected', categories, reason: state.reason };
  if (state.status === 'pending' || state.ruleCategories.length > 0) {
    return { status: 'pending', categories, reason: null };
  }
  return null;
}

export type JobContentReviewDecision = 'approved' | 'rejected';

export function isJobContentReviewDecision(value: unknown): value is JobContentReviewDecision {
  return value === 'approved' || value === 'rejected';
}

/** Limit uzasadnienia decyzji — ten sam co w `admin_decide_job_content_review`. */
export const JOB_CONTENT_REVIEW_REASON_MAX = 1000;

export function jobContentReviewReasonError(
  decision: JobContentReviewDecision,
  reason: string | null | undefined,
): 'required' | 'tooLong' | null {
  const trimmed = (reason ?? '').trim();
  if (decision === 'rejected' && trimmed.length === 0) return 'required';
  if (trimmed.length > JOB_CONTENT_REVIEW_REASON_MAX) return 'tooLong';
  return null;
}

/**
 * Teksty migawki treści (wszystkie liście tekstowe, w kolejności) — wejście minimalizacji
 * przed analizą AI i podgląd w panelu admina.
 */
export function jobTrustContentTexts(content: unknown, depth = 0): string[] {
  if (depth > 6) return [];
  if (typeof content === 'string') return content.trim() ? [content] : [];
  if (Array.isArray(content)) return content.flatMap((item) => jobTrustContentTexts(item, depth + 1));
  if (typeof content === 'object' && content !== null) {
    return Object.entries(content as Record<string, unknown>)
      .filter(([key]) => key !== 'locale' && key !== 'kind')
      .flatMap(([, value]) => jobTrustContentTexts(value, depth + 1));
  }
  return [];
}
