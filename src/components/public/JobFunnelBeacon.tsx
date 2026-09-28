'use client';

import * as React from 'react';

import type { FunnelEvent } from '@/lib/job-funnel/events';
import {
  beginDetailView,
  newFunnelNonce,
  reportApplyStarted,
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
 *
 * `applyClicks` (#1130, tryb ogłoszeniowy): kliknięcie w link kanału ogłoszeniodawcy
 * (`a[data-apply-job="<id>"]`, renderowany na serwerze przez `EmployerApplyChannel`) =
 * `apply_started` — ta sama bramka zgody. Nasłuch w tej wyspie zamiast osobnej (budżet JS #395).
 */
export function JobFunnelBeacon({
  event,
  jobIds,
  applyClicks = false,
}: {
  event: Extract<FunnelEvent, 'search_appearance' | 'detail_view'>;
  jobIds: readonly string[];
  applyClicks?: boolean;
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

  React.useEffect(() => {
    if (!applyClicks) return;
    const onClick = (e: MouseEvent) => {
      const id = e.target instanceof Element ? e.target.closest('a[data-apply-job]')?.getAttribute('data-apply-job') : null;
      if (id && key.split(',').includes(id)) reportApplyStarted(id);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('auxclick', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('auxclick', onClick);
    };
  }, [applyClicks, key]);

  return null;
}
