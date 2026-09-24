'use client';

import { useState } from 'react';

import { BTN_SECONDARY } from '@/components/dashboard/panel-styles';

/**
 * PNG z baneru SVG kampanii (#175) — w przeglądarce, bez usług zewnętrznych: SVG z tego samego
 * źródła (endpoint pod sesją) rysujemy na kanwie w dokładnym rozmiarze formatu i zapisujemy.
 * Teksty przychodzą z serwera (bez nowej przestrzeni wiadomości w bundlu klienta).
 */
export function BannerPngButton({
  src,
  filename,
  width,
  height,
  labels,
}: {
  src: string;
  filename: string;
  width: number;
  height: number;
  labels: { download: string; pending: string; error: string; name: string };
}) {
  const [state, setState] = useState<'idle' | 'pending' | 'error'>('idle');

  async function download() {
    if (state === 'pending') return;
    setState('pending');
    try {
      const image = new Image(width, height);
      image.src = src;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas');
      context.drawImage(image, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('png');
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
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={BTN_SECONDARY}
        onClick={download}
        disabled={state === 'pending'}
        aria-busy={state === 'pending'}
        aria-label={`${state === 'pending' ? labels.pending : labels.download} — ${labels.name}`}
      >
        {state === 'pending' ? labels.pending : labels.download}
      </button>
      {state === 'error' ? (
        <p role="alert" className="text-xs text-error-text">
          {labels.error}
        </p>
      ) : null}
    </div>
  );
}
