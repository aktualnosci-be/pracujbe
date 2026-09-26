import 'server-only';

import { withAiUsageLog, type AiUsageOutcome, type AiUsageSink } from '@/lib/ai/usage-log';
import { OpenAiTranslationProvider } from '@/lib/translation/openai-provider';
import { translationProvider } from '@/lib/translation/config';
import {
  FixtureTranslationProvider,
  TranslationProviderError,
  type TranslationProvider,
} from '@/lib/translation/provider';
import type { TranslationQueueStore } from '@/lib/translation/store';
import { processTranslationBatch, type TranslationBatchResult } from '@/lib/translation/worker';

/**
 * Przebieg kolejki tłumaczeń ofert (#33) — wołany przez `/api/translation/process` (cron).
 *
 * Kolejkę zasilają odroczone triggery ofert (migracja 0146): każda zatwierdzona zmiana treści
 * publicznej oferty = nowa rewizja i zadania dla pozostałych języków portalu. Ten moduł tylko
 * je przetwarza: kilka paczek `processTranslationBatch`, dopóki są zadania i nie minął budżet
 * czasu. Za flagą `AI_TRANSLATION_ENABLED` (domyślnie wyłączone) — bez niej nic nie woła bazy
 * ani dostawcy, a zadania czekają bez kosztu.
 */

/** Wynik wywołania dostawcy → enum logu użycia (bez treści). */
export function classifyTranslationUsage(
  result: { ok: true } | { ok: false; error: unknown },
): AiUsageOutcome {
  if (result.ok) return 'ok';
  if (result.error instanceof TranslationProviderError) {
    if (result.error.reason === 'refused') return 'refused';
    if (result.error.reason === 'rate_limited') return 'rate_limited';
  }
  return 'failed';
}

/** Dostawca z logiem użycia AI (#489): jeden wiersz na wywołanie modelu, bez treści i PII. */
export function withTranslationUsageLog(
  provider: TranslationProvider,
  model: string,
  sink?: AiUsageSink,
): TranslationProvider {
  return {
    translate: (request) =>
      withAiUsageLog(
        { feature: 'content_translation', inputKind: 'text', model },
        () => provider.translate(request),
        classifyTranslationUsage,
        sink,
      ),
  };
}

/** Dostawca wg konfiguracji albo `null`, gdy funkcja jest wyłączona/nieskonfigurowana. */
export function createTranslationProvider(): TranslationProvider | null {
  const kind = translationProvider();
  if (kind === 'fixture') return withTranslationUsageLog(new FixtureTranslationProvider(), 'fixture');
  // Adapter OpenAI sam loguje użycie i rezerwuje budżet AI (#36, `withAiBudget`) — bez
  // drugiego wiersza logu tutaj.
  if (kind === 'openai') return new OpenAiTranslationProvider();
  return null;
}

export interface TranslationRunResult extends TranslationBatchResult {
  batches: number;
}

export interface TranslationRunDeps {
  store: TranslationQueueStore;
  provider: TranslationProvider;
  /** Najwięcej paczek w jednym przebiegu. */
  maxBatches?: number;
  batchSize?: number;
  /** Budżet czasu przebiegu; nowa paczka nie startuje po jego przekroczeniu. */
  deadlineMs?: number;
  now?: () => number;
}

/** Kilka paczek po kolei (mała pula service_role); pusta paczka kończy przebieg. */
export async function runTranslationQueue(deps: TranslationRunDeps): Promise<TranslationRunResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const maxBatches = Math.min(Math.max(deps.maxBatches ?? 5, 1), 20);
  const deadline = deps.deadlineMs ?? 20_000;
  const total: TranslationRunResult = {
    batches: 0,
    claimed: 0,
    applied: 0,
    proposals: 0,
    superseded: 0,
    retried: 0,
    deferred: 0,
    failed: 0,
    dropped: 0,
  };
  while (total.batches < maxBatches && now() - started < deadline) {
    const r = await processTranslationBatch({
      store: deps.store,
      provider: deps.provider,
      limit: deps.batchSize ?? 5,
    });
    total.batches++;
    total.claimed += r.claimed;
    total.applied += r.applied;
    total.proposals += r.proposals;
    total.superseded += r.superseded;
    total.retried += r.retried;
    total.deferred += r.deferred;
    total.failed += r.failed;
    total.dropped += r.dropped;
    if (r.claimed === 0) break;
  }
  return total;
}
