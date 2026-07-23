'use client';

import * as React from 'react';
import { ChevronRight, FileText, MapPin, Search, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link, useRouter } from '@/i18n/navigation';

/**
 * HeroSearch — wyszukiwarka hero strony głównej (komponent kliencki), wg makiety `01-home`.
 *
 * Biała karta z cieniem: dwa pola z widocznymi etykietami — „Stanowisko, słowo kluczowe"
 * oraz „Lokalizacja" (z ikoną pinu) — i granatowy przycisk „Szukaj pracy". Poniżej dwa
 * linki-akcje z ikoną, tytułem i podtytułem: utwórz profil kandydata / dodaj ofertę pracy.
 *
 * Nawigacja przez `useRouter` z `@/i18n/navigation`, dzięki czemu docelowy adres
 * zachowuje prefiks bieżącego języka. Puste pola nie trafiają do query.
 */

const JOBS_PATH = '/oferty-pracy';
const CREATE_PROFILE_PATH = '/rejestracja';
const POST_JOB_PATH = '/dla-pracodawcow';

const CTA_LINKS = [
  { href: CREATE_PROFILE_PATH, Icon: UserRound, title: 'ctaCreateProfile', sub: 'ctaCreateProfileSub' },
  { href: POST_JOB_PATH, Icon: FileText, title: 'ctaPostJob', sub: 'ctaPostJobSub' },
] as const;

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
    <div className="space-y-5">
      <form
        onSubmit={handleSubmit}
        role="search"
        className="rounded-2xl border border-border bg-background p-4 shadow-sm sm:p-5"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <div className="space-y-1.5">
            <label htmlFor="hero-keyword" className="block text-sm font-medium text-foreground">
              {t('heroSearchJobLabel')}
            </label>
            <Input
              id="hero-keyword"
              name="keyword"
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t('searchJobPlaceholder')}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="hero-city" className="block text-sm font-medium text-foreground">
              {t('heroSearchLocationLabel')}
            </label>
            <div className="relative">
              <Input
                id="hero-city"
                name="city"
                type="search"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder={t('searchLocationPlaceholder')}
                className="pr-10"
              />
              <MapPin
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
          </div>

          <Button type="submit" size="lg" className="w-full sm:col-span-2 lg:col-span-1 lg:w-auto">
            <Search className="h-4 w-4" aria-hidden="true" />
            {t('searchButton')}
          </Button>
        </div>
      </form>

      <div className="grid gap-3 sm:grid-cols-2">
        {CTA_LINKS.map(({ href, Icon, title, sub }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-center gap-3 rounded-xl border border-border bg-background p-3 transition-colors hover:border-accent/40 hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">{t(title)}</span>
              <span className="block text-xs text-muted-foreground">{t(sub)}</span>
            </span>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        ))}
      </div>
    </div>
  );
}
