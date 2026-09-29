// @vitest-environment node
import { isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dsaCsvStream } from '@/lib/admin/dsa-csv-stream';
import { dsaJsonStream } from '@/lib/admin/dsa-json-stream';
import { DSA_EXPORT_PAGE_SIZE } from '@/lib/data/admin-dsa';
import pl from '@/messages/pl.json';

/**
 * Eksport DSA jest KOMPLETNY albo przerwany błędem (#641, #670): JSON zawiera wszystkie strony
 * (link do pobrania nie wymaga klienta stronicującego), CSV nie ma arbitralnego limitu stron,
 * a kursor niepostępujący / błąd bazy w trakcie przerywają odpowiedź zamiast ją cicho obciąć.
 */

vi.mock('@/i18n/navigation', () => ({ Link: () => null }));
vi.mock('next/navigation', () => ({ notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async (arg: string | { namespace: string }) => {
    const namespace = typeof arg === 'string' ? arg : arg.namespace;
    const messages = pl as unknown as Record<string, Record<string, string>>;
    return (key: string) => messages[namespace]?.[key] ?? key;
  },
}));

import { fakeDb, resetFakeDb } from '../helpers/fake-db';

async function read(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value);
  }
}

/** Źródło stron: `total` wierszy po `size` na stronę, kursor = numer następnej strony. */
function source(total: number, size: number) {
  const rowsOf = (start: number) => Array.from({ length: Math.min(size, total - start) }, (_, i) => ({ n: start + i }));
  const next = (start: number) => (start + size < total ? String(start + size) : null);
  return {
    first: { rows: rowsOf(0), nextCursor: next(0) },
    fetchPage: vi.fn(async (cursor: string) => ({
      status: 'ok' as const,
      rows: rowsOf(Number(cursor)),
      nextCursor: next(Number(cursor)),
    })),
  };
}

