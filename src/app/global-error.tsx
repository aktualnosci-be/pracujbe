'use client';

import { useEffect } from 'react';

import { captureError } from '@/lib/sentry';

/**
 * Globalna granica błędu (App Router) — łapie błędy w ROOT layoutcie, gdy [locale]/error.tsx
 * już nie zadziała. Zastępuje cały dokument, więc renderuje własne <html>/<body> i NIE ma
 * kontekstu i18n — stąd neutralny, wielojęzyczny komunikat i style inline (bez zależności od
 * arkusza). Bez stack trace/technikaliów (Invariant #8); szczegóły idą do Sentry.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    captureError(error, { area: 'global-error', digest: error.digest });
  }, [error]);

  return (
    <html lang="pl">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          background: '#F8FAFC',
          color: '#172033',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: '#0F2A47',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 32,
              fontWeight: 800,
              marginBottom: 16,
            }}
            aria-hidden="true"
          >
            P
          </div>
          <h1 style={{ fontSize: '1.25rem', margin: '0 0 8px' }}>
            Coś poszło nie tak · Er ging iets mis · Une erreur s&apos;est produite · Something went
            wrong
          </h1>
          <p style={{ color: '#64748B', margin: '0 0 20px', lineHeight: 1.5 }}>
            Wystąpił nieoczekiwany błąd. Spróbuj ponownie.
            <br />
            Er is een onverwachte fout opgetreden · Une erreur inattendue s&apos;est produite · An
            unexpected error occurred.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              border: 0,
              background: '#0F2A47',
              color: '#fff',
              padding: '10px 20px',
              borderRadius: 8,
              fontSize: '0.95rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Spróbuj ponownie · Opnieuw proberen · Réessayer · Try again
          </button>
        </div>
      </body>
    </html>
  );
}
