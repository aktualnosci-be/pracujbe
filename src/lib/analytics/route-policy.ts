/**
 * Tracking belongs on public discovery pages, never on authentication or private pages.
 * These routes can carry one-time links, return paths, or candidate data.
 */
const PRIVATE_ROOTS = new Set([
  'logowanie',
  'rejestracja',
  'rejestracja-pracodawca',
  'potwierdzenie',
  'potwierdz-email',
  'reset-hasla',
  'ustaw-nowe-haslo',
  'wypisz',
  'wypisz-alert',
  'aplikacja',
  'candidate',
  'employer',
  'admin',
  'onboarding',
]);

/**
 * Strona statusu sprawy zgłoszenia treści: kod dostępu przychodzi we fragmencie adresu
 * (`#`), więc — jak reset hasła i linki gościa — nie może trafiać do analityki.
 * Formularz zgłoszenia (`/zglos-tresc`) zostaje stroną publiczną.
 */
function isReportCasePath(segments: string[]): boolean {
  return segments[1] === 'zglos-tresc' && segments[2] === 'sprawa';
}

export function allowsTrackingOnPath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  const root = segments[1];
  if (isReportCasePath(segments)) return false;
  return !root || !PRIVATE_ROOTS.has(root);
}

/** HTTP responses for one-time links must not enter browser or shared caches. */
export function isOneTimeLinkPath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  const root = segments[1];
  return root === 'wypisz' || root === 'wypisz-alert' || root === 'ustaw-nowe-haslo' || root === 'potwierdz-email' ||
    (root === 'aplikacja' && (segments[2] === 'potwierdz' || segments[2] === 'przejmij'));
}
