import {
  SCREENING_REVIEW_REASON_MAX,
  isScreeningRiskCategory,
  type ScreeningRiskCategory,
} from '@/lib/screening/risk';

/**
 * Przegląd pytań screeningowych (#497, migracja 0099) — wspólne dla kreatora (przeglądarka),
 * Server Actions i panelu admina. Moduł bez zależności serwerowych.
 */

/** Stan pytania, które blokuje publikację (oferta w kreatorze). */
export interface ScreeningReviewNotice {
  /** Pozycja pytania w ofercie (0–9) = indeks w kreatorze. */
  index: number;
  status: 'pending' | 'rejected';
  categories: ScreeningRiskCategory[];
  /** Uzasadnienie odrzucenia od admina (tylko `rejected`). */
  reason: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function categoriesOf(value: unknown): ScreeningRiskCategory[] {
  return Array.isArray(value) ? value.filter(isScreeningRiskCategory) : [];
}

/**
 * Wiersze `job_screening_questions` (pozycja, odcisk, kategorie) + `screening_question_reviews`
 * (odcisk, status, uzasadnienie) → pytania oznaczone przez detektor bez akceptacji BIEŻĄCEJ
 * treści (ta sama reguła co strażnik `enforce_screening_review`). Brak wiersza przeglądu =
 * oczekuje. Kolejność: pozycja pytania.
 */
export function buildScreeningReviewNotices(
  questionRows: unknown,
  reviewRows: unknown,
): ScreeningReviewNotice[] {
  const reviews = new Map<string, { status: string; reason: string | null }>();
  for (const row of Array.isArray(reviewRows) ? reviewRows.map(asRecord) : []) {
    const fingerprint = row['content_fingerprint'];
    if (typeof fingerprint !== 'string') continue;
    reviews.set(fingerprint, {
      status: typeof row['status'] === 'string' ? row['status'] : 'pending',
      reason: typeof row['decision_reason'] === 'string' ? row['decision_reason'] : null,
    });
  }

  const notices: ScreeningReviewNotice[] = [];
  for (const row of Array.isArray(questionRows) ? questionRows.map(asRecord) : []) {
    const categories = categoriesOf(row['risk_categories']);
    if (categories.length === 0) continue;
    const position = Number(row['position']);
    if (!Number.isInteger(position) || position < 0) continue;
    const fingerprint = row['content_fingerprint'];
    const review = typeof fingerprint === 'string' ? reviews.get(fingerprint) : undefined;
    if (review?.status === 'approved') continue;
    const rejected = review?.status === 'rejected';
    notices.push({
      index: position,
      status: rejected ? 'rejected' : 'pending',
      categories,
      reason: rejected ? review.reason : null,
    });
  }
  return notices.sort((a, b) => a.index - b.index);
}

/** Decyzja admina o pytaniu. */
export type ScreeningReviewDecision = 'approved' | 'rejected';

export function isScreeningReviewDecision(value: unknown): value is ScreeningReviewDecision {
  return value === 'approved' || value === 'rejected';
}

/**
 * Błąd uzasadnienia decyzji albo null (te same reguły co `admin_decide_screening_review`):
 * odrzucenie wymaga uzasadnienia, każde uzasadnienie ≤ 1000 znaków.
 */
export function screeningReviewReasonError(
  decision: ScreeningReviewDecision,
  reason: string | null | undefined,
): 'required' | 'tooLong' | null {
  const trimmed = (reason ?? '').trim();
  if (decision === 'rejected' && trimmed.length === 0) return 'required';
  if (trimmed.length > SCREENING_REVIEW_REASON_MAX) return 'tooLong';
  return null;
}

/** Kategoria ryzyka → klucz i18n (namespace `screeningReview`). */
export const SCREENING_RISK_CATEGORY_KEY: Record<ScreeningRiskCategory, string> = {
  age: 'categoryAge',
  sex: 'categorySex',
  family: 'categoryFamily',
  marital: 'categoryMarital',
  religion: 'categoryReligion',
  origin: 'categoryOrigin',
  health: 'categoryHealth',
  orientation: 'categoryOrientation',
  union: 'categoryUnion',
  political: 'categoryPolitical',
  criminal: 'categoryCriminal',
};
