'use client';

import { useTranslations } from 'next-intl';
import { openCookieSettings } from '@/lib/consent-store';

/**
 * Przycisk ponownego otwarcia panelu zgód (client component).
 *
 * Nie trzyma stanu ani nie zna implementacji panelu — jedynie prosi o jego otwarcie przez
 * consent-store (globalne zdarzenie DOM), które CookieConsent nasłuchuje i obsługuje.
 * Gdy panel nie jest zamontowany, kliknięcie jest bezpiecznym no-opem.
 *
 * Etykieta z namespace `footer` (footer.cookieSettings), by pasowała do użycia w stopce.
 */
export function CookieSettingsButton({ className }: { className?: string }) {
  const t = useTranslations('footer');

  return (
    <button type="button" onClick={() => openCookieSettings()} className={className}>
      {t('cookieSettings')}
    </button>
  );
}
