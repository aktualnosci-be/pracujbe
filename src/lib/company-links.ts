/**
 * Adres publiczny firmy (strona WWW / logo) — lustro reguły SQL `public.public_https_url`
 * (migracja `0114_public_job_company_links.sql`, twardy CHECK w `0141_company_links_edit.sql`).
 *
 * Reguła: bezwzględny `https://`, nazwa hosta z co najmniej jedną kropką, bez spacji/cudzysłowów/
 * nawiasów kątowych, najwyżej 2048 znaków po przycięciu białych znaków. Pusty tekst = brak
 * adresu (czyszczenie pola), nie błąd walidacji — o tym decyduje osobno `required`.
 *
 * Ten sam wzorzec w Zod (`src/lib/validation/company.ts`) i w bazie — jedno źródło reguły,
 * żeby formularz i baza zgadzały się co do tego, co jest poprawnym adresem (test
 * `company-links.test.ts` porównuje oba 1:1).
 */

const HTTPS_URL_RE =
  /^https:\/\/[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+(:[0-9]{1,5})?([/?#][A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*)?$/;

export const COMPANY_URL_MAX_LENGTH = 2048;
const COMPANY_URL_MIN_LENGTH = 12;

/** `true`, gdy `value` (po przycięciu) jest bezwzględnym adresem https jak w bazie. */
export function isPublicHttpsUrl(value: string): boolean {
  const v = value.trim();
  return (
    v.length >= COMPANY_URL_MIN_LENGTH &&
    v.length <= COMPANY_URL_MAX_LENGTH &&
    HTTPS_URL_RE.test(v)
  );
}

/**
 * `true`, gdy `url` wskazuje na TEN SAM host co `ownHost` (np. `NEXT_PUBLIC_SITE_URL`) —
 * jedyny przypadek, w którym `next/image` może wyrenderować podgląd bez rozszerzania CSP/
 * `remotePatterns` na dowolne hosty (`img-src 'self'`, `images.remotePatterns: []`). W praktyce
 * adres logo firmy prawie zawsze wskazuje na inny host, więc formularz pokazuje wtedy sam adres.
 */
export function sameOriginHost(url: string, ownHost: string): boolean {
  if (!ownHost) return false;
  try {
    return new URL(url).host.toLowerCase() === ownHost.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Propozycja zmiany strony WWW/logo czekająca na decyzję admina portalu (migracja 0204).
 * Pola publiczne (`website`/`logo_url`) zmienia wyłącznie `admin_decide_company_links`;
 * `pending` = czeka w kolejce, `rejected` = odrzucona z uzasadnieniem (firma może poprawić).
 */
export type CompanyLinksReviewStatus = 'pending' | 'rejected';

export interface CompanyLinksReview {
  status: CompanyLinksReviewStatus;
  /** Proponowany stan docelowy (NULL = bez adresu). */
  website: string | null;
  logoUrl: string | null;
  /** Czas zgłoszenia — klucz CAS decyzji admina (`p_expected_pending_at`). */
  submittedAt: string | null;
  /** Uzasadnienie odrzucenia (tylko `rejected`). */
  reason: string | null;
}

/** Maks. długość uzasadnienia odrzucenia — jak w RPC `admin_decide_company_links` (0204). */
export const COMPANY_LINKS_REASON_MAX = 1000;

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Stan propozycji z wiersza `companies` (kolumny 0204); brak propozycji → `null`. */
export function parseCompanyLinksReview(row: Record<string, unknown>): CompanyLinksReview | null {
  const status = row['links_review_status'];
  if (status !== 'pending' && status !== 'rejected') return null;
  return {
    status,
    website: textOrNull(row['website_pending']),
    logoUrl: textOrNull(row['logo_url_pending']),
    submittedAt: textOrNull(row['links_pending_at']),
    reason: status === 'rejected' ? textOrNull(row['links_review_reason']) : null,
  };
}

/** Walidacja uzasadnienia decyzji — lustro RPC (odrzucenie wymaga, limit 1000). */
export function companyLinksReasonError(
  decision: 'approved' | 'rejected',
  reason: string,
): 'required' | 'tooLong' | null {
  const trimmed = reason.trim();
  if (decision === 'rejected' && trimmed.length === 0) return 'required';
  if (trimmed.length > COMPANY_LINKS_REASON_MAX) return 'tooLong';
  return null;
}
