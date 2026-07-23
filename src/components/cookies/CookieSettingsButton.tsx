'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
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
    <button
      type="button"
      onClick={() => openCookieSettings()}
      className={cn(
        'text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline',
        className,
      )}
    >
      {t('cookieSettings')}
    </button>
  );
}
