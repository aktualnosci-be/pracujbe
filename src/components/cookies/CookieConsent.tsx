'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import {
  acceptAllCategories,
  getConsent,
  necessaryOnly,
  type ConsentCategories,
  type ConsentCategory,
} from '@/lib/consent';
import { OPEN_SETTINGS_EVENT, updateConsent } from '@/lib/consent-store';
import { Analytics } from './Analytics';

/**
 * System zgód na cookies (RODO). Montowany globalnie w [locale]/layout.
 *
 * - Baner przy pierwszej wizycie (brak ważnej zgody): trzy równorzędne wizualnie opcje —
 *   odrzuć opcjonalne / dostosuj / zaakceptuj wszystkie. Odrzucenie jest tak samo łatwe
 *   jak akceptacja (ten sam wariant i rozmiar przycisku) — Invariant #7.
 * - „Dostosuj" oraz przycisk w stopce otwierają centrum ustawień (Dialog) z przełącznikami
 *   kategorii wg makiety 07 pkt 6; `necessary` jest zawsze aktywna („Zawsze włączone", bez
 *   przełącznika).
 * - Renderuje <Analytics/>, który sam pilnuje, by nic nie ładować przed zgodą.
 *
 * Do momentu zamontowania po stronie klienta komponent nie renderuje banera (uniknięcie
 * niezgodności hydratacji — zgoda żyje w cookie dostępnym dopiero w przeglądarce).
 */

type CategoryMeta = {
  key: ConsentCategory;
  nameKey: string;
  descKey: string;
  locked: boolean;
};

const CATEGORY_META: readonly CategoryMeta[] = [
  { key: 'necessary', nameKey: 'necessaryName', descKey: 'necessaryDesc', locked: true },
  { key: 'preferences', nameKey: 'preferencesName', descKey: 'preferencesDesc', locked: false },
  { key: 'analytics', nameKey: 'analyticsName', descKey: 'analyticsDesc', locked: false },
  { key: 'marketing', nameKey: 'marketingName', descKey: 'marketingDesc', locked: false },
];

/**
 * Dostępny przełącznik (switch). Renderowany jako natywny `<button role="switch">`, więc
 * obsługa klawiatury (Spacja/Enter) i fokus działają bez dodatkowego kodu; bez zależności
 * od @radix-ui/react-switch (nie ma jej w projekcie).
 */
function ConsentSwitch({
  checked,
  onCheckedChange,
  labelledBy,
  describedBy,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  labelledBy: string;
  describedBy: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        checked ? 'bg-accent' : 'bg-muted-foreground/30',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-sm transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

export function CookieConsent() {
  const t = useTranslations('cookies');
  const tNav = useTranslations('nav');
  const rowIdBase = useId();

  const [mounted, setMounted] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<ConsentCategories>(necessaryOnly());

  // Odczyt istniejącej zgody po stronie klienta.
  useEffect(() => {
    setMounted(true);
    const existing = getConsent();
    setBannerVisible(existing === null);
    if (existing) setDraft(existing.categories);
  }, []);

  // Otwarcie panelu na żądanie z zewnątrz (np. przycisk w stopce).
  useEffect(() => {
    function onOpenSettings() {
      const existing = getConsent();
      setDraft(existing ? existing.categories : necessaryOnly());
      setSettingsOpen(true);
    }
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpenSettings);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpenSettings);
  }, []);

  const persist = useCallback((categories: ConsentCategories) => {
    updateConsent(categories);
    setBannerVisible(false);
    setSettingsOpen(false);
  }, []);

  const handleAcceptAll = useCallback(() => persist(acceptAllCategories()), [persist]);
  const handleRejectOptional = useCallback(() => persist(necessaryOnly()), [persist]);
  const handleSaveSelection = useCallback(() => persist(draft), [persist, draft]);

  const openCustomize = useCallback(() => {
    const existing = getConsent();
    setDraft(existing ? existing.categories : necessaryOnly());
    setSettingsOpen(true);
  }, []);

  const toggleCategory = useCallback((key: ConsentCategory, value: boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <>
      {mounted ? <Analytics /> : null}

      {mounted && bannerVisible ? (
        <div
          role="region"
          aria-labelledby="cookie-banner-title"
          aria-describedby="cookie-banner-desc"
          className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background shadow-[0_-4px_24px_rgba(15,42,71,0.08)]"
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1 lg:max-w-2xl">
              <p id="cookie-banner-title" className="text-base font-semibold text-foreground">
                {t('bannerTitle')}
              </p>
              <p id="cookie-banner-desc" className="text-sm text-muted-foreground">
                {t('bannerDesc')}{' '}
                <Link
                  href="/cookie-policy"
                  className="font-medium text-accent underline-offset-4 hover:underline"
                >
                  {t('moreInfo')}
                </Link>
              </p>
            </div>
            {/* Invariant #7: trzy równorzędne opcje — odrzucenie tak samo łatwe jak akceptacja. */}
            <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
              <Button
                variant="outline"
                onClick={handleRejectOptional}
                className="w-full sm:w-auto"
              >
                {t('rejectOptional')}
              </Button>
              <Button variant="outline" onClick={openCustomize} className="w-full sm:w-auto">
                {t('customize')}
              </Button>
              <Button variant="outline" onClick={handleAcceptAll} className="w-full sm:w-auto">
                {t('acceptAll')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-xl border border-border bg-background p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Dialog.Title className="text-lg font-semibold text-foreground">
                  {t('settingsTitle')}
                </Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">
                  {t('settingsDesc')}
                </Dialog.Description>
              </div>
              <Dialog.Close
                aria-label={tNav('close')}
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'shrink-0')}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </Dialog.Close>
            </div>

            <div className="-mx-1 flex-1 divide-y divide-border overflow-y-auto px-1">
              {CATEGORY_META.map((category) => {
                const labelId = `${rowIdBase}-${category.key}-label`;
                const descId = `${rowIdBase}-${category.key}-desc`;
                const checked = category.locked ? true : draft[category.key];
                return (
                  <div
                    key={category.key}
                    className="flex items-start justify-between gap-4 py-4 first:pt-1"
                  >
                    <div className="space-y-0.5">
                      <p id={labelId} className="text-sm font-medium text-foreground">
                        {t(category.nameKey)}
                      </p>
                      <p id={descId} className="text-sm text-muted-foreground">
                        {t(category.descKey)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center pt-0.5">
                      {category.locked ? (
                        <span className="whitespace-nowrap text-xs font-medium text-success">
                          {t('alwaysOn')}
                        </span>
                      ) : (
                        <ConsentSwitch
                          checked={checked}
                          onCheckedChange={(value) => toggleCategory(category.key, value)}
                          labelledBy={labelId}
                          describedBy={descId}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <Link
              href="/cookie-policy"
              className="text-sm font-medium text-accent underline-offset-4 hover:underline"
            >
              {t('moreInfo')}
            </Link>

            {/* Kolejność DOM: odrzuć · zapisz · akceptuj (desktop lewo→prawo).
                Na mobile flex-col-reverse podnosi „Akceptuj wszystkie" na górę — wg makiety. */}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={handleRejectOptional}
                className="w-full sm:w-auto"
              >
                {t('rejectOptional')}
              </Button>
              <Button variant="outline" onClick={handleSaveSelection} className="w-full sm:w-auto">
                {t('save')}
              </Button>
              <Button onClick={handleAcceptAll} className="w-full sm:w-auto">
                {t('acceptAll')}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
