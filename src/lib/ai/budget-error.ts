/**
 * Błąd budżetu AI (#36) — osobny plik bez zależności, żeby rdzeń importu i testy mogły go
 * rozpoznać bez ładowania warstwy bazy (`src/lib/ai/budget.ts`).
 *
 * `exceeded` — rezerwacja przekroczyłaby dzienny lub miesięczny limit (albo limit = 0);
 * `unavailable` — budżetu nie da się sprawdzić (brak bazy, błąd, brak limitu). Oba = brak
 * wywołania API (fail-closed).
 */
export type AiBudgetFailure = 'exceeded' | 'unavailable';

export class AiBudgetError extends Error {
  constructor(readonly reason: AiBudgetFailure) {
    super(`AI budget ${reason}`);
    this.name = 'AiBudgetError';
  }
}
