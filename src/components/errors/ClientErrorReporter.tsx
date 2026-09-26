'use client';

import { useEffect } from 'react';

import { installClientErrorReporter } from '@/lib/client-error/reporter';

/**
 * Włącza zgłaszanie błędów z przeglądarki (#502): kod, ścieżka i wydanie do
 * `/api/client-error`. Diagnostyka bez identyfikatorów i cookies — nie wymaga zgody.
 */
export function ClientErrorReporter(): null {
  useEffect(() => {
    installClientErrorReporter();
  }, []);
  return null;
}
