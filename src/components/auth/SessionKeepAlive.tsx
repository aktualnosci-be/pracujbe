'use client';

import * as React from 'react';

/**
 * Odświeżenie cookie sesji Better Auth przy zwykłym przeglądaniu panelu (#864).
 *
 * Guardy paneli czytają sesję po stronie Server Components, ale RSC nie może zapisać
 * `Set-Cookie` — middleware celowo NIE dotyka sesji (działa na Edge, bez bazy;
 * `src/middleware.ts`). Bez żadnego wywołania odświeżającego regularne przeglądanie panelu
 * (same odczyty stron, bez Server Actions) nie przedłuża ważności sesji — po 7 dniach od
 * ostatniego odnowienia użytkownik jest wylogowany, mimo aktywnego korzystania z portalu.
 *
 * `GET /api/auth/get-session` jest jedynym endpointem SDK Better Auth wystawionym przez
 * `/api/auth/[...all]` (`src/lib/auth/http-allowlist.ts`) i sam decyduje, czy odnowić cookie
 * (próg `updateAge` SDK) — wystarczy go wywołać z przeglądarki: żądanie tego samego
 * pochodzenia z `credentials: 'same-origin'` samo zastosuje ewentualny `Set-Cookie`
 * z odpowiedzi, bez udziału serwera Next. Wywołanie raz na zamontowanie (pełne załadowanie
 * panelu, nie każda nawigacja klienta w obrębie tego samego layoutu) wystarcza — SDK sam
 * pomija odnowienie, gdy jeszcze nie czas.
 *
 * Best-effort (Invariant #8): błąd sieci/odpowiedzi nic nie pokazuje i niczego nie blokuje —
 * to tylko przedłużenie sesji w tle, nie krytyczna operacja.
 */
export function SessionKeepAlive(): null {
  React.useEffect(() => {
    fetch('/api/auth/get-session', { credentials: 'same-origin', cache: 'no-store' }).catch(() => {
      /* best-effort — patrz komentarz nad komponentem */
    });
  }, []);
  return null;
}
