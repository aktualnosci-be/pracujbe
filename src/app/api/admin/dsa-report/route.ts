import { NextResponse } from 'next/server';

import { dsaCsvStream } from '@/lib/admin/dsa-csv-stream';
import { dsaJsonStream } from '@/lib/admin/dsa-json-stream';
import { parseDsaReportRange } from '@/lib/admin/dsa-report';
import { csvHeader, csvRows, getStatementsExport, getTransparencyReport } from '@/lib/data/admin-dsa';

/**
 * Eksport danych do raportu przejrzystości DSA (#43) — tylko administrator (`requireAdmin`
 * w warstwie danych; inna sesja → 404, bez ujawniania trasy).
 *
 *   - `format=csv` — wiersz na decyzję (`dsa_statements_export`), bez danych osobowych i faktów;
 *   - `format=json` — agregaty (`dsa_transparency_report`) + wiersze tych samych decyzji.
 *
 * Okres: `od`/`do` (`YYYY-MM-DD`, Europe/Brussels, `do` włącznie), do 5 lat (`parseDsaReportRange`).
 *
 * Stronicowanie (#606): zapytania do bazy (`dsa_statements_export`) idą po `DSA_EXPORT_PAGE_SIZE`
 * wierszy naraz, a odpowiedź jest STRUMIENIOWANA — kolejne strony dociągane i wysyłane w miarę
 * generowania pliku zamiast materializować cały zakres w pamięci procesu. Oba formaty zawierają
 * CAŁY wybrany zakres (#641, #670): link do pobrania nie wymaga klienta stronicującego, a plik
 * nie jest obcinany żadnym limitem stron. Błąd w trakcie (baza niedostępna, kursor niepostępujący)
 * przerywa odpowiedź — CSV kończy się przerwanym pobraniem, JSON niepoprawnym dokumentem — więc
 * niepełny eksport nigdy nie udaje kompletnego (`dsaCsvStream`, `dsaJsonStream`).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } as const;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const range = parseDsaReportRange(url.searchParams.get('od'), url.searchParams.get('do'));
  if (!range.ok) return NextResponse.json({ error: 'invalid_range' }, { status: 400, headers: HEADERS });
  const format = url.searchParams.get('format') === 'json' ? 'json' : 'csv';
  const name = `dsa-${range.fromYmd}_${range.toYmd}`;

  // Pierwsza strona jest pobrana PRZED utworzeniem strumienia — dopiero po niej wiadomo, czy
  // sesja ma dostęp (`requireAdmin` w warstwie danych) i czy zakres jest w ogóle dostępny;
  // błąd zgłoszony wewnątrz `ReadableStream` nie mógłby już zmienić nagłówków odpowiedzi.
  const first = await getStatementsExport(range.from, range.to);
  if (first.status === 'error') return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: HEADERS });

  const fetchPage = (cursor: string) => getStatementsExport(range.from, range.to, cursor);

  if (format === 'json') {
    const report = await getTransparencyReport(range.from, range.to);
    if (report.status === 'error') return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: HEADERS });
    return new Response(dsaJsonStream({ report: report.report, first, fetchPage }), {
      headers: {
        ...HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}.json"`,
      },
    });
  }

  const stream = dsaCsvStream({
    header: csvHeader(),
    first,
    toCsv: csvRows,
    fetchPage,
  });

  return new Response(stream, {
    headers: {
      ...HEADERS,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}.csv"`,
    },
  });
}
