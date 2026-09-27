/**
 * Strumień CSV eksportu decyzji DSA (#606): pierwsza strona jest już pobrana (trasa sprawdza na
 * niej dostęp i błędy, zanim wyśle nagłówki), kolejne strony dociągane w `pull()` po kursorze.
 *
 * Bezpiecznik `maxPages` chroni przed nieskończoną pętlą przy uszkodzonym kursorze/danych. Gdy
 * go osiągniemy, a kursor nadal wskazuje kolejną stronę, strumień kończy się BŁĘDEM (przerwane
 * pobieranie), a nie cichym zamknięciem — obcięty plik nie może wyglądać na kompletny eksport
 * (nagłówków odpowiedzi nie da się już zmienić po rozpoczęciu strumienia).
 */

export type DsaCsvPage<Row> = { status: 'ok'; rows: Row[]; nextCursor: string | null } | { status: 'error' };

export function dsaCsvStream<Row>(options: {
  header: string;
  first: { rows: Row[]; nextCursor: string | null };
  toCsv: (rows: Row[]) => string;
  fetchPage: (cursor: string) => Promise<DsaCsvPage<Row>>;
  maxPages: number;
}): ReadableStream<Uint8Array> {
  const { header, first, toCsv, fetchPage, maxPages } = options;
  const encoder = new TextEncoder();
  let cursor = first.nextCursor;
  let page = 1;
  let headerSent = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        controller.enqueue(encoder.encode(header));
        controller.enqueue(encoder.encode(toCsv(first.rows)));
        headerSent = true;
        if (!cursor) controller.close();
        return;
      }
      if (!cursor) {
        controller.close();
        return;
      }
      if (page >= maxPages) {
        controller.error(new Error('export_truncated'));
        return;
      }
      const next = await fetchPage(cursor);
      page += 1;
      if (next.status === 'error') {
        controller.error(new Error('unavailable'));
        return;
      }
      controller.enqueue(encoder.encode(toCsv(next.rows)));
      cursor = next.nextCursor;
      if (!cursor) controller.close();
    },
  });
}
