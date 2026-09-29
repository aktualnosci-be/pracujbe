import { pagedExportStream, type DsaExportPage } from '@/lib/admin/dsa-export-stream';

/**
 * Strumień CSV eksportu decyzji DSA (#606, #670): nagłówek + wszystkie strony po kursorze, bez
 * limitu liczby stron — plik obejmuje cały wybrany zakres albo kończy się błędem (silnik
 * `pagedExportStream`), nigdy cichym obcięciem.
 */

export type DsaCsvPage<Row> = DsaExportPage<Row>;

export function dsaCsvStream<Row>(options: {
  header: string;
  first: { rows: Row[]; nextCursor: string | null };
  toCsv: (rows: Row[]) => string;
  fetchPage: (cursor: string) => Promise<DsaCsvPage<Row>>;
}): ReadableStream<Uint8Array> {
  return pagedExportStream({
    head: options.header,
    first: options.first,
    serialize: (rows) => options.toCsv(rows),
    fetchPage: options.fetchPage,
  });
}
