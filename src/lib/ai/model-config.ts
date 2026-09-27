import 'server-only';

/**
 * Konfiguracja modelu funkcji AI (bez SDK — importowana przez `config.ts` funkcji, które nie
 * wołają modelu). Decyzja właściciela 2026-09-26: wyłącznie OpenAI „GPT-6 Luna”
 * (identyfikator API `gpt-6-luna`, https://developers.openai.com/api/docs/models/gpt-6-luna).
 * Klient: `src/lib/ai/openai.ts`.
 */

/** Domyślny model wszystkich funkcji AI (nadpisywalny `AI_MODEL` i zmiennymi `*_MODEL`). */
export const DEFAULT_AI_MODEL = 'gpt-6-luna';

const MODEL_ID = /^[a-z0-9][a-z0-9.-]{2,63}$/;

/**
 * Model funkcji: `<zmienna funkcji>` → `AI_MODEL` → {@link DEFAULT_AI_MODEL}. Wartość spoza
 * wzorca identyfikatora jest pomijana (bez wstrzykiwania do żądania).
 */
export function resolveAiModel(featureVariable: string | undefined): string {
  for (const candidate of [featureVariable, process.env.AI_MODEL]) {
    const m = candidate?.trim();
    if (m && MODEL_ID.test(m)) return m;
  }
  return DEFAULT_AI_MODEL;
}

/** Czy jest klucz dostawcy (bez odczytu wartości poza serwerem). */
export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}
