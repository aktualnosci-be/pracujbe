'use client';

import * as React from 'react';

import type { FunnelEvent } from '@/lib/job-funnel/events';
import {
  beginDetailView,
  newFunnelNonce,
  sendFunnelEvent,
  whenFunnelConsent,
  whenPageVisible,
} from '@/lib/job-funnel/client';

/**
 * Wyspa zgłaszająca zdarzenie lejka ofert po załadowaniu strony (#99). Nic nie renderuje.
 * Strona pozostaje statyczna/ISR — zliczanie dzieje się w osobnym żądaniu do `/api/job-funnel`.
 * Nonce powstaje raz na wyświetlenie danego zestawu ofert (także przy podwójnym efekcie
 * w trybie deweloperskim), więc ponowienie nie dubluje zliczenia.
 * #575: wysyłka tylko po zgodzie analitycznej (`whenFunnelConsent`) — przed decyzją zdarzenie
 * czeka w pamięci karty, odmowa/wycofanie je usuwa, odmontowanie widoku anuluje.
 */
export function JobFunnelBeacon({
  event,
  jobIds,
}: {
  event: Extract<FunnelEvent, 'search_appearance' | 'detail_view'>;
  jobIds: readonly string[];
}): null {
  const key = jobIds.join(',');
  const sent = React.useRef<{ key: string; nonce: string } | null>(null);

  React.useEffect(() => {
    if (!key) return;
    if (sent.current?.key === key) return;
    const nonce = newFunnelNonce();
    const ids = key.split(',');
    let cancelConsent: () => void = () => undefined;
    const cancelVisible = whenPageVisible(() => {
      cancelConsent = whenFunnelConsent(() => {
        if (sent.current?.key === key) return;
        sent.current = { key, nonce };
        if (event === 'detail_view' && ids[0]) beginDetailView(ids[0], nonce);
        sendFunnelEvent(event, ids, nonce);
      });
    });
    return () => {
      cancelVisible();
      cancelConsent();
    };
  }, [event, key]);

  return null;
}
