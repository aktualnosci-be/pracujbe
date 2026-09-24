'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';

/**
 * HeroSearch — wyszukiwarka strony głównej (komponent kliencki), kalka `.people .search`
 * z prototypu „Ludzie i praca” (klasy `.pp-search*` w globals.css): jeden kontener z ramką
 * (promień 17 px), etykiety nad polami, pola bez ramek, separator i czerwony przycisk
 * „Szukaj pracy ↗”. ≤ 850 px pola układają się w kolumnę z poziomym separatorem.
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
    <form onSubmit={handleSubmit} role="search" className="pp-search">
      {/* `.people .search`: etykieta z polem wewnątrz (label/for zachowane), bez ramek pól,
          separator między komórkami; fokus = obrys komórki (`label:focus-within`). */}
      <label htmlFor="hero-keyword">
        {t('searchWhatLabel')}
        <input
          id="hero-keyword"
          name="keyword"
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t('searchWhatPlaceholder')}
        />
      </label>
      <label htmlFor="hero-city">
        {t('searchWhereLabel')}
        <input
          id="hero-city"
          name="city"
          type="search"
          value={city}
          onChange={(event) => setCity(event.target.value)}
          placeholder={t('searchWherePlaceholder')}
        />
      </label>
      <button type="submit" className="pp-btn">
        {t('searchButton')} <span aria-hidden="true">↗</span>
      </button>
    </form>
  );
}
