'use client';

import { useEffect, useRef, useTransition } from 'react';
import { Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing, localeNames } from '@/i18n/routing';
import { relocalizeNextParam } from '@/lib/auth/next-path';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Zmiana języka przebudowuje drzewo pod nowym `[locale]`, więc element z fokusem znika
 * i fokus spada na <body>. Zapamiętujemy, skąd przyszła zmiana (przełącznik w stopce czy
 * w panelu menu mobilnego) i po zamontowaniu przywracamy fokus w przewidywalne miejsce:
 * na przełącznik albo — gdy panel mobilny się zamknął — na przycisk „Menu”.
 */
const FOCUS_STORAGE_KEY = 'pracujbe:locale-switch-focus';
type FocusOrigin = 'switcher' | 'menu';

function rememberFocusOrigin(origin: FocusOrigin): void {
  try {
    window.sessionStorage.setItem(FOCUS_STORAGE_KEY, origin);
  } catch {
    // Brak dostępu do sessionStorage (tryb prywatny/blokada) — fokus nie zostanie przywrócony.
  }
}

function consumeFocusOrigin(): FocusOrigin | null {
  try {
    const value = window.sessionStorage.getItem(FOCUS_STORAGE_KEY);
    window.sessionStorage.removeItem(FOCUS_STORAGE_KEY);
    return value === 'switcher' || value === 'menu' ? value : null;
  } catch {
    return null;
  }
}

function isVisible(element: HTMLElement | null): element is HTMLElement {
  return element !== null && element.getClientRects().length > 0;
}

/**
 * Przełącznik języka (client component).
 * Zmienia locale, zachowując bieżącą ścieżkę (usePathname/useRouter z @/i18n/navigation).
 * Bez pełnego przeładowania — nawigacja w tranzycji. Etykieta z i18n (footer.langLabel).
 * Parametr powrotu `?next=` (logowanie) przechodzi na nowy język razem ze stroną.
 *
 * `side="top"` otwiera listę nad przyciskiem — dla miejsc przy dolnej krawędzi ekranu
 * (panel menu mobilnego), gdzie lista otwierana w dół wychodziłaby poza viewport i nie
 * dałoby się wybrać języka dotykiem.
 */
export function LocaleSwitcher({ side = 'bottom' }: { side?: 'top' | 'bottom' } = {}) {
  const t = useTranslations('footer');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const trigger = triggerRef.current;
    // Panel menu mobilnego montuje własny przełącznik dopiero po otwarciu — przywracanie
    // fokusu obsługuje instancja poza dialogiem (stopka), zawsze obecna na stronie.
    if (!trigger || trigger.closest('[role="dialog"]')) return;
    const origin = consumeFocusOrigin();
    if (origin === null) return;
    const menuButton = document.querySelector<HTMLElement>(
      'header button[aria-haspopup="dialog"]',
    );
    if (origin === 'menu' && isVisible(menuButton)) {
      menuButton.focus();
    } else {
      trigger.focus();
    }
  }, []);

  function handleChange(next: string) {
    const target = routing.locales.find((loc) => loc === next);
    if (!target || target === locale) return;
    rememberFocusOrigin(triggerRef.current?.closest('[role="dialog"]') ? 'menu' : 'switcher');
    startTransition(() => {
      const search = relocalizeNextParam(window.location.search, target);
      router.replace(`${pathname}${search}${window.location.hash}`, {
        locale: target,
      });
    });
  }

  return (
    <Select value={locale} onValueChange={handleChange}>
      <SelectTrigger
        ref={triggerRef}
        className="h-11 w-auto gap-2"
        aria-label={t('langLabel')}
        aria-busy={isPending || undefined}
      >
        <Languages className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        className={side === 'top' ? 'bottom-[calc(100%+0.25rem)] top-auto' : undefined}
      >
        {routing.locales.map((loc) => (
          <SelectItem key={loc} value={loc}>
            <span lang={loc}>{localeNames[loc]}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
