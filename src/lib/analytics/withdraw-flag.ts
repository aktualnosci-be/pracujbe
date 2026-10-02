/**
 * Znacznik „strona przeładowana po wycofaniu zgody na analitykę” (#642) — tylko ta karta
 * (`sessionStorage`), jeden komunikat. Osobny, mały moduł: baner zgód sprawdza go przy każdym
 * załadowaniu, a komponent komunikatu ładuje się dopiero, gdy znacznik istnieje.
 */
export const WITHDRAWN_NOTICE_KEY = 'pracujbe.analytics.withdrawn';

/** Zapamiętuje, że po przeładowaniu trzeba pokazać komunikat o wycofaniu zgody. */
export function markWithdrawnNotice(win: Window = window): void {
  try {
    win.sessionStorage.setItem(WITHDRAWN_NOTICE_KEY, '1');
  } catch {
    // brak sessionStorage (tryb prywatny, blokada) — przeładowanie i tak następuje
  }
}

/** Czy znacznik istnieje (bez zdejmowania). */
export function peekWithdrawnNotice(win: Window = window): boolean {
  try {
    return win.sessionStorage.getItem(WITHDRAWN_NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Odczytuje i zdejmuje znacznik komunikatu (jednorazowo). */
export function takeWithdrawnNotice(win: Window = window): boolean {
  try {
    const value = win.sessionStorage.getItem(WITHDRAWN_NOTICE_KEY);
    if (value === null) return false;
    win.sessionStorage.removeItem(WITHDRAWN_NOTICE_KEY);
    return value === '1';
  } catch {
    return false;
  }
}
