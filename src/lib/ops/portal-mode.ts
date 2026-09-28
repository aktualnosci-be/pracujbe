/**
 * Dwuklucz trybu portalu (#1143, epik #1128) — decyzja produktowa: portal ogłoszeniowy.
 *
 * Rekrutacja działa WYŁĄCZNIE, gdy oba klucze ją włączają: env `PORTAL_LEGAL_MODE=RECRUITMENT`
 * (`src/lib/portal-mode.ts`, #1136) ORAZ `recruitment_enabled()` w bazie (migracja 0171).
 * Każda rozbieżność = tryb ogłoszeniowy; czujka `/api/health/ops` zgłasza ją jako alarm
 * `portal_legal_mode_mismatch` (monitoring widzi, że jeden klucz zmieniono bez drugiego).
 *
 * Moduł czysty (bez I/O) — testowany jednostkowo z kontrolą ujemną.
 */

export type PortalLegalModeSignal = 'portal_legal_mode_mismatch';

/** Tryb efektywny: iloczyn kluczy env i bazy. */
export function effectiveRecruitmentEnabled(envRecruitment: boolean, dbRecruitment: boolean): boolean {
  return envRecruitment && dbRecruitment;
}

/**
 * @param dbRecruitmentEnabled `ops_metrics().portalLegalMode.recruitmentEnabled` (0/1); brak
 *   sekcji (baza sprzed 0171) = tryb ogłoszeniowy bazy — fail-closed, jak `recruitment_enabled()`.
 * @param envRecruitment klucz środowiskowy (`isRecruitmentEnabled()`).
 */
export function portalLegalModeAlerts(
  dbRecruitmentEnabled: 0 | 1 | null | undefined,
  envRecruitment: boolean,
): PortalLegalModeSignal[] {
  const db = dbRecruitmentEnabled === 1;
  return db === envRecruitment ? [] : ['portal_legal_mode_mismatch'];
}

export type PortalModeName = 'CLASSIFIEDS_ONLY' | 'RECRUITMENT';

/** Opis trybu w odpowiedzi czujek (same nazwy trybów, bez konfiguracji). */
export function portalLegalModeSummary(
  dbRecruitmentEnabled: 0 | 1 | null | undefined,
  envRecruitment: boolean,
): { env: PortalModeName; database: PortalModeName; effective: PortalModeName } {
  const name = (on: boolean): PortalModeName => (on ? 'RECRUITMENT' : 'CLASSIFIEDS_ONLY');
  const db = dbRecruitmentEnabled === 1;
  return { env: name(envRecruitment), database: name(db), effective: name(effectiveRecruitmentEnabled(envRecruitment, db)) };
}
