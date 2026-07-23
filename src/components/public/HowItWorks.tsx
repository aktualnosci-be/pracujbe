import * as React from 'react';
import {
  type LucideIcon,
  MessagesSquare,
  MousePointerClick,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * HowItWorks — sekcja „Jak to działa" w 4 krokach.
 *
 * Numerowane kroki z ikoną, tytułem i opisem (namespace `home`, klucze stepN*).
 * Komponent serwerowy, bez interakcji.
 */

const STEPS: { titleKey: string; descKey: string; Icon: LucideIcon }[] = [
  { titleKey: 'step1Title', descKey: 'step1Desc', Icon: UserPlus },
  { titleKey: 'step2Title', descKey: 'step2Desc', Icon: Sparkles },
  { titleKey: 'step3Title', descKey: 'step3Desc', Icon: MousePointerClick },
  { titleKey: 'step4Title', descKey: 'step4Desc', Icon: MessagesSquare },
];

export async function HowItWorks(): Promise<React.JSX.Element> {
  const t = await getTranslations('home');

  return (
    <section className="border-t border-border bg-soft">
      <div className="container py-12 md:py-16">
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t('howTitle')}
        </h2>
        <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ titleKey, descKey, Icon }, index) => (
            <li key={titleKey} className="relative flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold text-muted-foreground">
                  {String(index + 1).padStart(2, '0')}
                </span>
              </div>
              <h3 className="text-base font-semibold text-foreground">{t(titleKey)}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{t(descKey)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
