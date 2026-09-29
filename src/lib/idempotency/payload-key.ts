/**
 * Klucz idempotencji związany z TREŚCIĄ wysyłki (#1103, UX13-02; wzorzec z #926 w ApplyModal).
 *
 * Ponowienie po zerwanym połączeniu ma iść z TYM SAMYM kluczem (pierwsza próba mogła się udać —
 * serwer zwróci ten sam wynik, bez drugiej wiadomości). Ale jeśli użytkownik po błędzie
 * POPRAWIŁ treść, ten sam klucz sprawiłby, że serwer zwróci zapis starej treści jako sukces,
 * a poprawka zniknęłaby po cichu. Zmieniona treść dostaje więc NOWY klucz.
 */
export interface PayloadKeyState {
  key: string;
  fingerprint: string;
}

export function payloadKey(
  ref: { current: PayloadKeyState | null },
  payload: unknown,
  makeKey: () => string = () => crypto.randomUUID(),
): string {
  const fingerprint = JSON.stringify(payload);
  if (!ref.current || ref.current.fingerprint !== fingerprint) {
    ref.current = { key: makeKey(), fingerprint };
  }
  return ref.current.key;
}
