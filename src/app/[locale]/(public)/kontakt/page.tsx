import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { H2_EXTENDED, P_EXTENDED, PAPER } from '@/components/dashboard/panel-styles';
import { ContactForm } from '@/components/public/ContactForm';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

import { buildInfoMetadata } from '../_info/info-metadata';

/**
 * Kontakt (#61) — publiczny formularz kontaktu (także bez konta). Kanałem kontaktu jest
 * formularz: wiadomość trafia do bazy i do panelu administratora (`/admin/kontakt`),
 * administratorzy dostają powiadomienie e-mail w swoim języku, a nadawca — potwierdzenie
 * w języku formularza. Ochrona: limiter + Turnstile (`contact`, fail-closed) w akcji, limit
 * i idempotencja w bazie. Strona bez treści prawnych i bez obietnic terminu odpowiedzi.
 *
 * Strona sama jest statyczna (SSG, indeksowalna); formularz to wyspa kliencka.
 */

const PATH = '/kontakt';

type PageProps = { params: Promise<{ locale: string }> };

export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'contact' });
  return buildInfoMetadata({ locale, path: PATH, title: t('metaTitle'), description: t('metaDescription') });
}

export default async function ContactPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'contact' });

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
      <div className="mx-auto grid max-w-5xl gap-x-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h1 className="pp-page-title">{t('title')}</h1>
          <p className={`mt-4 ${P_EXTENDED}`}>{t('intro')}</p>
          <ContactForm />
        </div>
        <aside aria-labelledby="contact-before" className="min-w-0 lg:pt-[88px]">
          <section className={PAPER}>
            <h2 id="contact-before" className={H2_EXTENDED}>
              {t('beforeTitle')}
            </h2>
            <ul className="mt-3 space-y-3">
              <li className={P_EXTENDED}>{t.rich('beforeHelp', { help: link('/pomoc') })}</li>
              <li className={P_EXTENDED}>{t.rich('beforeReport', { jobs: link('/oferty-pracy') })}</li>
              <li className={P_EXTENDED}>{t('beforeNoIds')}</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
