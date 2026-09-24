import 'server-only';

import { isLocale } from '@/i18n/routing';
import { TranslationProviderError, type TranslationProvider } from '@/lib/translation/provider';
import type { ClaimedTranslationJob, TranslationQueueStore } from '@/lib/translation/store';
import { validateTranslation } from '@/lib/translation/validate';

/**
 * Worker kolejki tłumaczeń (#31/#32). Jedna paczka:
 *   1. `claim` — krótka transakcja w bazie (SKIP LOCKED + dzierżawa),
 *   2. wywołanie dostawcy POZA transakcją (równolegle w obrębie paczki),
 *   3. walidacja kształtu i faktów — niepoprawny wynik nigdy nie jest zapisywany,
 *   4. `complete` (CAS po lease + kontrola bieżącej rewizji w bazie) albo `fail` z kodem.
 *
 * Log i monitoring dostają wyłącznie kody i liczniki — nigdy treści pól, promptu ani
 * komunikatów dostawcy.
 */

export interface TranslationBatchResult {
  claimed: number;
  applied: number;
  proposals: number;
  superseded: number;
  retried: number;
  failed: number;
  /** Zadania, których wyniku nie zapisano (utracona dzierżawa albo błąd zapisu). */
  dropped: number;
}

export interface TranslationWorkerDeps {
  store: TranslationQueueStore;
  provider: TranslationProvider;
  limit?: number;
  leaseSeconds?: number;
  /** Tylko kody i identyfikatory techniczne. */
  onEvent?: (event: { jobId: string; outcome: string; code?: string }) => void;
}

type JobOutcome = 'applied' | 'proposal' | 'superseded' | 'retry' | 'failed' | 'dropped';

async function processJob(job: ClaimedTranslationJob, deps: TranslationWorkerDeps): Promise<{ outcome: JobOutcome; code?: string }> {
  const { store, provider } = deps;

  async function fail(code: string, retryable: boolean, retryAfter: number | null = null) {
    try {
      const r = await store.fail(job, code, retryable, retryAfter);
      if (r === 'retry' || r === 'failed' || r === 'superseded') return { outcome: r, code };
      return { outcome: 'dropped' as const, code };
    } catch {
      // Dzierżawa wygaśnie, zadanie wróci do puli.
      return { outcome: 'dropped' as const, code: 'store_error' };
    }
  }

  if (!isLocale(job.source_locale) || !isLocale(job.target_locale)) {
    return fail('unsupported_locale', false);
  }

  let response;
  try {
    response = await provider.translate({
      sourceLocale: job.source_locale,
      targetLocale: job.target_locale,
      fields: job.fields,
    });
  } catch (e) {
    if (e instanceof TranslationProviderError) return fail(e.reason, e.retryable, e.retryAfterSeconds);
    return fail('provider_error', true);
  }

  const result = validateTranslation({
    source: job.fields,
    sourceLocale: job.source_locale,
    targetLocale: job.target_locale,
    output: response.output,
  });
  // Niepoprawny wynik dla tej samej treści i wersji pipeline jest trwały — bez ponawiania.
  if (!result.ok) return fail(result.code, false);

  try {
    const r = await store.complete(job, result.fields, {
      model: response.model,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    });
    if (r === 'applied' || r === 'proposal' || r === 'superseded') return { outcome: r };
    return { outcome: 'dropped', code: r };
  } catch {
    return { outcome: 'dropped', code: 'store_error' };
  }
}

export async function processTranslationBatch(deps: TranslationWorkerDeps): Promise<TranslationBatchResult> {
  const limit = Math.min(Math.max(deps.limit ?? 3, 1), 20);
  const jobs = await deps.store.claim(limit, deps.leaseSeconds ?? 300);
  const result: TranslationBatchResult = {
    claimed: jobs.length,
    applied: 0,
    proposals: 0,
    superseded: 0,
    retried: 0,
    failed: 0,
    dropped: 0,
  };
  const outcomes = await Promise.all(jobs.map((job) => processJob(job, deps)));
  outcomes.forEach(({ outcome, code }, i) => {
    deps.onEvent?.({ jobId: jobs[i]?.job_id ?? '', outcome, code });
    if (outcome === 'applied') result.applied++;
    else if (outcome === 'proposal') result.proposals++;
    else if (outcome === 'superseded') result.superseded++;
    else if (outcome === 'retry') result.retried++;
    else if (outcome === 'failed') result.failed++;
    else result.dropped++;
  });
  return result;
}