describe('JSON eksportu DSA (#641): wszystkie strony w jednym pliku', () => {
  it('kilka stron → poprawny JSON z raportem i KAŻDYM wierszem, w kolejności', async () => {
    const src = source(7, 3);
    const text = await read(dsaJsonStream({ report: { period: { from: 'a' }, notices: { total: 7 } }, ...src }));
    const parsed = JSON.parse(text) as { report: unknown; statements: Array<{ n: number }> };
    expect(parsed.report).toEqual({ period: { from: 'a' }, notices: { total: 7 } });
    expect(parsed.statements.map((row) => row.n)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(src.fetchPage).toHaveBeenCalledTimes(2);
    // Kontrakt bez kursorów dla klienta: pobranie nie prosi o „kolejną stronę”.
    expect(text).not.toContain('nextCursor');
  });

  it('jedna strona i pusty zakres → poprawny JSON (kontrola ujemna: bez zbędnych przecinków)', async () => {
    const one = JSON.parse(await read(dsaJsonStream({ report: {}, ...source(2, 3) }))) as { statements: unknown[] };
    expect(one.statements).toHaveLength(2);
    const none = JSON.parse(await read(dsaJsonStream({ report: {}, first: { rows: [], nextCursor: null }, fetchPage: vi.fn() })));
    expect(none.statements).toEqual([]);
  });

  it('błąd bazy w trakcie → strumień przerwany, nie „poprawny” obcięty plik', async () => {
    const stream = dsaJsonStream({
      report: {},
      first: { rows: [{ n: 0 }], nextCursor: 'x' },
      fetchPage: async () => ({ status: 'error' as const }),
    });
    await expect(read(stream)).rejects.toThrow('unavailable');
  });
});

describe('CSV eksportu DSA (#670): bez arbitralnego limitu stron', () => {
  const toCsv = (rows: Array<{ n: number }>) => rows.map((row) => `${row.n}\n`).join('');

  it('więcej niż dawne 250 stron → wszystkie wiersze, bez błędu', async () => {
    const pages = 300;
    const src = source(pages * 2, 2);
    const text = await read(dsaCsvStream({ header: 'n\n', toCsv, ...src }));
    const lines = text.trim().split('\n');
    expect(lines).toHaveLength(pages * 2 + 1);
    expect(lines.at(-1)).toBe(String(pages * 2 - 1));
    expect(src.fetchPage).toHaveBeenCalledTimes(pages - 1);
  });

  it('kursor już użyty (pętla) → błąd export_cursor_stalled zamiast nieskończonego pobierania', async () => {
    const stream = dsaCsvStream({
      header: 'n\n',
      toCsv,
      first: { rows: [{ n: 0 }], nextCursor: 'a' },
      fetchPage: async (cursor) => ({ status: 'ok' as const, rows: [{ n: 1 }], nextCursor: cursor === 'a' ? 'b' : 'a' }),
    });
    await expect(read(stream)).rejects.toThrow('export_cursor_stalled');
  });

  it('pusta strona z kolejnym kursorem → błąd; kontrola ujemna: pusta ostatnia strona = koniec', async () => {
    const stalled = dsaCsvStream({
      header: 'n\n',
      toCsv,
      first: { rows: [{ n: 0 }], nextCursor: 'a' },
      fetchPage: async () => ({ status: 'ok' as const, rows: [], nextCursor: 'b' }),
    });
    await expect(read(stalled)).rejects.toThrow('export_cursor_stalled');

    const done = dsaCsvStream({
      header: 'n\n',
      toCsv,
      first: { rows: [{ n: 0 }], nextCursor: 'a' },
      fetchPage: async () => ({ status: 'ok' as const, rows: [], nextCursor: null }),
    });
    expect(await read(done)).toBe('n\n0\n');
  });

  it('błąd bazy w trakcie → przerwane pobieranie', async () => {
    const stream = dsaCsvStream({
      header: 'n\n',
      toCsv,
      first: { rows: [{ n: 0 }], nextCursor: 'a' },
      fetchPage: async () => ({ status: 'error' as const }),
    });
    await expect(read(stream)).rejects.toThrow('unavailable');
  });
});

describe('trasa /api/admin/dsa-report: pełny eksport dwóch stron w obu formatach', () => {
  const REPORT = {
    period: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' },
    notices: { total: 0, byCategory: {} },
    decisions: { total: 0, medianHoursToDecision: null, automatedDecision: 0 },
    appeals: { total: 0, byStatus: {}, reversedDecisions: 0, medianHoursToDecision: null },
  };
  const row = (index: number) => ({
    decision_reference: `DEC-${String(index).padStart(6, '0')}`,
    decided_at: `2026-01-15T10:00:00.${String(index % 1000).padStart(3, '0')}Z`,
    decision: 'no_action',
    content_type: 'job',
    notice_category: 'fraud',
    notice_received_at: '2026-01-14T10:00:00Z',
    ground_type: null,
    ground_reference: null,
    automated_detection: false,
    automated_decision: false,
    from_appeal: false,
    appeal_status: null,
    restored: false,
  });
  const BASE = 'https://pracuj.be/api/admin/dsa-report?od=2026-01-01&do=2026-01-31';

  beforeEach(() => {
    resetFakeDb({ id: 'admin-1', role: 'admin' });
    const full = Array.from({ length: DSA_EXPORT_PAGE_SIZE }, (_, i) => row(i));
    const second = [row(DSA_EXPORT_PAGE_SIZE), row(DSA_EXPORT_PAGE_SIZE + 1)];
    fakeDb
      .rpc('dsa_statements_export', ({ args }: { args: Record<string, unknown> }) =>
        args['p_cursor_decided_at'] ? second : full)
      .rpc('dsa_transparency_report', REPORT);
  });

  it('JSON: obie strony w jednym pliku, drugie zapytanie z kursorem; kontrola ujemna: bez `cursor` w URL', async () => {
    const { GET } = await import('@/app/api/admin/dsa-report/route');
    const response = await GET(new Request(`${BASE}&format=json`));
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()) as { statements: Array<{ decision_reference: string }> };
    expect(body.statements).toHaveLength(DSA_EXPORT_PAGE_SIZE + 2);
    expect(body.statements.at(-1)?.decision_reference).toBe(`DEC-${String(DSA_EXPORT_PAGE_SIZE + 1).padStart(6, '0')}`);
    const calls = fakeDb.callsTo('dsa_statements_export');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args).toMatchObject({ p_cursor_decided_at: null });
    expect(calls[1]?.args).toMatchObject({ p_cursor_decided_at: row(DSA_EXPORT_PAGE_SIZE - 1).decided_at });
  });

  it('JSON: parametr `cursor` z linku jest ignorowany — zawsze pełny eksport od początku', async () => {
    const { GET } = await import('@/app/api/admin/dsa-report/route');
    const response = await GET(new Request(`${BASE}&format=json&cursor=${encodeURIComponent('!!!')}`));
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()) as { statements: unknown[] };
    expect(body.statements).toHaveLength(DSA_EXPORT_PAGE_SIZE + 2);
  });

  it('CSV: nagłówek + wszystkie wiersze obu stron', async () => {
    const { GET } = await import('@/app/api/admin/dsa-report/route');
    const response = await GET(new Request(`${BASE}&format=csv`));
    expect(response.status).toBe(200);
    const lines = (await response.text()).trim().split('\r\n');
    expect(lines).toHaveLength(1 + DSA_EXPORT_PAGE_SIZE + 2);
  });

  it('błąd bazy przy pierwszej stronie → 503 (kontrola ujemna: brak częściowego pliku)', async () => {
    fakeDb.rpc('dsa_statements_export', () => {
      throw new Error('boom');
    });
    const { GET } = await import('@/app/api/admin/dsa-report/route');
    const response = await GET(new Request(`${BASE}&format=json`));
    expect(response.status).toBe(503);
  });
});

describe('panel /admin/raport-dsa: przyciski eksportu to bezpośrednie pobranie kompletu', () => {
  it('linki CSV/JSON niosą tylko zakres i format — bez kursora i numeru strony', async () => {
    resetFakeDb({ id: 'admin-1', role: 'admin' });
    fakeDb
      .rpc('dsa_transparency_report', {
        period: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' },
        notices: { total: 0, byCategory: {} },
        decisions: { total: 0, medianHoursToDecision: null, automatedDecision: 0 },
        appeals: { total: 0, byStatus: {}, reversedDecisions: 0, medianHoursToDecision: null },
      })
      .rpc('dsa_retention_report', {})
      .rows('admin-dsa.retention-runs', []);
    const { default: Page } = await import('@/app/[locale]/admin/raport-dsa/page');
    const element = (await Page({
      params: Promise.resolve({ locale: 'pl' }),
      searchParams: Promise.resolve({ od: '2026-01-01', do: '2026-01-31' }),
    })) as ReactElement;
    expect(isValidElement(element)).toBe(true);
    const html = renderToStaticMarkup(element);
    const hrefs = [...html.matchAll(/href="(\/api\/admin\/dsa-report[^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
    expect(hrefs).toEqual([
      '/api/admin/dsa-report?od=2026-01-01&do=2026-01-31&format=csv',
      '/api/admin/dsa-report?od=2026-01-01&do=2026-01-31&format=json',
    ]);
    for (const href of hrefs) expect(href).not.toMatch(/cursor|page|strona/i);
  });
});
