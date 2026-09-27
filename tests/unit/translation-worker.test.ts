import { describe, expect, it, vi } from 'vitest';

import { BUDGET_DEFER_SECONDS, processTranslationBatch } from '@/lib/translation/worker';
import {
  FixtureTranslationProvider,
  TranslationProviderError,
  type TranslationProvider,
} from '@/lib/translation/provider';
import type { ClaimedTranslationJob, TranslationQueueStore } from '@/lib/translation/store';

/** #31/#32 — worker na atrapach kolejki i dostawcy (bez bazy i bez sieci). */
const FIELDS = { title: 'Magazynier', description: 'Stawka 15,50 EUR brutto za godzinę. Nie wymagamy doświadczenia.' };

function job(overrides: Partial<ClaimedTranslationJob> = {}): ClaimedTranslationJob {
  return {
    job_id: 'job-1',
    lease_id: 'lease-1',
    lease_expires_at: new Date(Date.now() + 300_000).toISOString(),
    attempt: 1,
    entity_type: 'job',
    entity_id: 'entity-1',
    revision_id: 'rev-1',
    revision_no: 1,
    source_locale: 'pl',
    target_locale: 'en',
    pipeline_version: 'translation-v1',
    fields: FIELDS,
    ...overrides,
  };
}

function store(jobs: ClaimedTranslationJob[], completeOutcome: Awaited<ReturnType<TranslationQueueStore['complete']>> = 'applied') {
  const s = {
    claim: vi.fn(async () => jobs),
    complete: vi.fn(async () => completeOutcome),
    fail: vi.fn(async (_j: ClaimedTranslationJob, _c: string, retryable: boolean) => (retryable ? 'retry' : 'failed') as 'retry' | 'failed'),
    defer: vi.fn(async () => 'deferred' as const),
  };
  return s satisfies TranslationQueueStore;
}

function provider(output: unknown | Error): TranslationProvider {
  return {
    translate: vi.fn(async () => {
      if (output instanceof Error) throw output;
      return { output, model: 'gpt-6-luna', inputTokens: 10, outputTokens: 5 };
    }),
  };
}

const GOOD = { title: 'Warehouse worker', description: 'Rate 15.50 EUR gross per hour. No experience required.' };

