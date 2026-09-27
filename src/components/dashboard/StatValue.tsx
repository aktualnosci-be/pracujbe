/**
 * Wartość licznika panelu. `null` = brak danych (np. brak uprawnień rekrutera), nigdy zero:
 * widoczna kreska, a czytnik ekranu słyszy przetłumaczone „brak danych”.
 */
export function StatValue({ value, noDataLabel }: { value: string | number | null; noDataLabel?: string }) {
  if (value === null) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{noDataLabel}</span>
      </>
    );
  }
  return <>{value}</>;
}
