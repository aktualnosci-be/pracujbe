import { NextResponse } from 'next/server';

import { parseDsaReportRange } from '@/lib/admin/dsa-report';
import {
  csvHeader,
  csvRows,
  DSA_EXPORT_PAGE_SIZE,
  getStatementsExport,
  getTransparencyReport,
} from '@/lib/data/admin-dsa';

/**
 * Eksport danych do raportu przejrzystości DSA (#43) — tylko administrator (`requireAdmin`
 * w warstwie danych; inna sesja → 404, bez ujawniania trasy).
 *
 *   - `format=csv` — wiersz na decyzję (`dsa_statements_export`), bez danych osobowych i faktów;
 *   - `format=json` — agregaty (`dsa_transparency_report`) + JEDNA strona tych samych wierszy.
 *
 * Okres: `od`/`do` (`YYYY-MM-DD`, Europe/Brussels, `do` włącznie), do 5 lat (`parseDsaReportRange`).
 *
 * Stronicowanie (#606): zapytanie do bazy (`dsa_statements_export`) i budowanie odpowiedzi
 * idą po `DSA_EXPORT_PAGE_SIZE` wierszy naraz zamiast materializować cały zakres w jednym
 * zapytaniu i jednej odpowiedzi w pamięci procesu.
 *   - CSV: odpowiedź jest STRUMIENIOWANA — kolejne strony dociągane i wysyłane w miarę
 *     generowania pliku, do `DSA_EXPORT_MAX_PAGES` stron (bezpiecznik przed nieskończoną pętlą
 *     przy uszkodzonym kursorze/danych); w praktyce pokrywa całość rozsądnego eksportu.
 *   - JSON: odpowiedź niesie JEDNĄ stronę + `nextCursor` — wywołujący dociąga kolejne strony
 *     parametrem `cursor` (opaque token z poprzedniej odpowiedzi), zamiast całego zakresu naraz.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } as const;

/** Bezpiecznik CSV: `DSA_EXPORT_MAX_PAGES * DSA_EXPORT_PAGE_SIZE` = najwyżej pół miliona wierszy. */
const DSA_EXPORT_MAX_PAGES = 250;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const range = parseDsaReportRange(url.searchParams.get('od'), url.searchParams.get('do'));
  if (!range.ok) return NextResponse.json({ error: 'invalid_range' }, { status: 400, headers: HEADERS });
  const format = url.searchParams.get('format') === 'json' ? 'json' : 'csv';
  const name = `dsa-${range.fromYmd}_${range.toYmd}`;
  const cursorParam = url.searchParams.get('cursor');

  // Pierwsza strona jest pobrana PRZED utworzeniem strumienia — dopiero po niej wiadomo, czy
  // sesja ma dostęp (`requireAdmin` w warstwie danych) i czy zakres jest w ogóle dostępny;
  // błąd zgłoszony wewnątrz `ReadableStream` nie mógłby już zmienić nagłówków odpowiedzi.
  const first = await getStatementsExport(range.from, range.to, format === 'json' ? cursorParam : null);
  if (first.status === 'error') return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: HEADERS });

  if (format === 'json') {
    const report = await getTransparencyReport(range.from, range.to);
    if (report.status === 'error') return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: HEADERS });
    return new Response(
      JSON.stringify(
        { report: report.report, statements: first.rows, nextCursor: first.nextCursor, pageSize: DSA_EXPORT_PAGE_SIZE },
        null,
        2,
      ),
      {
        headers: {
          ...HEADERS,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${name}.json"`,
        },
      },
    );
  }

  const encoder = new TextEncoder();
  let cursor = first.nextCursor;
  let page = 1;
  let headerSent = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        controller.enqueue(encoder.encode(csvHeader()));
        controller.enqueue(encoder.encode(csvRows(first.rows)));
        headerSent = true;
        if (!cursor) controller.close();
        return;
      }
      if (!cursor || page >= DSA_EXPORT_MAX_PAGES) {
        controller.close();
        return;
      }
      const next = await getStatementsExport(range.from, range.to, cursor);
      page += 1;
      if (next.status === 'error') {
        controller.error(new Error('unavailable'));
        return;
      }
      controller.enqueue(encoder.encode(csvRows(next.rows)));
      cursor = next.nextCursor;
      if (!cursor) controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      ...HEADERS,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}.csv"`,
    },
  });
}