describe('processTranslationBatch', () => {
  it('poprawny przekład → complete z tokenami', async () => {
    const s = store([job()]);
    const r = await processTranslationBatch({ store: s, provider: provider(GOOD) });
    expect(r).toMatchObject({ claimed: 1, applied: 1, failed: 0 });
    expect(s.complete).toHaveBeenCalledWith(expect.objectContaining({ job_id: 'job-1' }), GOOD, {
      model: 'gpt-6-luna',
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it('zmieniona stawka → failed (trwale), wynik nigdy nie zapisany', async () => {
    const s = store([job()]);
    const r = await processTranslationBatch({
      store: s,
      provider: provider({ ...GOOD, description: GOOD.description.replace('15.50', '15.60') }),
    });
    expect(r.failed).toBe(1);
    expect(s.complete).not.toHaveBeenCalled();
    expect(s.fail).toHaveBeenCalledWith(expect.anything(), 'facts_numbers', false, null);
  });

  it('niepełna odpowiedź (brak pola) → failed missing_field', async () => {
    const s = store([job()]);
    await processTranslationBatch({ store: s, provider: provider({ title: GOOD.title }) });
    expect(s.complete).not.toHaveBeenCalled();
    expect(s.fail).toHaveBeenCalledWith(expect.anything(), 'missing_field', false, null);
  });

  it('429 → retry z Retry-After; odmowa → failed', async () => {
    const s = store([job()]);
    const r = await processTranslationBatch({ store: s, provider: provider(new TranslationProviderError('rate_limited', 30)) });
    expect(r.retried).toBe(1);
    expect(s.fail).toHaveBeenCalledWith(expect.anything(), 'rate_limited', true, 30);

    const s2 = store([job()]);
    const r2 = await processTranslationBatch({ store: s2, provider: provider(new TranslationProviderError('refused')) });
    expect(r2.failed).toBe(1);
    expect(s2.fail).toHaveBeenCalledWith(expect.anything(), 'refused', false, null);
  });

  it('odmowa budżetu AI (#36) → odroczenie bez zużycia próby, nie fail', async () => {
    const s = store([job(), job({ job_id: 'job-2', target_locale: 'fr' })]);
    const p: TranslationProvider = {
      translate: vi
        .fn()
        .mockRejectedValueOnce(new TranslationProviderError('budget_exceeded'))
        .mockRejectedValueOnce(new TranslationProviderError('budget_unavailable')),
    };
    const r = await processTranslationBatch({ store: s, provider: p });
    expect(r).toMatchObject({ claimed: 2, deferred: 2, retried: 0, failed: 0 });
    expect(s.fail).not.toHaveBeenCalled();
    expect(s.defer).toHaveBeenCalledWith(expect.objectContaining({ job_id: 'job-1' }), 'budget_exceeded', BUDGET_DEFER_SECONDS.budget_exceeded);
    expect(s.defer).toHaveBeenCalledWith(expect.objectContaining({ job_id: 'job-2' }), 'budget_unavailable', BUDGET_DEFER_SECONDS.budget_unavailable);
  });

  it('kontrola ujemna: zwykły błąd przejściowy nadal zużywa próbę (fail retryable), nie defer', async () => {
    const s = store([job()]);
    await processTranslationBatch({ store: s, provider: provider(new TranslationProviderError('timeout')) });
    expect(s.defer).not.toHaveBeenCalled();
    expect(s.fail).toHaveBeenCalledWith(expect.anything(), 'timeout', true, null);
  });

  it('błąd zapisu odroczenia = dropped (dzierżawa wygaśnie)', async () => {
    const s = store([job()]);
    s.defer.mockRejectedValueOnce(new Error('db down'));
    const r = await processTranslationBatch({ store: s, provider: provider(new TranslationProviderError('budget_exceeded')) });
    expect(r).toMatchObject({ deferred: 0, dropped: 1 });
  });

  it('nieznany wyjątek dostawcy → retry z kodem technicznym', async () => {
    const s = store([job()]);
    await processTranslationBatch({ store: s, provider: provider(new Error('Magazynier secret text')) });
    expect(s.fail).toHaveBeenCalledWith(expect.anything(), 'provider_error', true, null);
  });

  it('wynik starej rewizji / utracony lease są liczone, nie zapisane jako sukces', async () => {
    const s = store([job()], 'superseded');
    expect((await processTranslationBatch({ store: s, provider: provider(GOOD) })).superseded).toBe(1);
    const s2 = store([job()], 'stale_lease');
    expect((await processTranslationBatch({ store: s2, provider: provider(GOOD) })).dropped).toBe(1);
  });

  it('błąd zapisu nie przerywa paczki; zdarzenia bez treści pól', async () => {
    // Atrapa zostawia tekst źródła, więc pola bez słów zależnych od języka (negacja, brutto).
    const neutral = { title: 'Magazynier', description: 'Antwerpia, 38 h, 15,50 EUR, VCA' };
    const s = store([job({ fields: neutral }), job({ job_id: 'job-2', target_locale: 'fr', fields: neutral })]);
    s.complete.mockRejectedValueOnce(new Error('db down'));
    const events: unknown[] = [];
    const r = await processTranslationBatch({
      store: s,
      provider: new FixtureTranslationProvider(),
      onEvent: (e) => events.push(e),
    });
    expect(r).toMatchObject({ claimed: 2, applied: 1, dropped: 1 });
    expect(JSON.stringify(events)).not.toMatch(/Magazynier|Antwerpia|15,50/);
  });

  it('pusta kolejka nie woła dostawcy', async () => {
    const p = provider(GOOD);
    const r = await processTranslationBatch({ store: store([]), provider: p });
    expect(r.claimed).toBe(0);
    expect(p.translate).not.toHaveBeenCalled();
  });

  it('język spoza portalu → failed bez wywołania dostawcy', async () => {
    const p = provider(GOOD);
    const s = store([job({ target_locale: 'ro' })]);
    await processTranslationBatch({ store: s, provider: p });
    expect(p.translate).not.toHaveBeenCalled();
    expect(s.fail).toHaveBeenCalledWith(expect.anything(), 'unsupported_locale', false, null);
  });
});
