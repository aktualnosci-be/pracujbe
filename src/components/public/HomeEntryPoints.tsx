import * as React from 'react';
import { ArrowRight, FileText, UserRound } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';

/**
 * Dwa wejścia pod listą najnowszych ofert: „Utwórz profil kandydata” i „Dodaj ofertę pracy”.
 *
 * Dawniej kafelki pod wyszukiwarką w hero. Prototyp „Ludzie i praca” nie ma ich w hero
 * (wyszukiwarka stoi sama), ale ma kartę `p-profile-note` („Profil zamiast CV”) w sekcji pod
 * ofertami — stąd ten sam wygląd: jasna karta z czerwonym akcentem i linkiem. Cel linków
 * i teksty bez zmian (namespace `home`, klucze cta*). Komponent serwerowy.
 */

const ENTRIES = [
  { href: '/rejestracja', Icon: UserRound, title: 'ctaCreateProfile', sub: 'ctaCreateProfileSub' },
  { href: '/rejestracja-pracodawca', Icon: FileText, title: 'ctaPostJob', sub: 'ctaPostJobSub' },
] as const;

export async function HomeEntryPoints(): Promise<React.JSX.Element> {
  const t = await getTranslations('home');

  return (
    <ul className="grid gap-4 md:grid-cols-2 md:gap-5">
      {ENTRIES.map(({ href, Icon, title, sub }) => (
        <li key={href} className="min-w-0">
          <Link
            href={href}
            className="group flex h-full items-center gap-4 rounded-[1.1875rem] border border-primary/20 bg-primary/[0.03] p-5 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-6"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-bold tracking-tight text-foreground">{t(title)}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{t(sub)}</span>
            </span>
            <ArrowRight
              className="h-5 w-5 shrink-0 text-foreground transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
