'use client';

import { useEffect } from 'react';

/**
 * Rejestracja Service Workera PWA (`/sw.js`) po załadowaniu strony.
 *
 * SW jest funkcjonalny (offline shell + cache niezmiennych assetów), NIE analityczny —
 * dlatego rejestracja nie wymaga zgody cookie (Invariant #7 dotyczy trackingu, nie SW).
 * Rejestrujemy tylko w produkcji, by nie kolidować z HMR w dev. Brak wsparcia = no-op.
 */
export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Rejestracja SW to ulepszenie progresywne — ciche niepowodzenie jest OK.
      });
    };
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  return null;
}
