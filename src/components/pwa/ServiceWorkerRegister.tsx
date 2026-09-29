'use client';

import { useEffect } from 'react';

/**
 * #1088: adres rejestracji niesie identyfikator builda (`NEXT_PUBLIC_APP_VERSION`), więc każde
 * wdrożenie instaluje nowego workera z własnymi nazwami cache i czyści cache poprzedniego.
 * Bez identyfikatora (np. lokalny build) — goły `/sw.js` z wersją awaryjną.
 */
export function serviceWorkerUrl(version: string | undefined = process.env.NEXT_PUBLIC_APP_VERSION): string {
  const trimmed = version?.trim();
  return trimmed ? `/sw.js?v=${encodeURIComponent(trimmed)}` : '/sw.js';
}

/**
 * Rejestracja Service Workera PWA (`/sw.js`) po załadowaniu strony.
 *
 * SW jest funkcjonalny (offline shell + cache niezmiennych assetów), NIE analityczny —
 * dlatego rejestracja nie wymaga zgody cookie (Invariant #7 dotyczy trackingu, nie SW).
 * Rejestrujemy tylko w produkcji, by nie kolidować z HMR w dev. Brak wsparcia = no-op.
 *
 * #797: efekt montuje się dopiero po hydratacji Reacta — jeśli w tym momencie dokument ma
 * już `readyState === 'complete'`, zdarzenie `load` już minęło i sam listener na nie nigdy
 * się nie odpali (dotyczy zwłaszcza wolniejszych urządzeń/późnej hydratacji). Rejestrujemy
 * od razu, gdy strona jest już w pełni załadowana, inaczej czekamy na `load` jak dotąd.
 */
export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register(serviceWorkerUrl()).catch(() => {
        // Rejestracja SW to ulepszenie progresywne — ciche niepowodzenie jest OK.
      });
    };
    if (typeof document !== 'undefined' && document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
