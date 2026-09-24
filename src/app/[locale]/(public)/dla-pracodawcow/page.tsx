import type { Metadata } from 'next';
import Image from 'next/image';
import { ArrowRight, BadgeCheck, FileText, Handshake, Inbox, Languages, ListChecks, MessageSquare, Target, UserPlus } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { brandShareImageUrl } from '@/lib/seo/structured-data';

/**
 * Strona informacyjna dla pracodawców `/dla-pracodawcow` (#339) — SSG, INDEKSOWALNA.
 *
 * Pozycja nawigacji „Dla pracodawców” prowadzi tutaj, a nie wprost do formularza. Treść opisuje
 * wyłącznie to, co produkt realnie robi (konto + nazwa firmy, weryfikacja przez administratora,
 * kreator z szkicem, zgłoszenia/wiadomości/propozycje, e-maile w języku odbiorcy, bezpłatny etap
 * z docs/PRODUCT_DECISIONS.md). Bez cen, liczb i treści prawnych. CTA → rejestracja pracodawcy.
 */

const EMPLOYERS_PATH = '/dla-pracodawcow';
const REGISTER_PATH = '/rejestracja-pracodawca';

type PageProps = { params: Promise<{ locale: string }> };

export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'employers' });

  const base = env.siteUrl;
  const url = `${base}/${locale}${EMPLOYERS_PATH}`;
  const shareImage = brandShareImageUrl(base);
  const languages: Record<string, string> = {};
  for (const supported of routing.locales) {
    languages[supported] = `${base}/${supported}${EMPLOYERS_PATH}`;
  }
  languages['x-default'] = `${base}/${routing.defaultLocale}${EMPLOYERS_PATH}`;

  return {
    title: { absolute: t('metaTitle') },
    description: t('metaDescription'),
    alternates: { canonical: url, languages },
    openGraph: {
      title: t('metaTitle'),
      description: t('metaDescription'),
      url,
      siteName: 'Pracuj.be',
      type: 'website',
      locale,
      images: [{ url: shareImage, width: 1200, height: 630, alt: 'Pracuj.be' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('metaTitle'),
      description: t('metaDescription'),
      images: [shareImage],
    },
  };
}

const STEPS = [
  { key: 'step1', icon: UserPlus },
  { key: 'step2', icon: BadgeCheck },
  { key: 'step3', icon: FileText },
  { key: 'step4', icon: Inbox },
] as const;

const CANDIDATES = [
  { key: 'candidatesProfile', icon: ListChecks },
  { key: 'candidatesLanguages', icon: Languages },
  { key: 'candidatesMatch', icon: Target },
] as const;

const CONTACT = [
  { key: 'contactApplications', icon: Inbox },
  { key: 'contactMessages', icon: MessageSquare },
  { key: 'contactProposals', icon: Handshake },
] as const;

const PRIMARY_CTA =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
const SECONDARY_LINK =
  'inline-flex min-h-12 items-center gap-1 font-semibold text-foreground underline decoration-accent underline-offset-4 hover:text-accent-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export default async function EmployersPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, tCommon] = await Promise.all([getTranslations('employers'), getTranslations('common')]);

  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: tCommon('home'), item: `${env.siteUrl}/${locale}` },
      {
        '@type': 'ListItem',
        position: 2,
        name: t('pageTitle'),
        item: `${env.siteUrl}/${locale}${EMPLOYERS_PATH}`,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      {/* Nagłówek: tekst + CTA obok fotografii ilustracyjnej (jak hero strony głównej). */}
      <section className="border-b border-border bg-background">
        <div className="container py-8 md:py-12">
          <nav aria-label={tCommon('breadcrumb')} className="mb-6 text-sm text-muted-foreground">
            <ol className="flex flex-wrap items-center gap-1.5">
              <li>
                <Link href="/" className="transition-colors hover:text-foreground">
                  {tCommon('home')}
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-foreground">{t('pageTitle')}</li>
            </ol>
          </nav>
          <div className="grid items-center gap-8 md:grid-cols-[1.16fr_1fr] lg:gap-12">
            <div className="min-w-0">
              <p className="mb-5 text-xs font-bold uppercase tracking-[0.18em] text-accent-dark">
                {t('pageTitle')}
              </p>
              <h1 className="break-words text-4xl font-bold leading-[1.08] tracking-tight text-foreground hyphens-auto sm:text-5xl">
                {t('title')}
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">{t('intro')}</p>
              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-4">
                <Link href={REGISTER_PATH} className={PRIMARY_CTA}>
                  {t('ctaRegister')}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link href="/logowanie" className={SECONDARY_LINK}>
                  {t('ctaLogin')}
                </Link>
              </div>
            </div>
            {/* Fotografia jest ilustracyjna, nie przedstawia konkretnego pracodawcy. */}
            <figure className="min-w-0 overflow-hidden rounded-3xl rounded-tl-[5rem] bg-soft lg:rounded-tl-[6rem]">
              <div className="relative aspect-[3/2] md:aspect-[4/3]">
                <Image
                  src="/images/people/team.webp"
                  alt=""
                  fill
                  sizes="(min-width: 1280px) 520px, (min-width: 768px) 45vw, 100vw"
                  className="object-cover"
                />
              </div>
              <figcaption className="flex items-center gap-3 px-5 py-4 text-sm leading-snug text-foreground">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent font-bold text-white" aria-hidden="true">.be</span>
                <span>
                  <strong className="block">{t('photoCaption')}</strong>
                  <span className="text-muted-foreground">{t('photoDisclaimer')}</span>
                </span>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* Kroki */}
      <section aria-labelledby="employers-steps" className="container py-12 md:py-16">
        <h2 id="employers-steps" className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t('stepsTitle')}
        </h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ key, icon: Icon }, index) => (
            <li key={key} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-background p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-sm font-bold text-accent-foreground" aria-hidden="true">
                  {index + 1}
                </span>
                <Icon className="h-5 w-5 text-accent-dark" aria-hidden="true" />
              </div>
              <h3 className="break-words text-base font-semibold text-foreground hyphens-auto">{t(`${key}Title`)}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{t(`${key}Desc`)}</p>
            </li>
          ))}
        </ol>

        <div className="mt-8 rounded-2xl border border-border bg-soft p-6">
          <h2 className="text-lg font-bold tracking-tight text-foreground">{t('freeTitle')}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{t('freeDesc')}</p>
        </div>
      </section>

      {/* Kandydaci + kontakt */}
      <section className="border-t border-border bg-soft">
        <div className="container grid gap-10 py-12 md:py-16 lg:grid-cols-2 lg:gap-12">
          {[
            { id: 'employers-candidates', title: t('candidatesTitle'), items: CANDIDATES },
            { id: 'employers-contact', title: t('contactTitle'), items: CONTACT },
          ].map((group) => (
            <div key={group.id} className="min-w-0">
              <h2 id={group.id} className="text-2xl font-bold tracking-tight text-foreground">
                {group.title}
              </h2>
              <ul aria-labelledby={group.id} className="mt-6 space-y-4">
                {group.items.map(({ key, icon: Icon }) => (
                  <li key={key} className="flex gap-4 rounded-2xl border border-border bg-background p-5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent-dark" aria-hidden="true">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold text-foreground hyphens-auto">{t(`${key}Title`)}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(`${key}Desc`)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Końcowe CTA */}
      <section className="container py-12 md:py-16">
        <div className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-background p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('finalTitle')}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('finalDesc')}</p>
          </div>
          <Link href={REGISTER_PATH} className={`${PRIMARY_CTA} shrink-0`}>
            {t('ctaRegister')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </>
  );
}
