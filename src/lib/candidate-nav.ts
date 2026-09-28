/**
 * Nawigacja panelu kandydata (#1142) — jedno źródło listy pozycji zależnej od trybu produktu.
 *
 * Decyzja produktowa: portal ogłoszeniowy. W trybie `CLASSIFIEDS_ONLY` (domyślnym) konto służy
 * do zapisanych ofert, zapisanych wyszukiwań i ustawień — bez profilu zawodowego, zgłoszeń,
 * propozycji, polecanych ofert i wiadomości. Tryb `RECRUITMENT` przywraca pełny panel.
 *
 * Moduł bez `server-only` i bez odczytu trybu: tryb przychodzi z serwera (`isRecruitmentEnabled()`
 * w layoucie) — komponent kliencki `CandidateShell` go nie liczy (#1128).
 */

/** Ścieżki nawigacji panelu (bez prefiksu locale — dokłada go next-intl Link). */
export const CANDIDATE_NAV_HREF = {
  summary: '/candidate',
  recommended: '/candidate/oferty-polecane',
  saved: '/candidate/zapisane',
  searches: '/candidate/wyszukiwania',
  applications: '/candidate/aplikacje',
  proposals: '/candidate/propozycje',
  messages: '/candidate/wiadomosci',
  profile: '/candidate/profil',
  settings: '/candidate/ustawienia',
} as const;

export type CandidateNavKey = keyof typeof CANDIDATE_NAV_HREF;

/** Pełny panel (tryb `RECRUITMENT`) — kolejność pozycji w sidebarze. */
const RECRUITMENT_NAV: readonly CandidateNavKey[] = [
  'summary',
  'recommended',
  'saved',
  'searches',
  'applications',
  'proposals',
  'messages',
  'profile',
  'settings',
];

/** Konto w portalu ogłoszeniowym: dokładnie te cztery pozycje (+ dzwonek w topbarze). */
export const CLASSIFIEDS_CANDIDATE_NAV: readonly CandidateNavKey[] = ['summary', 'saved', 'searches', 'settings'];

export function candidateNavKeys(recruitmentEnabled: boolean): readonly CandidateNavKey[] {
  return recruitmentEnabled ? RECRUITMENT_NAV : CLASSIFIEDS_CANDIDATE_NAV;
}

/** Ścieżka kreatora onboardingu — w trybie ogłoszeniowym 404 (renderowane w panelu). */
export function isOnboardingPath(pathname: string): boolean {
  return pathname === '/candidate/onboarding' || pathname.startsWith('/candidate/onboarding/');
}
