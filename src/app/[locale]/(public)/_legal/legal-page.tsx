import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';

/**
 * Wspólny szkielet stron prawnych/informacyjnych (regulamin, prywatność, cookies,
 * o nas, FAQ, kontakt, pomoc).
 *
 * Strony są INDEKSOWALNE (bez noindex) — to publiczne treści witryny. Treść to placeholder
 * z i18n (namespace `legal`): nagłówek + wprowadzenie + informacja o przygotowaniu + data
 * ostatniej aktualizacji. NIE wymyślamy tu treści prawnej — właściwe zapisy uzupełnia człowiek.
 *
 * Renderuje się BEZ zmiennych środowiskowych (tylko i18n + `env.siteUrl` z fallbackiem).
 *
 * Katalog `_legal` ma prefiks `_`, więc Next.js pomija go w routingu (nie tworzy trasy).
 *
 * TODO(i18n-slugs): slugi są na razie wspólne dla wszystkich języków (jak `/oferty-pracy`);
 * lokalizowane slugi w mapie drogowej (spec 12).
 */

/** Klucze tytułów w namespace `legal` (jedno źródło prawdy dla metadanych i nagłówka). */
export type LegalTitleKey =
  | 'termsTitle'
  | 'privacyTitle'
  | 'cookiePolicyTitle'
  | 'aboutTitle'
  | 'faqTitle'
  | 'contactTitle'
  | 'helpTitle';

// Data ostatniej aktualizacji placeholdera — stała, aby nie zmieniała się przy każdym buildzie.
const LAST_UPDATED_ISO = '2026-07-23';

/**
 * Buduje metadane strony prawnej: tytuł z `legal.*`, kanoniczny URL oraz alternatywy
 * językowe (hreflang) dla wszystkich obsługiwanych locale + `x-default`.
 */
export async function buildLegalMetadata({
  locale,
  path,
  titleKey,
}: {
  locale: string;
  path: string;
  titleKey: LegalTitleKey;
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'legal' });

  const base = env.siteUrl;
  const languages: Record<string, string> = {};
  for (const supported of routing.locales) {
    languages[supported] = `${base}/${supported}${path}`;
  }
  languages['x-default'] = `${base}/${routing.defaultLocale}${path}`;

  return {
    title: t(titleKey),
    description: t('intro'),
    alternates: { canonical: `${base}/${locale}${path}`, languages },
  };
}

/** Treść strony prawnej (server component). Wszystkie stringi pochodzą z i18n. */
export async function LegalPage({
  locale,
  titleKey,
}: {
  locale: string;
  titleKey: LegalTitleKey;
}) {
  const t = await getTranslations({ locale, namespace: 'legal' });

  const lastUpdated = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
    new Date(LAST_UPDATED_ISO),
  );

  return (
    <div className="container py-12 md:py-16">
      <article className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {t(titleKey)}
        </h1>
        <p className="mt-4 text-base text-muted-foreground">{t('intro')}</p>
        <p className="mt-4 text-base text-muted-foreground">{t('placeholder')}</p>
        <p className="mt-8 text-sm text-muted-foreground">
          {t('lastUpdated', { date: lastUpdated })}
        </p>
      </article>
    </div>
  );
}
