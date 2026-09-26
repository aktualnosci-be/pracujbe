/**
 * Reguły decyzji o linkach firmy czekających na akceptację (0144) — wspólne dla dialogu w
 * `/admin/firmy/[id]` i akcji `reviewCompanyLink` (te same limity co RPC
 * `admin_review_company_link` i CHECK `companies_link_rejection_len`).
 */

export type CompanyLinkField = 'website' | 'logo_url';
export type CompanyLinkDecision = 'approve' | 'reject';

export const COMPANY_LINK_REASON_MAX = 1000;

export function isCompanyLinkField(value: unknown): value is CompanyLinkField {
  return value === 'website' || value === 'logo_url';
}

export function isCompanyLinkDecision(value: unknown): value is CompanyLinkDecision {
  return value === 'approve' || value === 'reject';
}

/** Odrzucenie wymaga uzasadnienia; przy akceptacji jest opcjonalne (trafia do dziennika). */
export function companyLinkReasonError(
  decision: CompanyLinkDecision,
  reason: string,
): 'required' | 'tooLong' | null {
  const trimmed = reason.trim();
  if (decision === 'reject' && trimmed.length === 0) return 'required';
  if (trimmed.length > COMPANY_LINK_REASON_MAX) return 'tooLong';
  return null;
}
