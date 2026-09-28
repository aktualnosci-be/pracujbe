import { isRecruitmentEnabled } from '@/lib/portal-mode';

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
 * Tryb produktu (#1153 — decyzja produktowa: portal ogłoszeniowy, `docs/PRODUCT_DECISIONS.md`):
 * w trybie ogłoszeniowym (`src/lib/portal-mode.ts`, domyślny i fail-closed) flaga jest ZAWSZE
 * wyłączona, niezależnie od `BILLING_ENABLED` i sekretów Stripe. Monetyzacja w tym trybie wymaga
 * osobnego, ocenionego projektu (np. stała opłata za publikację lub wyróżnienie ogłoszenia) —
 * nigdy sprzedaży dostępu do kandydatów, dopasowań ani profili (katalog `plan_entitlements` ma
 * `candidate_access = false` wymuszone w bazie).
 *
 * Odczyt leniwy (`process.env` przy wywołaniu), więc build nie utrwala wartości.
 */
export const BILLING_FLAG_ENV = 'BILLING_ENABLED';

/** Sama wartość zmiennej `BILLING_ENABLED` (bez trybu produktu). */
export function isBillingFlagSet(): boolean {
  return (process.env[BILLING_FLAG_ENV] ?? '').trim().toLowerCase() === 'true';
}

/** Billing aktywny: tryb `RECRUITMENT` ORAZ `BILLING_ENABLED=true`. */
export function isBillingEnabled(): boolean {
  return isRecruitmentEnabled() && isBillingFlagSet();
}
