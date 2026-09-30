/**
 * Opis firmy z zatwierdzaniem przez admina portalu (#868, migracja 0198).
 *
 * `companies.description` = tekst ZATWIERDZONY (jedyny czytany publicznie: profil firmy,
 * Organization JSON-LD, szczegół oferty). Propozycja firmy czeka w `description_pending` ze
 * stanem `description_review_status` (`pending` / `rejected`). Limity = CHECK-i w bazie.
 */

/** Maks. długość opisu firmy (znaki po przycięciu) — CHECK `companies_description_pending_len`. */
export const COMPANY_DESCRIPTION_MAX = 1500;

/** Maks. długość uzasadnienia odrzucenia — jak w RPC `admin_decide_company_description`. */
export const COMPANY_DESCRIPTION_REASON_MAX = 1000;

import { isLocale, type Locale } from '@/i18n/routing';

export type CompanyDescriptionReviewStatus = 'pending' | 'rejected';

export interface CompanyDescriptionReview {
  status: CompanyDescriptionReviewStatus;
  /** Proponowany tekst (zawsze niepusty — usunięcie opisu wchodzi od razu). */
  text: string;
  /** Czas zgłoszenia — klucz CAS decyzji admina (`p_expected_pending_at`). */
  submittedAt: string | null;
  /** Uzasadnienie odrzucenia (tylko `rejected`). */
  reason: string | null;
  /**
   * Język propozycji (0975, `description_locale_pending`) — przy akceptacji staje się językiem
   * zatwierdzonego opisu; null = nie wskazano (po akceptacji język nieznany).
   */
  locale: Locale | null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Stan propozycji z wiersza `companies` (kolumny 0198); brak propozycji → `null`. */
export function parseCompanyDescriptionReview(
  row: Record<string, unknown>,
): CompanyDescriptionReview | null {
  const status = row['description_review_status'];
  if (status !== 'pending' && status !== 'rejected') return null;
  const text = textOrNull(row['description_pending']);
  if (text === null) return null;
  return {
    status,
    text,
    submittedAt: textOrNull(row['description_pending_at']),
    reason: status === 'rejected' ? textOrNull(row['description_review_reason']) : null,
    locale: isLocale(row['description_locale_pending']) ? row['description_locale_pending'] : null,
  };
}

/** Walidacja uzasadnienia decyzji — lustro RPC (odrzucenie wymaga, limit 1000). */
export function companyDescriptionReasonError(
  decision: 'approved' | 'rejected',
  reason: string,
): 'required' | 'tooLong' | null {
  const trimmed = reason.trim();
  if (decision === 'rejected' && trimmed.length === 0) return 'required';
  if (trimmed.length > COMPANY_DESCRIPTION_REASON_MAX) return 'tooLong';
  return null;
}
