'use client';

import * as React from 'react';

const subscribe = (): (() => void) => () => {};

/**
 * `false` w HTML z serwera i podczas hydracji, `true` po niej (#1236, wzorzec #817).
 *
 * Formularz obsługiwany przez `onSubmit` w React jest widoczny i interaktywny, zanim załadują się
 * chunki JS (wolna sieć, autouzupełnienie + Enter) albo gdy JS jest wyłączony. Natywna wysyłka
 * wtedy omija `preventDefault` — bez `method` to GET z polami w adresie URL (hasło, kod dostępu
 * w historii i logach). Przycisk wysyłki `disabled={!hydrated}` blokuje też niejawną wysyłkę
 * (Enter w polu), a `method="post"` na `<form>` jest drugą linią obrony.
 */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
