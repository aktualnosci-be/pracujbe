import { AI_FEATURES, type AiFeature, type AiFeatureId } from '@/lib/ai/inventory';
import { isRecruitmentEnabled } from '@/lib/portal-mode';

/**
 * Wspólna bramka funkcji AI (#1152): flaga funkcji × tryb produktu.
 *
 * Decyzja produktowa: portal ogłoszeniowy. W trybie ogłoszeniowym (`src/lib/portal-mode.ts`,
 * domyślny i fail-closed) działają wyłącznie funkcje AI pracujące na treści ogłoszenia
 * (`allowedInClassifieds: true` w inwentarzu). Funkcja z wejściem kandydata jest wtedy
 * wyłączona niezależnie od własnej flagi `AI_*_ENABLED`. W trybie `RECRUITMENT` decyduje sama
 * flaga funkcji (bez zmian zachowania).
 *
 * Bez `server-only` i `node:*` (jak `portal-mode.ts`); odczyt `process.env` leniwy.
 */

/** Ta sama reguła co dotychczasowe `flagOn` w konfiguracjach funkcji: `1` albo `true`. */
export function aiFlagOn(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

export function aiFeature(id: AiFeatureId): AiFeature | undefined {
  return AI_FEATURES.find((feature) => feature.id === id);
}

/** Czy tryb produktu dopuszcza funkcję (bez sprawdzania jej flagi). Nieznana funkcja = nie. */
export function isAiFeatureAllowedInPortalMode(id: AiFeatureId): boolean {
  const feature = aiFeature(id);
  if (!feature) return false;
  return feature.allowedInClassifieds || isRecruitmentEnabled();
}

/** Flaga funkcji (`enableFlag` z inwentarza) włączona ORAZ tryb produktu ją dopuszcza. */
export function isAiFeatureEnabled(id: AiFeatureId): boolean {
  const feature = aiFeature(id);
  if (!feature) return false;
  return aiFlagOn(process.env[feature.enableFlag]) && isAiFeatureAllowedInPortalMode(id);
}
