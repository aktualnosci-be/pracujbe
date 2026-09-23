'use client';

import { useTransition } from 'react';
import { Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing, localeNames } from '@/i18n/routing';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Przełącznik języka (client component).
 * Zmienia locale, zachowując bieżącą ścieżkę (usePathname/useRouter z @/i18n/navigation).
 * Bez pełnego przeładowania — nawigacja w tranzycji. Etykieta z i18n (footer.langLabel).
 */
export function LocaleSwitcher() {
  const t = useTranslations('footer');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(next: string) {
    const target = routing.locales.find((loc) => loc === next);
    if (!target || target === locale) return;
    startTransition(() => {
      router.replace(`${pathname}${window.location.search}${window.location.hash}`, {
        locale: target,
      });
    });
  }

  return (
    <Select value={locale} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger className="h-11 w-auto gap-2" aria-label={t('langLabel')}>
        <Languages className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {routing.locales.map((loc) => (
          <SelectItem key={loc} value={loc}>
            {localeNames[loc]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
