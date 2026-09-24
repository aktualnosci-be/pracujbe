/**
 * Jedna jawna flaga sprzedaży (#51): `BILLING_ENABLED`. Domyślnie WYŁĄCZONA — bezpłatny MVP.
 *
 * Włączona jest wyłącznie przy dokładnej wartości `true` (bez rozróżniania wielkości liter
 * i białych znaków na brzegach). Każda inna wartość, także brak zmiennej, `1`, `yes` czy literówka,
 * oznacza „wyłączone” — pomyłka w konfiguracji nie może otworzyć sprzedaży.
 *
 * Pytają ją: webhook Stripe (wyłączona → 404), klient Stripe (`getStripe` → null), wykrywanie
 * dostawcy (`isStripeConfigured`, `isBillingProviderReady`, `isBillingProviderConfigured`) i raport
 * gotowości (`readinessChecks().stripe`). Sekrety Stripe bez flagi nic nie włączają.
 *
 * Samo ustawienie flagi NIE uruchamia sprzedaży: akcje billingu zawsze zwracają
 * `BILLING_UNAVAILABLE`, webhook odpowiada 410, a panel nie ma cennika ani CTA zakupu — w tej
 * wersji nie ma przepływu checkoutu. Jego powrót wymaga nowej decyzji właściciela i osobnego
 * projektu (`docs/PRODUCT_DECISIONS.md`); flaga jest miejscem, w które taki projekt się wepnie.
 *
 * Odczyt leniwy (`process.env` przy wywołaniu), więc build nie utrwala wartości.
 */
export const BILLING_FLAG_ENV = 'BILLING_ENABLED';

export function isBillingEnabled(): boolean {
  return (process.env[BILLING_FLAG_ENV] ?? '').trim().toLowerCase() === 'true';
}
