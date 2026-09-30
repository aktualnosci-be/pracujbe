/**
 * Wartość z indeksu (`noUncheckedIndexedAccess`, #1121) albo czytelny błąd testu.
 * Zamiast `!` na ślepo: brak dopasowania regexu, pusty wynik lokatora czy zmieniony szablon
 * komunikatu kończy test komunikatem wskazującym, czego zabrakło, a nie `undefined` dalej.
 */
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Brak wartości: ${what}`);
  }
  return value;
}
