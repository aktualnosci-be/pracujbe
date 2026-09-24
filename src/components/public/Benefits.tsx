import * as React from 'react';
import { BadgeCheck, type LucideIcon, MapPin, ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * Benefits — pasek zaufania (dawniej pod hero, wg makiety `01-home`).
 *
 * Trzy pozycje z zieloną ikoną potwierdzenia: szybka aplikacja bez CV, zweryfikowane oferty,
 * praca w całej Belgii. Każda ma tytuł i krótki podtytuł (namespace `home`, klucze trust*).
 * Prototyp „Ludzie i praca” nie ma paska między hero a ofertami, więc stoi pod wejściami
 * `HomeEntryPoints` — sama lista, sekcję zapewnia strona. Komponent serwerowy.
 */

const TRUST: { titleKey: string; subKey: string; Icon: LucideIcon }[] = [
  { titleKey: 'trustFastTitle', subKey: 'trustFastSub', Icon: ShieldCheck },
  { titleKey: 'trustVerifiedTitle', subKey: 'trustVerifiedSub', Icon: BadgeCheck },
  { titleKey: 'trustEverywhereTitle', subKey: 'trustEverywhereSub', Icon: MapPin },
];

export async function Benefits(): Promise<React.JSX.Element> {
  const t = await getTranslations('home');

  return (
    <ul className="grid gap-4 border-t border-border pt-6 sm:grid-cols-3 sm:gap-6">
      {TRUST.map(({ titleKey, subKey, Icon }) => (
        <li key={titleKey} className="flex items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{t(titleKey)}</span>
            <span className="block text-xs text-muted-foreground">{t(subKey)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
