/**
 * Link do generatora baneru kampanii w panelu admina (`/admin/oferty/[id]/baner`).
 *
 * Link pokazujemy przy ofercie aktywnej; o tym, czy baner powstanie (niewygasła, niedemonstracyjna
 * oferta zweryfikowanej firmy), rozstrzyga baza (`get_managed_campaign_job`, 0102) — każdy inny
 * przypadek daje ten sam komunikat „baner niedostępny”. Parametr `firma` = powrót do szczegółu
 * firmy; przyjmujemy tylko bezpieczny segment ścieżki (UUID albo identyfikator demo).
 */

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

export function parseAdminBannerCompany(value: string | null | undefined): string | null {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
}

export function adminBannerHref(job: { id: string; status: string }, companyId: string): string | null {
  if (job.status !== 'active' || !SAFE_ID.test(job.id)) return null;
  const company = parseAdminBannerCompany(companyId);
  const path = `/admin/oferty/${job.id}/baner`;
  return company ? `${path}?firma=${company}` : path;
}

export function adminBannerBackHref(companyId: string | null): string {
  return companyId ? `/admin/firmy/${companyId}` : '/admin/firmy';
}
