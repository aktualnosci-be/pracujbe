import { afterEach, beforeEach, vi } from 'vitest';

import { PORTAL_LEGAL_MODE_ENV } from '@/lib/portal-mode';

/**
 * Tryb produktu w Vitest (#1136). Domyślnie testy działają w trybie ogłoszeniowym (brak zmiennej
 * = `CLASSIFIEDS_ONLY`). Testy istniejących przepływów rekrutacyjnych wołają
 * `withRecruitmentMode()` na poziomie pliku albo `describe`, żeby nie tracić pokrycia, gdy akcje
 * zaczną zwracać `RECRUITMENT_DISABLED`.
 *
 * Nazwy `with…`, nie `use…`: to rejestracja hooków Vitest (`beforeEach`/`afterEach`), nie hook
 * Reacta — prefiks `use` łamał regułę `react-hooks/rules-of-hooks` przy wywołaniu w `describe`.
 */
export function withRecruitmentMode(): void {
  beforeEach(() => {
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, 'RECRUITMENT');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
}

/** Jawny tryb ogłoszeniowy (np. gdy środowisko uruchomienia ma ustawione `RECRUITMENT`). */
export function withClassifiedsMode(): void {
  beforeEach(() => {
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
}
