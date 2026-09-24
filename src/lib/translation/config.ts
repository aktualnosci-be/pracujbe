import 'server-only';

import { isProductionMode } from '@/lib/env';

/**
 * Konfiguracja tłumaczeń AI (#32). Czytana leniwie, wyłącznie na serwerze — klucz API nigdy
 * nie trafia do bundla przeglądarki. Wzorzec jak import ogłoszeń (docs/AI_JOB_IMPORT.md).
 *
 * Worker tłumaczeń działa tylko gdy:
 *   - `AI_TRANSLATION_ENABLED` = `1`/`true` (domyślnie wyłączony, także w produkcji), ORAZ
 *   - jest dostawca: `ANTHROPIC_API_KEY` albo — tylko poza trybem produkcyjnym — atrapa
 *     `AI_TRANSLATION_PROVIDER=fixture` (lokalnie, bez sieci i bez kosztów).
 *
 * Wyłączenie flagi zatrzymuje worker; źródła, rewizje i korekty ręczne zostają w bazie.
 */

/** Domyślny model (docs/AI_TRANSLATION.md); wybór docelowy po benchmarku #30. */
export const DEFAULT_TRANSLATION_MODEL = 'claude-opus-5';

export type TranslationProviderKind = 'anthropic' | 'fixture';
export type TranslationEffort = 'low' | 'medium' | 'high';

function flagOn(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/** Dostawca tłumaczeń albo `null`, gdy funkcja jest wyłączona/nieskonfigurowana. */
export function translationProvider(): TranslationProviderKind | null {
  if (!flagOn(process.env.AI_TRANSLATION_ENABLED)) return null;
  if (process.env.AI_TRANSLATION_PROVIDER === 'fixture') {
    return isProductionMode() ? null : 'fixture';
  }
  return process.env.ANTHROPIC_API_KEY ? 'anthropic' : null;
}

export function isTranslationEnabled(): boolean {
  return translationProvider() !== null;
}

/** Model Claude (nadpisywalny przez `AI_TRANSLATION_MODEL`). */
export function translationModel(): string {
  const m = process.env.AI_TRANSLATION_MODEL?.trim();
  return m && /^[a-z0-9][a-z0-9.-]{2,63}$/.test(m) ? m : DEFAULT_TRANSLATION_MODEL;
}

/** Effort (`AI_TRANSLATION_EFFORT`: low/medium/high; domyślnie low — do potwierdzenia w #30). */
export function translationEffort(): TranslationEffort {
  const e = process.env.AI_TRANSLATION_EFFORT?.trim().toLowerCase();
  return e === 'medium' || e === 'high' ? e : 'low';
}
