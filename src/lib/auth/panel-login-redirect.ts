import 'server-only';

import { headers } from 'next/headers';

import { loginHref } from '@/lib/auth/next-path';
import { PANEL_RETURN_PATH_HEADER } from '@/lib/auth/panel-return-path';

/**
 * Cel przekierowania guarda panelu bez sesji (#1090): logowanie z bezpiecznym `next` = strona
 * panelu, którą otwierano (np. link z e-maila do konkretnego obiektu). Brak/niebezpieczna
 * wartość albo awaria odczytu nagłówków → zwykłe logowanie (jak dotąd).
 */
export async function panelLoginHref(): Promise<ReturnType<typeof loginHref>> {
  try {
    return loginHref((await headers()).get(PANEL_RETURN_PATH_HEADER));
  } catch {
    return loginHref(null);
  }
}
