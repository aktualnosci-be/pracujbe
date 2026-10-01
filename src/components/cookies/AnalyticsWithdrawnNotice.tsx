'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { ToastRegion, type ToastRegionState } from '@/components/ui/toast';
import { takeWithdrawnNotice } from '@/lib/analytics/withdraw-flag';

/**
 * Komunikat po przeładowaniu wymuszonym wycofaniem zgody na analitykę (#642): strona odświeżyła
 * się, bo tylko nowy dokument nie ma już skryptu pomiarów. Znacznik w `sessionStorage` zdejmuje
 * `takeWithdrawnNotice`, więc komunikat pojawia się raz. Region na żywo powstaje przed treścią
 * (najpierw montaż `ToastRegion`, treść w kolejnym kroku — #1054).
 */
export function AnalyticsWithdrawnNotice() {
  const t = useTranslations('cookies');
  const [active, setActive] = useState(false);
  const [toast, setToast] = useState<ToastRegionState | null>(null);

  useEffect(() => {
    if (takeWithdrawnNotice()) setActive(true);
  }, []);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() =>
      setToast({ message: t('analyticsWithdrawnNotice'), tone: 'success' }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [active, t]);

  if (!active) return null;
  return (
    <ToastRegion
      toast={toast}
      onClose={() => {
        setToast(null);
        setActive(false);
      }}
    />
  );
}
