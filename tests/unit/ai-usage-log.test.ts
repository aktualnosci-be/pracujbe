import { describe, expect, it, vi } from 'vitest';

import { ExtractorError, type JobExtractor } from '@/lib/ai-import/extract';
import { withJobImportUsageLog } from '@/lib/ai/job-import-usage';
import {
  AI_USAGE_FIELDS,
  buildAiUsageLine,
  recordAiUsage,
  withAiUsageLog,
  type AiUsageEvent,
  type AiUsageLine,
} from '@/lib/ai/usage-log';

/** #489 — log użycia AI: tylko pola z listy, bez treści wejścia/wyjścia i identyfikatorów. */

const SECRET_TEXT = 'Jan Kowalski, jan@example.com, +32 470 12 34 56 — Magazynier Antwerpia';

function collect() {
  const lines: AiUsageLine[] = [];
  return { lines, sink: (line: AiUsageLine) => lines.push(line) };
}

describe('log użycia AI', () => {
  it('wiersz ma wyłącznie dozwolone pola', () => {
    const line = buildAiUsageLine(
      { feature: 'job_listing_import', outcome: 'ok', inputKind: 'image', model: 'claude-opus-5', durationMs: 1234.4 },
      new Date('2026-09-24T10:00:00Z'),
    );
    expect(line).toEqual({
      type: 'ai_usage',
      at: '2026-09-24T10:00:00.000Z',
      feature: 'job_listing_import',
      outcome: 'ok',
      inputKind: 'image',
      model: 'claude-opus-5',
      durationMs: 1234,
    });
    expect(Object.keys(line!).sort()).toEqual([...AI_USAGE_FIELDS].sort());
  });

  it('dodatkowe pola spoza typu nie trafiają do logu (kontrola ujemna)', () => {
    const smuggled = {
      feature: 'job_listing_import',
      outcome: 'ok',
      inputKind: 'text',
      model: SECRET_TEXT,
      durationMs: 5,
      prompt: SECRET_TEXT,
      userId: '00000000-0000-0000-0000-000000000001',
    } as unknown as AiUsageEvent;
    const line = buildAiUsageLine(smuggled)!;
    expect(Object.keys(line).sort()).toEqual([...AI_USAGE_FIELDS].sort());
    expect(JSON.stringify(line)).not.toContain('Kowalski');
    expect(line.model).toBe('unknown');
  });

  it('funkcja spoza inwentarza nie jest logowana', () => {
    const { lines, sink } = collect();
    recordAiUsage({ feature: 'unknown_feature' as never, outcome: 'ok', inputKind: 'text', model: 'x-model', durationMs: 1 }, sink);
    expect(lines).toEqual([]);
  });

  it('błąd sinka nie przerywa funkcji', () => {
    expect(() =>
      recordAiUsage({ feature: 'job_listing_import', outcome: 'ok', inputKind: 'text', model: 'fixture', durationMs: 1 }, () => {
        throw new Error('sink down');
      }),
    ).not.toThrow();
  });

  it('withAiUsageLog loguje także wyjątek i przekazuje go dalej', async () => {
    const { lines, sink } = collect();
    await expect(
      withAiUsageLog(
        { feature: 'job_listing_import', inputKind: 'text', model: 'fixture' },
        async () => {
          throw new Error(SECRET_TEXT);
        },
        (r) => (r.ok ? 'ok' : 'failed'),
        sink,
      ),
    ).rejects.toThrow(SECRET_TEXT);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.outcome).toBe('failed');
    expect(JSON.stringify(lines)).not.toContain('Kowalski');
  });

  it('import ogłoszenia: jeden wiersz na wywołanie, bez treści ogłoszenia i odpowiedzi', async () => {
    const { lines, sink } = collect();
    const inner: JobExtractor = { extract: vi.fn(async () => ({ title: SECRET_TEXT })) };
    const logged = withJobImportUsageLog(inner, 'claude-opus-5', sink);

    const result = await logged.extract({ kind: 'text', text: SECRET_TEXT, sourceUrl: 'https://jobs.example/secret-path' });
    expect(result).toEqual({ title: SECRET_TEXT });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ feature: 'job_listing_import', outcome: 'ok', inputKind: 'text', model: 'claude-opus-5' });
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain('Kowalski');
    expect(serialized).not.toContain('secret-path');
  });

  it.each([
    [new ExtractorError('refused'), 'refused'],
    [new ExtractorError('rateLimited'), 'rate_limited'],
    [new ExtractorError('failed'), 'failed'],
    [new Error('network'), 'failed'],
  ] as const)('import ogłoszenia: błąd %s → %s', async (error, outcome) => {
    const { lines, sink } = collect();
    const logged = withJobImportUsageLog({ extract: async () => Promise.reject(error) }, 'fixture', sink);
    await expect(logged.extract({ kind: 'image', mediaType: 'image/png', base64: 'AAAA' })).rejects.toBe(error);
    expect(lines.map((l) => l.outcome)).toEqual([outcome]);
    expect(lines[0]!.inputKind).toBe('image');
  });
});
