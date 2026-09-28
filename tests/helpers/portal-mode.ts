import { afterEach, beforeEach, vi } from 'vitest';

import { PORTAL_LEGAL_MODE_ENV } from '@/lib/portal-mode';

/**
 * Tryb produktu w Vitest (#1136). Domyślnie testy działają w trybie ogłoszeniowym (brak zmiennej
 * = `CLASSIFIEDS_ONLY`). Testy istniejących przepływów rekrutacyjnych wołają
 * `useRecruitmentMode()` na poziomie pliku albo `describe`, żeby nie tracić pokrycia, gdy akcje
 * zaczną zwracać `RECRUITMENT_DISABLED`.
 */
export function useRecruitmentMode(): void {
  beforeEach(() => {
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, 'RECRUITMENT');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
}

/** Jawny tryb ogłoszeniowy (np. gdy środowisko uruchomienia ma ustawione `RECRUITMENT`). */
export function useClassifiedsMode(): void {
  beforeEach(() => {
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
}
