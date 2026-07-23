import * as React from 'react';
import {
  ChevronRight,
  type LucideIcon,
  MessagesSquare,
  MousePointerClick,
  Search,
  Sparkles,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * HowItWorks — blok „Jak to działa?" w 4 krokach (wg makiety `01-home`).
 *
 * Każdy krok: ikona w kółku, numerowany tytuł i krótki opis (namespace `home`, klucze stepN*).
 * Na desktopie kroki w jednym rzędzie z lekkimi strzałkami między nimi; na mobile stackują się.
 * Komponent serwerowy; renderowany w kolumnie obok „Jesteś pracodawcą?" przez `page.tsx`.
 */

const STEPS: { titleKey: string; descKey: string; Icon: LucideIcon }[] = [
  { titleKey: 'step1Title', descKey: 'step1Desc', Icon: Search },
  { titleKey: 'step2Title', descKey: 'step2Desc', Icon: MousePointerClick },
  { titleKey: 'step3Title', descKey: 'step3Desc', Icon: MessagesSquare },
  { titleKey: 'step4Title', descKey: 'step4Desc', Icon: Sparkles },
];

export async function HowItWorks(): Promise<React.JSX.Element> {
  const t = await getTranslations('home');

  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
        {t('howTitle')}
      </h2>
      <ol className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        {STEPS.map(({ titleKey, descKey, Icon }, index) => (
          <li key={titleKey} className="relative flex flex-col items-center text-center">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {index + 1}. {t(titleKey)}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(descKey)}</p>
            {index < STEPS.length - 1 ? (
              <ChevronRight
                className="absolute -right-2 top-3.5 hidden h-5 w-5 text-border lg:block"
                aria-hidden="true"
              />
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
