'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';

import { BTN_SECONDARY } from '@/components/admin/admin-styles';

/**
 * Eksport dziennika zdarzeń (`/admin/dziennik`) — przycisk zamiast linku: endpoint zapisuje
 * wpis `audit_log.exported`, więc pobranie jest `POST` (jak eksport naruszeń, #603). Filtry
 * przychodzą z serwera (te same, które zastosowała lista). Po pobraniu obciętego eksportu
 * (`X-Export-Truncated: true`) pokazuje komunikat `truncatedLabel`.
 */
function filenameFromDisposition(value: string | null, fallback: string): string {
  const match = value ? /filename="([^"]+)"/.exec(value) : null;
  return match?.[1] ?? fallback;
}

export function AuditExportButton({
  format,
  query,
  label,
  pendingLabel,
  errorLabel,
  truncatedLabel,
}: {
  format: 'json' | 'csv';
  /** Filtry listy (`entity`, `action`, `actor`, `from`, `to`, `id`) — puste pomijane. */
  query: Record<string, string | null>;
  label: string;
  pendingLabel: string;
  errorLabel: string;
  truncatedLabel: string;
}) {
  const [state, setState] = useState<'idle' | 'pending' | 'error' | 'truncated'>('idle');

  async function download() {
    if (state === 'pending') return;
    setState('pending');
    try {
      const params = new URLSearchParams({ format });
      for (const [key, value] of Object.entries(query)) {
        if (value) params.set(key, value);
      }
      const response = await fetch(`/api/admin/audit-export?${params.toString()}`, { method: 'POST' });
      if (!response.ok) throw new Error('export');
      const truncated = response.headers.get('x-export-truncated') === 'true';
      const blob = await response.blob();
      const filename = filenameFromDisposition(
        response.headers.get('content-disposition'),
        `audit-log.${format}`,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setState(truncated ? 'truncated' : 'idle');
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
      {state === 'truncated' ? (
        <p role="status" className="text-xs text-foreground">
          {truncatedLabel}
        </p>
      ) : null}
    </div>
  );
}
