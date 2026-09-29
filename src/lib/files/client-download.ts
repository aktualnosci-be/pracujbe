/**
 * Pobranie pliku z trasy `/api/files/...` bez opuszczania strony (FS30-04).
 *
 * Wcześniej `window.location.assign(url)` przenosiło przeglądarkę na trasę pobierania, więc
 * odpowiedź 404/503 (bez treści) zastępowała widok wątku/aplikacji pustą stroną błędu.
 * Tu żądanie idzie przez `fetch` (ten sam origin, ciasteczka sesji), a przy błędzie funkcja
 * zwraca `false` i komponent pokazuje komunikat przy pliku — kontekst zostaje. Plik ≤ 5 MB,
 * zapisywany z obiektu Blob linkiem `download`.
 */
export async function downloadPrivateFile(
  url: string,
  fileName: string,
  deps: {
    fetchImpl?: typeof fetch;
    document?: Document;
    createObjectURL?: (blob: Blob) => string;
    revokeObjectURL?: (url: string) => void;
  } = {},
): Promise<boolean> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const doc = deps.document ?? document;
  const create = deps.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revoke = deps.revokeObjectURL ?? ((href: string) => URL.revokeObjectURL(href));
  try {
    const response = await fetchImpl(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return false;
    const blob = await response.blob();
    const href = create(blob);
    const anchor = doc.createElement('a');
    anchor.href = href;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => revoke(href), 10_000);
    return true;
  } catch {
    return false;
  }
}
