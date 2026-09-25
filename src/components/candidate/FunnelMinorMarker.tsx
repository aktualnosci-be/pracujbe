'use client';

import * as React from 'react';

import { setKnownMinorDevice } from '@/lib/job-funnel/client';

/**
 * Znacznik urządzenia dla lejka ofert (#576, LAUNCH-1): konto 16–17 = lejek jak brak zgody.
 * Panel kandydata zna przedział wieku z bazy; wyspa zapisuje go dla klienta lejka (strony ofert
 * są ISR i nie znają sesji). `minor=false` (potwierdzone 18+) zdejmuje znacznik. Nic nie renderuje.
 */
export function FunnelMinorMarker({ minor }: { minor: boolean }): null {
  React.useEffect(() => {
    setKnownMinorDevice(minor);
  }, [minor]);
  return null;
}
