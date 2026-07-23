'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Search, SlidersHorizontal, X } from 'lucide-react';

import { useRouter, usePathname } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CategoryKey, ContractType } from '@/lib/jobs';

/**
 * Pasek filtrów listy ofert (client). Wszystkie filtry zapisywane są w URL (query params),
 * dzięki czemu SSR renderuje właściwe wyniki, a stan jest współdzielony (link, odświeżenie).
 *
 * Model interakcji (spójny na desktopie i mobile):
 * - pola tekstowe (słowo kluczowe, lokalizacja) zatwierdza Enter lub przycisk „Szukaj”;
 * - listy (branża, rodzaj umowy) stosują się natychmiast po wyborze — i przy okazji
 *   zatwierdzają wpisany już tekst (dlatego `apply` zawsze bierze aktualny stan pól).
 * Każda zmiana filtra resetuje paginację (parametr `page` jest pomijany).
 *
 * Na mobile pola otwierają się w panelu (Dialog) sterowanym stanem `open`.
 */

const CATEGORY_KEYS: readonly CategoryKey[] = [
  'construction',
  'transport',
  'warehouse',
  'production',
  'technical',
  'cleaning',
  'hospitality',
  'care',
  'logistics',
  'seasonal',
];

const CONTRACT_TYPES: readonly ContractType[] = [
  'permanent',
  'temporary',
  'interim',
  'freelance',
  'internship',
  'seasonal',
];

/** Sentinel „bez filtra” dla list wyboru (Select nie obsługuje pustej wartości jako opcji). */
const ALL = 'all';

export interface FiltersBarProps {
  keyword?: string;
  city?: string;
  category?: CategoryKey;
  contractType?: ContractType;
}

