'use client';

import * as React from 'react';

/** `undefined` = jeszcze nie odczytano (SSR/pierwszy render), `null` = brak tokenu w linku. */
export type LinkToken = string | null | undefined;

/**
 * Token z linku e-mail (`#token=…`, #505). Fragment nie trafia do serwera ani nagłówka Referer.
 * Po odczycie usuwamy go z paska adresu i historii (`replaceState`), żeby nie został w zakładkach,
 * historii przeglądarki ani zrzutach ekranu. Token trzymamy tylko w pamięci komponentu.
 */
export function useLinkToken(): LinkToken {
  const [token, setToken] = React.useState<LinkToken>(undefined);
  // Ref przetrwa podwójne uruchomienie efektu (StrictMode): drugi przebieg nie widzi już fragmentu.
  const read = React.useRef<LinkToken>(undefined);
  React.useEffect(() => {
    if (read.current === undefined) {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const values = params.getAll('token');
      const value = values.length === 1 ? values[0]!.trim() : '';
      read.current = value.length > 0 && value.length <= 4096 ? value : null;
      if (window.location.hash) {
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
      }
    }
    setToken(read.current);
  }, []);
  return token;
}
