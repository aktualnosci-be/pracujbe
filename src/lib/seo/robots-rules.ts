import { routing } from '@/i18n/routing';

/** Katalogi paneli w `src/app/[locale]` (noindex) — blokowane w robots. */
export const PANEL_SEGMENTS = ['candidate', 'employer', 'admin'] as const;

/**
 * PERF-03 (#1217): reguły zakotwiczone na segmencie języka. W robots `*` pasuje też do `/`,
 * a reguła jest prefiksem, więc dawna reguła „gwiazdka/admin” blokowała `/nl/oferty-pracy/administratief-…`
 * (i profile firm o takich slugach). Teraz: dokładnie `/<język>/<panel>` (`$`) i wszystko pod
 * `/<język>/<panel>/`.
 */
export function panelDisallowRules(): string[] {
  return routing.locales.flatMap((locale) =>
    PANEL_SEGMENTS.flatMap((panel) => [`/${locale}/${panel}$`, `/${locale}/${panel}/`]),
  );
}
