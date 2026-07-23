import * as React from 'react';
import {
  BadgeCheck,
  FileX,
  Languages,
  type LucideIcon,
  MousePointerClick,
  Sparkles,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * Benefits — 5 korzyści platformy dla kandydatów.
 *
 * Ikona + tytuł + opis dla każdej korzyści (namespace `home`, klucze benefit*).
 * Komponent serwerowy, bez interakcji.
 */

const BENEFITS: { titleKey: string; descKey: string; Icon: LucideIcon }[] = [
  { titleKey: 'benefitNoCvTitle', descKey: 'benefitNoCvDesc', Icon: FileX },
  { titleKey: 'benefitMultilangTitle', descKey: 'benefitMultilangDesc', Icon: Languages },
  { titleKey: 'benefitEasyApplyTitle', descKey: 'benefitEasyApplyDesc', Icon: MousePointerClick },
  { titleKey: 'benefitMatchingTitle', descKey: 'benefitMatchingDesc', Icon: Sparkles },
  { titleKey: 'benefitVerifiedTitle', descKey: 'benefitVerifiedDesc', Icon: BadgeCheck },
];

export async function Benefits(): Promise<React.JSX.Element> {
  const t = await getTranslations('home');

  return (
    <section className="border-t border-border bg-soft">
      <div className="container py-12 md:py-16">
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t('benefitsTitle')}
        </h2>
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map(({ titleKey, descKey, Icon }) => (
            <li
              key={titleKey}
              className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="text-base font-semibold text-foreground">{t(titleKey)}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{t(descKey)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
