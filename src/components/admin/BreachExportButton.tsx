'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';

import { BTN_SECONDARY } from '@/components/admin/admin-styles';

/**
 * Eksport wpisu rejestru naruszeń (#490, #603): przycisk zamiast linku `<a href>` — endpoint
 * zapisuje zdarzenie w historii i dzienniku audytowym, więc pobranie jest teraz `POST`
 * (bez CSRF/GET-owego mnożenia zdarzeń przez odświeżenie, prefetch albo obcą stronę).
 */
function filenameFromDisposition(value: string | null, fallback: string): string {
  const match = value ? /filename="([^"]+)"/.exec(value) : null;
  return match?.[1] ?? fallback;
}

export function BreachExportButton({
  id,
  format,
  label,
  pendingLabel,
  errorLabel,
}: {
  id: string;
  format: 'json' | 'csv';
  label: string;
  pendingLabel: string;
  errorLabel: string;
}) {
  const [state, setState] = useState<'idle' | 'pending' | 'error'>('idle');

  async function download() {
    if (state === 'pending') return;
    setState('pending');
    try {
      const response = await fetch(`/api/admin/breaches/${id}/export?format=${format}`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('export');
      const blob = await response.blob();
      const filename = filenameFromDisposition(response.headers.get('content-disposition'), `breach.${format}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setState('idle');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        className={BTN_SECONDARY}
        onClick={download}
        disabled={state === 'pending'}
        aria-busy={state === 'pending'}
      >
        <Download className="size-4" aria-hidden="true" />
        {state === 'pending' ? pendingLabel : label}
      </button>
      {state === 'error' ? (
        <p role="alert" className="text-xs text-error-text">
          {errorLabel}
        </p>
      ) : null}
    </div>
  );
}
