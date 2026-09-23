'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui/button';
import { Link, usePathname } from '@/i18n/navigation';
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
 *
 * Dostępność banera (WCAG 2.4.3 / 2.4.11 / 1.4.4 / 1.4.10):
 * - baner trafia do kontenera wstawianego tuż za odnośnikiem „Przejdź do treści" (albo na
 *   początek <body>, gdy strona go nie ma), więc jest na początku kolejności Tab, a nie za stopką;
 * - jego wysokość jest wystawiana jako `--cookie-banner-h` na <html>; globals.css zamienia ją
 *   na `scroll-padding-bottom` i `padding-bottom`, dzięki czemu element z fokusem i koniec strony
 *   dają się przewinąć ponad baner;
 * - baner ma ograniczoną wysokość i przewija się wewnątrz, a przyciski zawijają tekst — przy
 *   powiększonym tekście żadna z trzech opcji nie wychodzi poza ekran.
 */

/** Zmienna CSS z wysokością banera (odczytywana w globals.css). */
const BANNER_HEIGHT_VAR = '--cookie-banner-h';
/** Zapas nad banerem dla przewijanego elementu z fokusem (px). */
const BANNER_SCROLL_GAP = 8;

/** Wstawia kontener banera za odnośnikiem do treści (lub na początek body). */
function placeBannerHost(host: HTMLElement) {
  const skipLink = document.querySelector('a[href="#main-content"]');
  if (skipLink?.parentNode) {
    if (skipLink.nextSibling !== host) skipLink.after(host);
  } else if (document.body.firstChild !== host) {
    document.body.prepend(host);
  }
}

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
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        // WCAG 1.4.11: stan „wył." ma obrys i gałkę w kolorze muted-foreground (≥ 3:1 z tłem).
        checked ? 'border-transparent bg-accent' : 'border-muted-foreground bg-background',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none block h-5 w-5 rounded-full shadow-sm transition-transform',
          checked ? 'translate-x-5 bg-background' : 'translate-x-0 bg-muted-foreground',
        )}
      />
    </button>
  );
}

/** Przyciski banera zawijają tekst (bez `whitespace-nowrap`), zachowując min. 48 px wysokości. */
const BANNER_BUTTON = 'h-auto min-h-12 w-full whitespace-normal text-center sm:w-auto';

export function CookieConsent() {
  const t = useTranslations('cookies');
  const tNav = useTranslations('nav');
  const rowIdBase = useId();

  const [mounted, setMounted] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<ConsentCategories>(necessaryOnly());
  const [bannerHost, setBannerHost] = useState<HTMLElement | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

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

  // Kontener banera na początku kolejności Tab. Po zmianie trasy layout mógł się wymienić
  // (np. publiczny → auth), więc kontener jest ponownie umieszczany we właściwym miejscu.
  useEffect(() => {
    if (!bannerVisible) return;
    const host = hostRef.current ?? document.createElement('div');
    hostRef.current = host;
    placeBannerHost(host);
    setBannerHost(host);
  }, [bannerVisible, pathname]);

  useEffect(() => {
    return () => {
      hostRef.current?.remove();
      document.documentElement.style.removeProperty(BANNER_HEIGHT_VAR);
    };
  }, []);

  useEffect(() => {
    if (bannerVisible) return;
    hostRef.current?.remove();
    hostRef.current = null;
    setBannerHost(null);
  }, [bannerVisible]);

  // Wysokość banera → zmienna CSS (scroll-padding/padding strony w globals.css).
  useEffect(() => {
    const root = document.documentElement;
    const banner = bannerRef.current;
    if (!bannerVisible || !bannerHost || !banner) {
      root.style.removeProperty(BANNER_HEIGHT_VAR);
      return;
    }
    const update = () => {
      const height = Math.ceil(banner.getBoundingClientRect().height);
      root.style.setProperty(BANNER_HEIGHT_VAR, `${height + BANNER_SCROLL_GAP}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(banner);
    return () => {
      observer.disconnect();
      root.style.removeProperty(BANNER_HEIGHT_VAR);
    };
  }, [bannerVisible, bannerHost]);

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

      {mounted && bannerVisible && bannerHost
        ? createPortal(
            <div
              ref={bannerRef}
              role="region"
              aria-labelledby="cookie-banner-title"
              aria-describedby="cookie-banner-desc"
              className="fixed inset-x-0 bottom-0 z-50 max-h-[60dvh] overflow-y-auto overscroll-contain border-t border-border bg-background shadow-[0_-4px_24px_rgba(15,42,71,0.08)]"
            >
              <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-1 lg:max-w-2xl">
                  <p id="cookie-banner-title" className="text-base font-semibold text-foreground">
                    {t('bannerTitle')}
                  </p>
                  <p id="cookie-banner-desc" className="text-sm text-muted-foreground">
                    {t('bannerDesc')}{' '}
                    <Link
                      href="/polityka-cookies"
                      className="font-medium text-accent underline-offset-4 hover:underline"
                    >
                      {t('moreInfo')}
                    </Link>
                  </p>
                </div>
                {/* Invariant #7: trzy równorzędne opcje — odrzucenie tak samo łatwe jak akceptacja. */}
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:max-w-[60%] lg:shrink-0">
                  <Button
                    variant="outline"
                    onClick={handleRejectOptional}
                    className={BANNER_BUTTON}
                  >
                    {t('rejectOptional')}
                  </Button>
                  <Button variant="outline" onClick={openCustomize} className={BANNER_BUTTON}>
                    {t('customize')}
                  </Button>
                  <Button variant="outline" onClick={handleAcceptAll} className={BANNER_BUTTON}>
                    {t('acceptAll')}
                  </Button>
                </div>
              </div>
            </div>,
            bannerHost,
          )
        : null}

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
                        <span className="whitespace-nowrap text-xs font-medium text-success-text">
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
              href="/polityka-cookies"
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
