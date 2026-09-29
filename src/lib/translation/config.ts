import 'server-only';

import { isAiFeatureEnabled } from '@/lib/ai/feature-gate';
import { isOpenAiConfigured, resolveAiModel } from '@/lib/ai/model-config';
import { isProductionMode } from '@/lib/env';

/**
 * Konfiguracja tłumaczeń AI (#32). Czytana leniwie, wyłącznie na serwerze — klucz API nigdy
 * nie trafia do bundla przeglądarki. Wzorzec jak import ogłoszeń (docs/AI_JOB_IMPORT.md).
 *
 * Worker tłumaczeń działa tylko gdy:
 *   - `AI_TRANSLATION_ENABLED` = `1`/`true` (domyślnie wyłączony, także w produkcji), ORAZ
 *   - jest dostawca: `OPENAI_API_KEY` (wspólny klient `src/lib/ai/openai.ts`) albo — tylko poza
 *     trybem produkcyjnym — atrapa `AI_TRANSLATION_PROVIDER=fixture` (lokalnie, bez sieci i bez kosztów).
 *
 * Wyłączenie flagi zatrzymuje worker; źródła, rewizje i korekty ręczne zostają w bazie.
 */

export type TranslationProviderKind = 'openai' | 'fixture';

function flagOn(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/** Dostawca tłumaczeń albo `null`, gdy funkcja jest wyłączona/nieskonfigurowana. */
export function translationProvider(): TranslationProviderKind | null {
  // #1152: flaga funkcji × tryb produktu (wspólna bramka `src/lib/ai/feature-gate.ts`).
  if (!isAiFeatureEnabled('content_translation')) return null;
  if (process.env.AI_TRANSLATION_PROVIDER === 'fixture') {
    return isProductionMode() ? null : 'fixture';
  }
  return isOpenAiConfigured() ? 'openai' : null;
}

export function isTranslationEnabled(): boolean {
  return translationProvider() !== null;
}

/**
 * Czy publiczne strony ofert pokazują gotowe przekłady (#33). Sama flaga — bez wymogu klucza
 * dostawcy: przekład zapisany w bazie jest ważny także wtedy, gdy worker chwilowo nie działa.
 * Wyłączenie flagi ukrywa przekłady (strona wraca do treści w języku oryginału).
 */
export function isTranslationDisplayEnabled(): boolean {
  return flagOn(process.env.AI_TRANSLATION_ENABLED);
}

/** Model: `AI_TRANSLATION_MODEL` → `AI_MODEL` → `gpt-6-luna` (`src/lib/ai/model-config.ts`). */
export function translationModel(): string {
  return resolveAiModel(process.env.AI_TRANSLATION_MODEL);
}
