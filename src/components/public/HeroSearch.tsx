'use client';

import * as React from 'react';
import { ArrowUpRight, MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';

/**
 * HeroSearch — wyszukiwarka strony głównej (komponent kliencki), wg prototypu „Ludzie i praca”
 * (`.people .search`): jeden kontener z ramką, dwa pola z widocznymi etykietami nad wejściem,
 * pionowy separator i czerwony przycisk „Szukaj pracy ↗”. Na wąskich ekranach pola układają
 * się w kolumnę z poziomym separatorem.
 *
 * Kafelki „Utwórz profil / Dodaj ofertę” (dawniej pod wyszukiwarką) są w `HomeEntryPoints`
 * niżej na stronie — prototyp nie ma ich w hero.
 *
 * Nawigacja przez `useRouter` z `@/i18n/navigation`, dzięki czemu docelowy adres
 * zachowuje prefiks bieżącego języka. Puste pola nie trafiają do query.
 */

const JOBS_PATH = '/oferty-pracy';

export function HeroSearch(): React.JSX.Element {
  const t = useTranslations('home');
  const router = useRouter();

  const [keyword, setKeyword] = React.useState('');
  const [city, setCity] = React.useState('');

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const query: Record<string, string> = {};
    const trimmedKeyword = keyword.trim();
    const trimmedCity = city.trim();
    if (trimmedKeyword) query.keyword = trimmedKeyword;
    if (trimmedCity) query.city = trimmedCity;

    router.push({ pathname: JOBS_PATH, query });
  }

  return (
    <form
      onSubmit={handleSubmit}
      role="search"
      className="grid gap-1.5 rounded-2xl border border-border bg-background p-2.5 shadow-sm lg:grid-cols-[1.2fr_auto_1fr_auto] lg:items-center lg:gap-3 lg:rounded-[1.0625rem]"
    >
      {/* Jedno pole = etykieta nad wejściem bez własnej ramki (`.people .search`). Obrys
          fokusu dostaje cała komórka (`focus-within`), więc fokus klawiatury jest widoczny,
          choć wejście nie ma ramki (WCAG 2.4.7 / 2.4.11). */}
      <div className="rounded-xl px-1.5 py-2 focus-within:ring-2 focus-within:ring-ring lg:px-4">
        <label htmlFor="hero-keyword" className="block text-xs font-semibold text-muted-foreground">
          {t('heroSearchJobLabel')}
        </label>
        <input
          id="hero-keyword"
          name="keyword"
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t('searchJobPlaceholder')}
          className="mt-1.5 block min-h-7 w-full min-w-0 border-0 bg-transparent p-0 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>

      {/* Separator pól: poziomy na wąskich ekranach, pionowy od `lg` (`.search label+label`). */}
      <div aria-hidden="true" className="mx-1.5 h-px bg-border lg:mx-0 lg:h-11 lg:w-px" />

      <div className="rounded-xl px-1.5 py-2 focus-within:ring-2 focus-within:ring-ring lg:px-4">
        <label htmlFor="hero-city" className="block text-xs font-semibold text-muted-foreground">
          {t('heroSearchLocationLabel')}
        </label>
        <div className="relative mt-1.5">
          <input
            id="hero-city"
            name="city"
            type="search"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            placeholder={t('searchLocationPlaceholder')}
            className="block min-h-7 w-full min-w-0 border-0 bg-transparent p-0 pr-7 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <MapPin
            className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      </div>

      <Button type="submit" size="lg" className="mt-1 min-h-12 w-full rounded-xl px-7 font-semibold lg:mt-0 lg:min-h-[3.625rem] lg:w-auto">
        {t('searchButton')}
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </form>
  );
}
