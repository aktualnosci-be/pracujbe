'use client';

import { useEffect } from 'react';

/**
 * Włącza zgłaszanie błędów z przeglądarki (#502): kod, ścieżka i wydanie do
 * `/api/client-error`. Diagnostyka bez identyfikatorów i cookies — nie wymaga zgody.
 *
 * Reporter ładuje się osobnym chunkiem po hydratacji (dynamiczny import), więc nie
 * zwiększa JS pierwszego ładowania żadnej trasy (budżet `perf-budgets.json`, #395).
 * Błędy sprzed jego załadowania zgłasza serwer (`onRequestError`) albo granice błędów
 * po załadowaniu; awaria pobrania chunka jest cicha.
 */
export function ClientErrorReporter(): null {
  useEffect(() => {
    import('@/lib/client-error/reporter')
      .then((mod) => mod.installClientErrorReporter())
      .catch(() => undefined);
  }, []);
  return null;
}