export function FiltersBar({
  keyword = '',
  city = '',
  category,
  contractType,
}: FiltersBarProps): React.JSX.Element {
  const t = useTranslations('jobs');
  const tCat = useTranslations('categories');
  const tContract = useTranslations('contractTypes');

  const router = useRouter();
  const pathname = usePathname();

  const [kw, setKw] = React.useState(keyword);
  const [loc, setLoc] = React.useState(city);
  const [cat, setCat] = React.useState<string>(category ?? ALL);
  const [contract, setContract] = React.useState<string>(contractType ?? ALL);
  const [open, setOpen] = React.useState(false);

  // Synchronizacja stanu z URL, gdy strona re-renderuje się po nawigacji.
  React.useEffect(() => setKw(keyword), [keyword]);
  React.useEffect(() => setLoc(city), [city]);
  React.useEffect(() => setCat(category ?? ALL), [category]);
  React.useEffect(() => setContract(contractType ?? ALL), [contractType]);

  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);

  const apply = React.useCallback(
    (next?: { kw?: string; loc?: string; cat?: string; contract?: string }) => {
      const params = new URLSearchParams();
      const k = (next?.kw ?? kw).trim();
      const l = (next?.loc ?? loc).trim();
      const c = next?.cat ?? cat;
      const ct = next?.contract ?? contract;

      if (k) params.set('keyword', k);
      if (l) params.set('city', l);
      if (c && c !== ALL) params.set('category', c);
      if (ct && ct !== ALL) params.set('contractType', ct);

      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [kw, loc, cat, contract, router, pathname],
  );

  const clear = React.useCallback(() => {
    setKw('');
    setLoc('');
    setCat(ALL);
    setContract(ALL);
    router.push(pathname);
    setOpen(false);
  }, [router, pathname]);

  const handleCategory = React.useCallback(
    (value: string) => {
      setCat(value);
      apply({ cat: value });
    },
    [apply],
  );

  const handleContract = React.useCallback(
    (value: string) => {
      setContract(value);
      apply({ contract: value });
    },
    [apply],
  );

  const hasActiveFilters =
    keyword.length > 0 ||
    city.length > 0 ||
    category !== undefined ||
    contractType !== undefined;

  const activeCount =
    (keyword ? 1 : 0) + (city ? 1 : 0) + (category ? 1 : 0) + (contractType ? 1 : 0);

  // Obsługa panelu mobilnego: Escape, blokada scrolla tła, focus na przycisku zamknięcia.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <div className="w-full">
      {/* ---------- Desktop / tablet: poziomy pasek ---------- */}
      <form
        className="hidden gap-3 rounded-lg border border-border bg-card p-4 md:grid md:grid-cols-[1.6fr_1fr_1fr_1fr_auto] md:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="filter-keyword">{t('keyword')}</Label>
          <Input
            id="filter-keyword"
            value={kw}
            onChange={(event) => setKw(event.target.value)}
            placeholder={t('keyword')}
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filter-location">{t('location')}</Label>
          <Input
            id="filter-location"
            value={loc}
            onChange={(event) => setLoc(event.target.value)}
            placeholder={t('location')}
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filter-category">{t('category')}</Label>
          <Select value={cat} onValueChange={handleCategory}>
            <SelectTrigger id="filter-category" aria-label={t('category')}>
              <SelectValue placeholder={t('allCategories')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allCategories')}</SelectItem>
              {CATEGORY_KEYS.map((key) => (
                <SelectItem key={key} value={key}>
                  {tCat(key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filter-contract">{t('contractType')}</Label>
          <Select value={contract} onValueChange={handleContract}>
            <SelectTrigger id="filter-contract" aria-label={t('contractType')}>
              <SelectValue placeholder={t('allContractTypes')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allContractTypes')}</SelectItem>
              {CONTRACT_TYPES.map((key) => (
                <SelectItem key={key} value={key}>
                  {tContract(key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button type="submit">
          <Search aria-hidden="true" />
          <span>{t('search')}</span>
        </Button>

        {hasActiveFilters ? (
          <div className="md:col-span-5">
            <Button type="button" variant="ghost" size="sm" onClick={clear}>
              <X aria-hidden="true" />
              <span>{t('clearFilters')}</span>
            </Button>
          </div>
        ) : null}
      </form>

      {/* ---------- Mobile: przycisk otwierający panel ---------- */}
      <div className="md:hidden">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <SlidersHorizontal aria-hidden="true" />
          <span>{t('filterButton')}</span>
          {activeCount > 0 ? (
            <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </div>

      {/* ---------- Mobile: panel filtrów (Dialog) ---------- */}
      {open ? (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t('filtersTitle')}
        >
          <div
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-2xl border-t border-border bg-background p-4 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t('filtersTitle')}</h2>
              <Button
                ref={closeButtonRef}
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label={t('filterButton')}
              >
                <X aria-hidden="true" />
              </Button>
            </div>

            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                apply();
                setOpen(false);
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="filter-keyword-m">{t('keyword')}</Label>
                <Input
                  id="filter-keyword-m"
                  value={kw}
                  onChange={(event) => setKw(event.target.value)}
                  placeholder={t('keyword')}
                  autoComplete="off"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="filter-location-m">{t('location')}</Label>
                <Input
                  id="filter-location-m"
                  value={loc}
                  onChange={(event) => setLoc(event.target.value)}
                  placeholder={t('location')}
                  autoComplete="off"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="filter-category-m">{t('category')}</Label>
                <Select value={cat} onValueChange={handleCategory}>
                  <SelectTrigger id="filter-category-m" aria-label={t('category')}>
                    <SelectValue placeholder={t('allCategories')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('allCategories')}</SelectItem>
                    {CATEGORY_KEYS.map((key) => (
                      <SelectItem key={key} value={key}>
                        {tCat(key)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="filter-contract-m">{t('contractType')}</Label>
                <Select value={contract} onValueChange={handleContract}>
                  <SelectTrigger id="filter-contract-m" aria-label={t('contractType')}>
                    <SelectValue placeholder={t('allContractTypes')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('allContractTypes')}</SelectItem>
                    {CONTRACT_TYPES.map((key) => (
                      <SelectItem key={key} value={key}>
                        {tContract(key)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <Button type="submit" className="w-full">
                  <Search aria-hidden="true" />
                  <span>{t('search')}</span>
                </Button>
                <Button type="button" variant="ghost" className="w-full" onClick={clear}>
                  <X aria-hidden="true" />
                  <span>{t('clearFilters')}</span>
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
