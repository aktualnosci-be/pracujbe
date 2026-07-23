'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link, useRouter } from '@/i18n/navigation';

/**
 * HeroSearch — formularz wyszukiwania na stronie głównej (komponent kliencki).
 *
 * Dwa pola (stanowisko + miasto) oraz przycisk, który nawiguje do listy ofert
 * z parametrami zapytania (`keyword`, `city`). Pod formularzem dodatkowe linki
 * CTA: utwórz profil (kandydat) oraz dodaj ofertę (pracodawca).
 *
 * Nawigacja przez `useRouter` z `@/i18n/navigation`, dzięki czemu docelowy adres
 * automatycznie zachowuje prefiks bieżącego języka.
 */

const JOBS_PATH = '/oferty-pracy';
const CREATE_PROFILE_PATH = '/rejestracja';
const POST_JOB_PATH = '/dla-pracodawcow';

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
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        role="search"
        className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 shadow-sm sm:flex-row sm:items-center sm:gap-2 sm:p-2"
      >
        <div className="flex-1">
          <label htmlFor="hero-keyword" className="sr-only">
            {t('searchJobPlaceholder')}
          </label>
          <Input
            id="hero-keyword"
            name="keyword"
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t('searchJobPlaceholder')}
            className="border-transparent shadow-none focus-visible:ring-1"
          />
        </div>

        <div className="hidden w-px self-stretch bg-border sm:block" aria-hidden="true" />

        <div className="flex-1">
          <label htmlFor="hero-city" className="sr-only">
            {t('searchLocationPlaceholder')}
          </label>
          <Input
            id="hero-city"
            name="city"
            type="search"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            placeholder={t('searchLocationPlaceholder')}
            className="border-transparent shadow-none focus-visible:ring-1"
          />
        </div>

        <Button type="submit" size="lg" className="sm:w-auto">
          <Search className="h-4 w-4" aria-hidden="true" />
          {t('searchButton')}
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
        <Link
          href={CREATE_PROFILE_PATH}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('ctaCreateProfile')}
        </Link>
        <Link
          href={POST_JOB_PATH}
          className="font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {t('ctaPostJob')}
        </Link>
      </div>
    </div>
  );
}
