// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AI_USAGE_FIELDS, type AiUsageLine } from '@/lib/ai/usage-log';
import {
  classifyTranslationUsage,
  runTranslationQueue,
  withTranslationUsageLog,
} from '@/lib/translation/run';
import { TranslationProviderError, type TranslationProvider } from '@/lib/translation/provider';
import type { ClaimedTranslationJob, TranslationQueueStore } from '@/lib/translation/store';

/** #33 — przebieg kolejki tłumaczeń ofert: paczki do pustej kolejki, limit paczek i czasu, log bez treści. */

function job(i: number): ClaimedTranslationJob {
  return {
    job_id: `job-${i}`,
    lease_id: `lease-${i}`,
    lease_expires_at: '2026-09-25T00:00:00Z',
    attempt: 1,
    entity_type: 'job',
    entity_id: 'entity-1',
    revision_id: 'rev-1',
    revision_no: 1,
    source_locale: 'pl',
    target_locale: 'en',
    pipeline_version: 'translation-v1+prompt-v1+glossary-v1',
    fields: { title: 'Magazynier 15 EUR' },
  };
}

function store(batches: number[]): TranslationQueueStore & { claims: number } {
  let n = 0;
  const s = {
    claims: 0,
    async claim() {
      s.claims++;
      const size = batches[n++] ?? 0;
      return Array.from({ length: size }, (_, i) => job(n * 100 + i));
    },
    complete: vi.fn(async () => 'applied' as const),
    fail: vi.fn(async () => 'failed' as const),
    defer: vi.fn(async () => 'deferred' as const),
  };
  return s;
}

const echo: TranslationProvider = {
  async translate(req) {
    return { output: { ...req.fields, title: 'Warehouse worker 15 EUR' }, model: 'fixture', inputTokens: 1, outputTokens: 1 };
  },
};

describe('runTranslationQueue', () => {
  it('przetwarza paczki do pustej kolejki', async () => {
    const s = store([2, 1, 0, 5]);
    const r = await runTranslationQueue({ store: s, provider: echo, maxBatches: 10 });
    expect(r).toMatchObject({ batches: 3, claimed: 3, applied: 3 });
    expect(s.claims).toBe(3);
  });

  it('limit paczek i budżet czasu', async () => {
    const s = store([1, 1, 1, 1]);
    expect((await runTranslationQueue({ store: s, provider: echo, maxBatches: 2 })).batches).toBe(2);
    let t = 0;
    const s2 = store([1, 1, 1, 1]);
    const r = await runTranslationQueue({ store: s2, provider: echo, maxBatches: 10, deadlineMs: 10, now: () => (t += 6) });
    expect(r.batches).toBe(1);
  });

  it('niepoprawny wynik (zmieniona liczba) nie trafia do bazy — fail, nie complete', async () => {
    const s = store([1, 0]);
    const bad: TranslationProvider = {
      async translate() {
        return { output: { title: 'Warehouse worker 16 EUR' }, model: 'fixture', inputTokens: 0, outputTokens: 0 };
      },
    };
    const r = await runTranslationQueue({ store: s, provider: bad });
    expect(r.failed).toBe(1);
    expect(s.complete).not.toHaveBeenCalled();
  });

  it('odmowa budżetu AI (#36) → zadania odroczone i zliczone w przebiegu, bez fail', async () => {
    const s = store([2, 0]);
    const refused: TranslationProvider = {
      async translate() {
        throw new TranslationProviderError('budget_exceeded');
      },
    };
    const r = await runTranslationQueue({ store: s, provider: refused });
    expect(r).toMatchObject({ claimed: 2, deferred: 2, failed: 0, retried: 0 });
    expect(s.fail).not.toHaveBeenCalled();
    expect(s.defer).toHaveBeenCalledTimes(2);
  });
});

describe('createTranslationProvider', () => {
  it('adapter Anthropic bez drugiego logu użycia (loguje i budżetuje sam, #36)', async () => {
    vi.stubEnv('AI_TRANSLATION_ENABLED', '1');
    vi.stubEnv('AI_TRANSLATION_PROVIDER', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const { createTranslationProvider } = await import('@/lib/translation/run');
    const { AnthropicTranslationProvider } = await import('@/lib/translation/anthropic-provider');
    expect(createTranslationProvider()).toBeInstanceOf(AnthropicTranslationProvider);
    // Kontrola ujemna: atrapa jest owinięta logiem (nie jest samą klasą atrapy).
    vi.stubEnv('AI_TRANSLATION_PROVIDER', 'fixture');
    const { FixtureTranslationProvider } = await import('@/lib/translation/provider');
    expect(createTranslationProvider()).not.toBeInstanceOf(FixtureTranslationProvider);
    vi.unstubAllEnvs();
  });
});

describe('log użycia tłumaczeń', () => {
  it('jeden wiersz na wywołanie, bez treści pól', async () => {
    const lines: AiUsageLine[] = [];
    const logged = withTranslationUsageLog(echo, 'claude-opus-5', (l) => lines.push(l));
    await logged.translate({ sourceLocale: 'pl', targetLocale: 'en', fields: { title: 'Tajny tekst oferty' } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ feature: 'content_translation', outcome: 'ok', inputKind: 'text', model: 'claude-opus-5' });
    expect(Object.keys(lines[0]!).sort()).toEqual([...AI_USAGE_FIELDS].sort());
    expect(JSON.stringify(lines)).not.toContain('Tajny');
  });

  it('błędy dostawcy mapowane na enum', () => {
    expect(classifyTranslationUsage({ ok: false, error: new TranslationProviderError('rate_limited', 30) })).toBe('rate_limited');
    expect(classifyTranslationUsage({ ok: false, error: new TranslationProviderError('refused') })).toBe('refused');
    expect(classifyTranslationUsage({ ok: false, error: new Error('x') })).toBe('failed');
    expect(classifyTranslationUsage({ ok: true })).toBe('ok');
  });
});

