import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const serviceConfigured = vi.fn(() => true);
vi.mock('@/lib/db/portal', () => ({
  isServiceDatabaseConfigured: () => serviceConfigured(),
  withServiceRole: (action: (tx: unknown) => Promise<unknown>) => action({}),
}));
vi.mock('@/lib/db/sql', () => ({ rpc: (...args: unknown[]) => rpc(...args) }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

import { DEFAULT_JOB_IMPORT_MODEL } from '@/lib/ai-import/config';
import { AnthropicJobExtractor, ExtractorError, FixtureJobExtractor, type JobExtractor } from '@/lib/ai-import/extract';
import { runJobImport } from '@/lib/ai-import/run-import';
import { AiBudgetError, databaseBudgetStore, withAiBudget, type AiBudgetStore } from '@/lib/ai/budget';
import { estimateJobImportCost, withJobImportBudget } from '@/lib/ai/job-import-usage';
import { costMicroUsd, estimateMicroUsd, MODEL_RATES } from '@/lib/ai/pricing';

/**
 * #36 — globalny budżet AI: rezerwacja PRZED wywołaniem modelu, odmowa bez wywołania po
 * przekroczeniu limitu (fail-closed), rozliczenie tokenami z odpowiedzi. Żaden test nie woła
 * prawdziwego API ani bazy (atrapy).
 */

type Settlement = Parameters<AiBudgetStore['settle']>[1];

function fakeStore(reserve: () => Promise<string> = async () => 'res-1') {
  const events: string[] = [];
  const settlements: Settlement[] = [];
  const store: AiBudgetStore = {
    reserve: vi.fn(async () => {
      events.push('reserve');
      return reserve();
    }),
    settle: vi.fn(async (_id: string, s: Settlement) => {
      events.push('settle');
      settlements.push(s);
    }),
  };
  return { store, events, settlements };
}

const TEXT_INPUT = { kind: 'text' as const, text: 'Magazynier, Antwerpia. Praca od zaraz, umowa tymczasowa.', source: 'jobs.example' };

beforeEach(() => {
  rpc.mockReset();
  serviceConfigured.mockReturnValue(true);
});

describe('cennik', () => {
  it('liczy koszt w mikro-USD ze stawek za 1 mln tokenów, z cache', () => {
    expect(costMicroUsd('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(5_000_000);
    expect(costMicroUsd('claude-opus-5', { inputTokens: 0, outputTokens: 1000 })).toBe(25_000);
    expect(
      costMicroUsd('claude-sonnet-5', { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 1000, cacheReadInputTokens: 1000 }),
    ).toBe(2500 + 200);
  });

  it('nieznany model = najdroższa stawka, atrapa = 0; szacunek nigdy nie jest zerowy', () => {
    const top = Math.max(...Object.values(MODEL_RATES).map((r) => r.outputPerMTok));
    expect(costMicroUsd('claude-nieznany-9', { inputTokens: 0, outputTokens: 1000 })).toBe(top * 1000);
    expect(costMicroUsd('fixture', { inputTokens: 10_000, outputTokens: 10_000 })).toBe(0);
    expect(estimateMicroUsd('fixture', { inputTokens: 10, maxOutputTokens: 10 })).toBe(1);
  });

  it('domyślny model importu ma jawną stawkę', () => {
    expect(MODEL_RATES[DEFAULT_JOB_IMPORT_MODEL]).toBeDefined();
  });

  it('szacunek importu pokrywa pełne max_tokens wyjścia i rośnie z długością tekstu', () => {
    const short = estimateJobImportCost(TEXT_INPUT, 'claude-opus-5');
    expect(short).toBeGreaterThanOrEqual(8000 * 25);
    expect(estimateJobImportCost({ ...TEXT_INPUT, text: 'x'.repeat(60_000) }, 'claude-opus-5')).toBeGreaterThan(short);
    const image = estimateJobImportCost({ kind: 'image', mediaType: 'image/png', base64: '' }, 'claude-opus-5');
    expect(image).toBeGreaterThan(short);
  });
});

describe('withAiBudget', () => {
  it('rezerwuje przed wywołaniem i rozlicza kosztem z tokenów', async () => {
    const { store, events, settlements } = fakeStore();
    const run = vi.fn(async (report: (u: { inputTokens: number; outputTokens: number }) => void) => {
      events.push('run');
      report({ inputTokens: 2000, outputTokens: 1000 });
      return 'ok';
    });
    const out = await withAiBudget(
      { feature: 'job_listing_import', model: 'claude-opus-5', estimateMicroUsd: 300_000.2 },
      run,
      () => 'ok',
      store,
    );
    expect(out).toBe('ok');
    expect(events).toEqual(['reserve', 'run', 'settle']);
    expect(store.reserve).toHaveBeenCalledWith('job_listing_import', 'claude-opus-5', 300_001);
    expect(settlements[0]).toEqual({
      outcome: 'ok',
      usage: { inputTokens: 2000, outputTokens: 1000 },
      costMicroUsd: 2000 * 5 + 1000 * 25,
    });
  });

  it('przekroczony budżet: wywołanie modelu NIE następuje (fail-closed)', async () => {
    const { store } = fakeStore(async () => {
      throw new AiBudgetError('exceeded');
    });
    const run = vi.fn(async () => 'nie powinno się wykonać');
    await expect(
      withAiBudget({ feature: 'job_listing_import', model: 'claude-opus-5', estimateMicroUsd: 1 }, run, () => 'ok', store),
    ).rejects.toMatchObject({ reason: 'exceeded' });
    expect(run).not.toHaveBeenCalled();
    expect(store.settle).not.toHaveBeenCalled();
  });

  it('błąd wywołania: rozliczenie klasyfikacją wyniku, bez zużycia = kwota rezerwacji (null)', async () => {
    const { store, settlements } = fakeStore();
    const failure = new ExtractorError('rateLimited');
    await expect(
      withAiBudget(
        { feature: 'job_listing_import', model: 'claude-opus-5', estimateMicroUsd: 10 },
        async () => {
          throw failure;
        },
        (r) => (r.ok ? 'ok' : 'rate_limited'),
        store,
      ),
    ).rejects.toBe(failure);
    expect(settlements).toEqual([{ outcome: 'rate_limited', usage: null, costMicroUsd: null }]);
  });

  it('awaria rozliczenia nie zmienia wyniku dla użytkownika', async () => {
    const store: AiBudgetStore = {
      reserve: async () => 'res-1',
      settle: async () => {
        throw new Error('db down');
      },
    };
    await expect(
      withAiBudget({ feature: 'job_listing_import', model: 'fixture', estimateMicroUsd: 1 }, async () => 42, () => 'ok', store),
    ).resolves.toBe(42);
  });
});

describe('import ogłoszenia pod budżetem', () => {
  function anthropicClient(usage: Partial<Anthropic.Usage> | undefined) {
    const create = vi.fn(async () => ({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: DEFAULT_JOB_IMPORT_MODEL,
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"isJobListing":false}', citations: null }],
      usage,
    }));
    return { client: { messages: { create } } as unknown as Anthropic, create };
  }

  it('tokeny z odpowiedzi dostawcy trafiają do rozliczenia', async () => {
    const { client } = anthropicClient({ input_tokens: 3000, output_tokens: 500, cache_read_input_tokens: 0 });
    const { store, settlements } = fakeStore();
    await withJobImportBudget(new AnthropicJobExtractor(client), 'claude-opus-5', store).extract(TEXT_INPUT);
    expect(settlements[0]).toMatchObject({ outcome: 'ok', costMicroUsd: 3000 * 5 + 500 * 25 });
  });

  it('brak `usage` w odpowiedzi = rozliczenie pełną rezerwacją', async () => {
    const { client } = anthropicClient(undefined);
    const { store, settlements } = fakeStore();
    await withJobImportBudget(new AnthropicJobExtractor(client), 'claude-opus-5', store).extract(TEXT_INPUT);
    expect(settlements[0]).toMatchObject({ usage: null, costMicroUsd: null });
  });

  it('przekroczony budżet: API nie jest wołane, import zwraca AI_BUDGET_EXCEEDED', async () => {
    const { client, create } = anthropicClient({ input_tokens: 1, output_tokens: 1 });
    const { store } = fakeStore(async () => {
      throw new AiBudgetError('exceeded');
    });
    const extractor = withJobImportBudget(new AnthropicJobExtractor(client), 'claude-opus-5', store);
    const result = await runJobImport(
      { kind: 'url', url: 'https://jobs.example/oferta' },
      { extractor, fetchListing: async () => ({ kind: 'text', text: TEXT_INPUT.text.repeat(3), url: 'https://jobs.example/oferta' }) },
    );
    expect(result).toEqual({ ok: false, error: 'AI_BUDGET_EXCEEDED' });
    expect(create).not.toHaveBeenCalled();

    // Kontrola ujemna: ten sam ekstraktor bez budżetu wywołuje API.
    await runJobImport(
      { kind: 'url', url: 'https://jobs.example/oferta' },
      {
        extractor: new AnthropicJobExtractor(client),
        fetchListing: async () => ({ kind: 'text', text: TEXT_INPUT.text.repeat(3), url: 'https://jobs.example/oferta' }),
      },
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('atrapa przechodzi tę samą ścieżkę (zużycie 0)', async () => {
    const { store, settlements } = fakeStore();
    const extractor: JobExtractor = withJobImportBudget(new FixtureJobExtractor(), 'fixture', store);
    await extractor.extract(TEXT_INPUT);
    expect(settlements[0]).toMatchObject({ outcome: 'ok', costMicroUsd: 0 });
  });
});

describe('rezerwacja w bazie (databaseBudgetStore)', () => {
  it('przekroczony limit → exceeded; inny błąd → unavailable; brak bazy → unavailable bez zapytania', async () => {
    rpc.mockRejectedValueOnce(new Error('AI_BUDGET_EXCEEDED'));
    await expect(databaseBudgetStore.reserve('job_listing_import', 'claude-opus-5', 10)).rejects.toMatchObject({ reason: 'exceeded' });

    rpc.mockRejectedValueOnce(new Error('AI_BUDGET_UNCONFIGURED'));
    await expect(databaseBudgetStore.reserve('job_listing_import', 'claude-opus-5', 10)).rejects.toMatchObject({ reason: 'unavailable' });

    rpc.mockResolvedValueOnce(null);
    await expect(databaseBudgetStore.reserve('job_listing_import', 'claude-opus-5', 10)).rejects.toMatchObject({ reason: 'unavailable' });

    serviceConfigured.mockReturnValue(false);
    rpc.mockClear();
    await expect(databaseBudgetStore.reserve('job_listing_import', 'claude-opus-5', 10)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('wysyła do bazy tylko funkcję, model, kwotę i liczby', async () => {
    rpc.mockResolvedValueOnce('11111111-1111-1111-1111-111111111111');
    await expect(databaseBudgetStore.reserve('job_listing_import', 'claude-opus-5', 10)).resolves.toBe(
      '11111111-1111-1111-1111-111111111111',
    );
    expect(rpc).toHaveBeenLastCalledWith(expect.anything(), 'ai_budget_reserve', {
      p_feature: 'job_listing_import',
      p_model: 'claude-opus-5',
      p_estimate_micro_usd: 10,
    });
    rpc.mockResolvedValueOnce(true);
    await databaseBudgetStore.settle('11111111-1111-1111-1111-111111111111', {
      outcome: 'ok',
      usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 2 },
      costMicroUsd: 99,
    });
    expect(rpc).toHaveBeenLastCalledWith(expect.anything(), 'ai_budget_settle', {
      p_id: '11111111-1111-1111-1111-111111111111',
      p_outcome: 'ok',
      p_input_tokens: 12,
      p_output_tokens: 5,
      p_cost_micro_usd: 99,
    });
  });

  it('wyniki i funkcje w TS zgadzają się z CHECK-ami migracji 0108', async () => {
    const sql = readFileSync(join(__dirname, '..', '..', 'supabase/migrations/0108_ai_budget.sql'), 'utf8');
    const { AI_USAGE_OUTCOMES } = await import('@/lib/ai/usage-log');
    const { AI_FEATURE_IDS } = await import('@/lib/ai/inventory');
    const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');
    expect(sql).toContain(`feature in (${list(AI_FEATURE_IDS)})`);
    expect(sql).toContain(`outcome in (${list(AI_USAGE_OUTCOMES)})`);
  });
});
