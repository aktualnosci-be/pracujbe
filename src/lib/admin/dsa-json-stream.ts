import { pagedExportStream, type DsaExportPage } from '@/lib/admin/dsa-export-stream';

/**
 * Strumień JSON eksportu decyzji DSA (#641): jeden dokument `{ report, statements: [...] }`
 * z WSZYSTKIMI decyzjami wybranego zakresu (kolejne strony po kursorze dociąga serwer), zamiast
 * jednej strony z `nextCursor`, której link do pobrania nie potrafił kontynuować. Przerwanie
 * (błąd bazy w trakcie) zostawia niepoprawny JSON, więc niepełny plik nie udaje kompletnego.
 */

export function dsaJsonStream<Row>(options: {
  report: unknown;
  first: { rows: Row[]; nextCursor: string | null };
  fetchPage: (cursor: string) => Promise<DsaExportPage<Row>>;
}): ReadableStream<Uint8Array> {
  return pagedExportStream({
    head: `{\n  "report": ${JSON.stringify(options.report, null, 2).replace(/\n/g, '\n  ')},\n  "statements": [`,
    first: options.first,
    serialize: (rows, hasPreviousRows) =>
      rows.map((row, index) => `${index > 0 || hasPreviousRows ? ',' : ''}\n    ${JSON.stringify(row)}`).join(''),
    tail: '\n  ]\n}\n',
    fetchPage: options.fetchPage,
  });
}
