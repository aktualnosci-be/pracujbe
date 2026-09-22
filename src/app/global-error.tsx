'use client';

import { useEffect } from 'react';

import { captureError } from '@/lib/sentry';

export function GlobalErrorContent({
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
    <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
      <span
        role="img"
        aria-label="Pracuj.be"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          color: '#151515',
          fontSize: 28,
          fontWeight: 800,
          marginBottom: 16,
          whiteSpace: 'nowrap',
        }}
      >
        <span aria-hidden="true">pracuj</span>
        <span
          aria-hidden="true"
          style={{
            borderRadius: 8,
            background: '#D92932',
            color: '#FFFFFF',
            marginLeft: 2,
            padding: '4px 6px',
          }}
        >
          .be
        </span>
      </span>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 8px' }}>
        <span lang="pl">Coś poszło nie tak</span>
        <span aria-hidden="true"> · </span>
        <span lang="nl">Er ging iets mis</span>
        <span aria-hidden="true"> · </span>
        <span lang="fr">Une erreur s&apos;est produite</span>
        <span aria-hidden="true"> · </span>
        <span lang="en">Something went wrong</span>
      </h1>
      <p style={{ color: '#151515', margin: '0 0 20px', lineHeight: 1.5 }}>
        <span lang="pl" style={{ display: 'block' }}>
          Wystąpił nieoczekiwany błąd. Spróbuj ponownie.
        </span>
        <span lang="nl" style={{ display: 'block' }}>
          Er is een onverwachte fout opgetreden.
        </span>
        <span lang="fr" style={{ display: 'block' }}>
          Une erreur inattendue s&apos;est produite.
        </span>
        <span lang="en" style={{ display: 'block' }}>
          An unexpected error occurred.
        </span>
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          border: 0,
          background: '#D92932',
          color: '#FFFFFF',
          minHeight: 48,
          padding: '10px 20px',
          borderRadius: 8,
          fontSize: '0.95rem',
          fontWeight: 600,
          cursor: 'pointer',
          outline: '3px solid transparent',
          outlineOffset: 3,
        }}
        onFocus={(event) => { event.currentTarget.style.outlineColor = '#151515'; }}
        onBlur={(event) => { event.currentTarget.style.outlineColor = 'transparent'; }}
      >
        <span lang="pl">Spróbuj ponownie</span>
        <span aria-hidden="true"> · </span>
        <span lang="nl">Opnieuw proberen</span>
        <span aria-hidden="true"> · </span>
        <span lang="fr">Réessayer</span>
        <span aria-hidden="true"> · </span>
        <span lang="en">Try again</span>
      </button>
    </div>
  );
}

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
          background: '#FFFFFF',
          color: '#151515',
          padding: '24px',
        }}
      >
        <GlobalErrorContent error={error} reset={reset} />
      </body>
    </html>
  );
}
