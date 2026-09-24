import { NextResponse } from 'next/server';

import { parseDsaReportRange } from '@/lib/admin/dsa-report';
import { getStatementsExport, getTransparencyReport, toCsv } from '@/lib/data/admin-dsa';

/**
 * Eksport danych do raportu przejrzystości DSA (#43) — tylko administrator (`requireAdmin`
 * w warstwie danych; inna sesja → 404, bez ujawniania trasy).
 *
 *   - `format=csv` — wiersz na decyzję (`dsa_statements_export`), bez danych osobowych i faktów;
 *   - `format=json` — agregaty (`dsa_transparency_report`) + te same wiersze.
 *
 * Okres: `od`/`do` (`YYYY-MM-DD`, Europe/Brussels, `do` włącznie). Odpowiedź bez cache.
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

  const rows = await getStatementsExport(range.from, range.to);
  if (rows.status === 'error') return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: HEADERS });

  if (format === 'csv') {
    return new Response(toCsv(rows.rows), {
      headers: {
        ...HEADERS,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}.csv"`,
      },
    });
  }

  const report = await getTransparencyReport(range.from, range.to);
  if (report.status === 'error') return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: HEADERS });
  return new Response(JSON.stringify({ report: report.report, statements: rows.rows }, null, 2), {
    headers: {
      ...HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}.json"`,
    },
  });
}
