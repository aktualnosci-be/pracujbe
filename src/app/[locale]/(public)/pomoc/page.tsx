import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { H2_EXTENDED, P_EXTENDED, PAPER } from '@/components/dashboard/panel-styles';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';

import { buildInfoMetadata } from '../_info/info-metadata';

/**
 * Pomoc (#61) — pytania i odpowiedzi opisujące WYŁĄCZNIE to, co portal realnie robi
 * (profil bez CV, aplikacja bez konta, deterministyczne dopasowanie, widoczność profilu,
 * alerty, dane konta, bezpłatny etap dla pracodawców, weryfikacja firmy, zespół, e-maile
 * w języku odbiorcy, zgłaszanie ofert). Bez obietnic terminów i bez treści prawnych.
 * SSG, indeksowalna (canonical + hreflang), w sitemap. Treść: `help.*` (PL/NL/FR/EN).
 *
 * Wygląd złożony z prymitywów prototypu (brak ekranu Pomocy w prototypie): nagłówek
 * `.pp-page-title`, grupy w `.paper` z nagłówkiem `.extended h2`, pytania jako natywne
 * `<details>` (dostępne bez JS — klawiatura i czytnik ekranu obsługują je same).
 */

const PATH = '/pomoc';

type PageProps = { params: Promise<{ locale: string }> };

/** Grupy pytań; klucze `help.faq.<id>.q` / `.a`. Kolejność = kolejność na stronie. */
const HELP_GROUPS = [
  { id: 'candidates', items: ['noCv', 'guestApply', 'match', 'visibility', 'alerts', 'data'] },
  { id: 'employers', items: ['free', 'verification', 'drafts', 'team', 'applications'] },
  { id: 'account', items: ['languages', 'emailLanguage', 'noEmail', 'suspicious'] },
] as const;

export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'help' });
  return buildInfoMetadata({ locale, path: PATH, title: t('metaTitle'), description: t('metaDescription') });
}

export default async function HelpPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale, namespace: 'help' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);

  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: tCommon('home'), item: `${env.siteUrl}/${locale}` },
      { '@type': 'ListItem', position: 2, name: t('title'), item: `${env.siteUrl}/${locale}${PATH}` },
    ],
  };

  const link = (href: string) =>
    function RichLink(chunks: ReactNode) {
      return (
        <Link href={href} className="font-semibold text-primary underline underline-offset-4 hover:no-underline">
          {chunks}
        </Link>
      );
    };

  return (
    <div className="container py-10 md:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <div className="mx-auto max-w-3xl">
        <h1 className="pp-page-title">{t('title')}</h1>
        <p className={`mt-4 ${P_EXTENDED}`}>{t('intro')}</p>

        {HELP_GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`help-${group.id}`} className={PAPER}>
            <h2 id={`help-${group.id}`} className={H2_EXTENDED}>
              {t(`groups.${group.id}`)}
            </h2>
            <ul className="mt-3 divide-y divide-[color:var(--pp-line-soft)]">
              {group.items.map((item) => (
                <li key={item}>
                  <details className="group">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 text-[15px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0 break-words">{t(`faq.${item}.q`)}</span>
                      <ChevronDown
                        className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                        aria-hidden="true"
                      />
                    </summary>
                    <p className={`pb-4 ${P_EXTENDED}`}>
                      {t.rich(`faq.${item}.a`, {
                        register: link('/rejestracja'),
                        employer: link('/dla-pracodawcow'),
                        jobs: link('/oferty-pracy'),
                      })}
                    </p>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section aria-labelledby="help-contact" className={PAPER}>
          <h2 id="help-contact" className={H2_EXTENDED}>
            {t('contactTitle')}
          </h2>
          <p className={`mt-3 ${P_EXTENDED}`}>{t('contactDesc')}</p>
          <Link
            href="/kontakt"
            className="mt-5 inline-flex min-h-[49px] items-center justify-center rounded-[11px] border border-primary bg-primary px-[19px] py-3 text-sm font-[650] text-primary-foreground hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t('contactCta')}
          </Link>
        </section>
      </div>
    </div>
  );
}
