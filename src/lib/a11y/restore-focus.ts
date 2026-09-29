/**
 * Fokus po akcjach, które na czas zapisu wyłączają kontrolkę (#1095, A11Y-05).
 *
 * Przeglądarka nie zostawia fokusu na elemencie, który stał się `disabled` (albo został
 * odmontowany) — fokus spada na `<body>`, a użytkownik klawiatury i czytnika ekranu traci
 * miejsce w formularzu. `captureFocus()` zapamiętuje aktywny element PRZED zapisem;
 * zwrócona funkcja, wywołana po jego zakończeniu (kontrolki znów aktywne), przywraca fokus
 * — ale tylko gdy faktycznie spadł na `<body>` (nie nadpisuje fokusu ustawionego celowo,
 * np. na polu z błędem albo na nagłówku).
 */
export function captureFocus(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const previous = document.activeElement;
  if (!(previous instanceof HTMLElement) || previous === document.body) return () => undefined;
  return () => {
    const restore = () => {
      const current = document.activeElement;
      if (previous.isConnected && (current === null || current === document.body)) previous.focus();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
    else restore();
  };
}
