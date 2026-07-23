'use client';

import { useTranslations } from 'next-intl';

/**
 * Wyzwalacz ponownego otwarcia ustawień cookies ze stopki (client component).
 *
 * Baner/panel zgód (@/components/cookies/CookieConsent — tworzony przez innego agenta)
 * jest montowany globalnie w [locale]/layout. Aby nie tworzyć twardej zależności między
 * plikami, komunikacja odbywa się luźno — przez globalne zdarzenie DOM. CookieConsent może
 * nasłuchiwać `window.addEventListener('pracujbe:open-cookie-settings', ...)` i otworzyć panel.
 * Gdy nikt nie nasłuchuje, kliknięcie jest bezpiecznym no-opem (nie psuje builda/UI).
 */
export function CookieSettingsButton({ className }: { className?: string }) {
  const t = useTranslations('footer');

  function openSettings() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pracujbe:open-cookie-settings'));
    }
  }

  return (
    <button type="button" onClick={openSettings} className={className}>
      {t('cookieSettings')}
    </button>
  );
}
