/**
 * Wspólny silnik strumieniowego eksportu decyzji DSA (#606, #641, #670): pierwsza strona jest już
 * pobrana (trasa sprawdza na niej dostęp i błędy, zanim wyśle nagłówki), kolejne strony
 * dociągane w `pull()` po kursorze — aż do wyczerpania kursora, bez arbitralnego limitu stron.
 *
 * Eksport ma być KOMPLETNY albo przerwany błędem; obcięty plik nie może wyglądać na kompletny
 * (nagłówków odpowiedzi nie da się zmienić po rozpoczęciu strumienia, więc błąd przerywa
 * połączenie, a JSON dodatkowo zostaje niepoprawny). Zamiast limitu liczby stron chroni przed
 * nieskończoną pętlą wykrywanie kursora, który nie posuwa eksportu naprzód: kursor już użyty
 * albo pusta strona z kolejnym kursorem → błąd `export_cursor_stalled`.
 */

export type DsaExportPage<Row> = { status: 'ok'; rows: Row[]; nextCursor: string | null } | { status: 'error' };

export function pagedExportStream<Row>(options: {
  /** Tekst przed pierwszym wierszem (nagłówek CSV / początek JSON). */
  head: string;
  first: { rows: Row[]; nextCursor: string | null };
  /** Serializacja jednej strony; `hasPreviousRows` mówi, czy przed pierwszym wierszem strony jest już wiersz w pliku. */
  serialize: (rows: Row[], hasPreviousRows: boolean) => string;
  /** Tekst po ostatnim wierszu (np. zamknięcie tablicy i obiektu JSON). */
  tail?: string;
  fetchPage: (cursor: string) => Promise<DsaExportPage<Row>>;
}): ReadableStream<Uint8Array> {
  const { head, first, serialize, tail = '', fetchPage } = options;
  const encoder = new TextEncoder();
  const usedCursors = new Set<string>();
  let cursor = first.nextCursor;
  let started = false;
  let rowsSoFar = first.rows.length;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(encoder.encode(head + serialize(first.rows, false)));
        if (!cursor) {
          controller.enqueue(encoder.encode(tail));
          controller.close();
        }
        return;
      }
      if (!cursor) {
        controller.close();
        return;
      }
      if (usedCursors.has(cursor)) {
        controller.error(new Error('export_cursor_stalled'));
        return;
      }
      usedCursors.add(cursor);
      const next = await fetchPage(cursor);
      if (next.status === 'error') {
        controller.error(new Error('unavailable'));
        return;
      }
      if (next.rows.length === 0 && next.nextCursor) {
        controller.error(new Error('export_cursor_stalled'));
        return;
      }
      controller.enqueue(encoder.encode(serialize(next.rows, rowsSoFar > 0)));
      rowsSoFar += next.rows.length;
      cursor = next.nextCursor;
      if (!cursor) {
        controller.enqueue(encoder.encode(tail));
        controller.close();
      }
    },
  });
}
