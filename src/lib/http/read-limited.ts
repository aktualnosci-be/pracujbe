import 'server-only';

/**
 * Odczyt body żądania z TWARDYM limitem bajtów egzekwowanym przy streamingu (P2-05).
 *
 * Sam nagłówek `Content-Length` nie jest wiarygodny: może być nieobecny, chunked lub sfałszowany,
 * więc `request.text()` po samym sprawdzeniu nagłówka i tak zbuforowałby całe body. Tutaj czytamy
 * strumień kawałek po kawałku i PRZERYWAMY po przekroczeniu limitu — niepodpisane żądanie nie może
 * zużyć dowolnej ilości pamięci/CPU przed weryfikacją podpisu.
 *
 * Zwraca `{ ok: true, text }` albo `{ ok: false, tooLarge: true }` gdy przekroczono limit.
 */
export async function readTextWithLimit(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; tooLarge: true }> {
  // Wczesne odrzucenie po zadeklarowanym rozmiarze (tani skrót, gdy nagłówek jest obecny i uczciwy).
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, tooLarge: true };
  }

  const body = request.body;
  if (!body) {
    // Brak strumienia (np. puste body) — bezpiecznie zwróć pusty tekst.
    const text = await request.text();
    if (Buffer.byteLength(text) > maxBytes) return { ok: false, tooLarge: true };
    return { ok: true, text };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          // Przerwij strumień — nie buforujemy więcej niż limit.
          await reader.cancel().catch(() => {});
          return { ok: false, tooLarge: true };
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { ok: true, text: Buffer.concat(chunks).toString('utf8') };
}
