import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ArrowRight, Building2, Flag, History, Users } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { AWAITING_FILTER, getAdminStats } from '@/lib/data/admin';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import {
  EYEBROW,
  H1,
  ICON_BOX,
  INTRO,
  PANEL,
  PANEL_H2,
  ROW,
  ROW_META,
  ROW_TITLE,
  SECTION_HEAD,
  STAT,
  STAT_LABEL,
  STAT_VALUE,
  STATS,
} from '@/components/admin/admin-styles';
import { cn } from '@/lib/utils';

/**
 * Panel administratora — Podsumowanie (Etap 7g).
 *
 * Kafelki statystyk (firmy / oczekujące na weryfikację / użytkownicy / otwarte zgłoszenia)
 * czytane service-rolem po potwierdzeniu roli admina w layoucie (guard). Błąd odczytu → jawny
 * stan błędu zamiast zer (#311). Kafelek kolejki weryfikacji prowadzi do listy (#307), kafelek
 * otwartych zgłoszeń — do listy z filtrem „Otwarte” (#416). Skróty do
 * poszczególnych sekcji. NOINDEX + `force-dynamic` (dziedziczone z layoutu).
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

/** Kafelek-link statystyki: podświetlenie i fokus wewnątrz ramki `.stats`. */
const STAT_LINK_CLASS =
  'transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

interface QuickLink {
  href: string;
  labelKey: string;
  descKey: string;
  icon: ReactNode;
}

const QUICK_LINKS: QuickLink[] = [
  {
    href: '/admin/firmy',
    labelKey: 'navCompanies',
    descKey: 'companiesSubtitle',
    icon: <Building2 />,
  },
  {
    href: '/admin/zgloszenia',
    labelKey: 'navReports',
    descKey: 'reportsSubtitle',
    icon: <Flag />,
  },
  {
    href: '/admin/uzytkownicy',
    labelKey: 'navUsers',
    descKey: 'usersSubtitle',
    icon: <Users />,
  },
  {
    href: '/admin/dziennik',
    labelKey: 'navAudit',
    descKey: 'auditSubtitle',
    icon: <History />,
  },
];

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'admin' });
  const statsResult = await getAdminStats();

  return (
    <div className="min-w-0">
      <header className="min-w-0">
        <p className={EYEBROW}>{t('navSummary')}</p>
        <h1 className={H1}>{t('title')}</h1>
        <p className={INTRO}>{t('subtitle')}</p>
      </header>

      {/* Statystyki (`.stats`) */}
      {statsResult.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}/admin`} />
      ) : (
        <div className={cn(STATS, 'grid-cols-4 max-[900px]:grid-cols-2')}>
          <div className={STAT}>
            <span className={STAT_LABEL}>{t('statCompanies')}</span>
            <strong className={STAT_VALUE}>{statsResult.stats.companies}</strong>
          </div>
          <Link
            href={{
              pathname: '/admin/firmy',
              query: { status: AWAITING_FILTER },
            }}
            className={cn(STAT, STAT_LINK_CLASS)}
          >
            <span className={STAT_LABEL}>{t('statPending')}</span>
            <strong className={STAT_VALUE}>{statsResult.stats.pendingCompanies}</strong>
          </Link>
          <div className={STAT}>
            <span className={STAT_LABEL}>{t('statUsers')}</span>
            <strong className={STAT_VALUE}>{statsResult.stats.users}</strong>
          </div>
          {/* #416: kafelek prowadzi do listy z filtrem „Otwarte” — ta sama liczba co na kafelku. */}
          <Link
            href={{ pathname: '/admin/zgloszenia', query: { status: 'open' } }}
            className={cn(STAT, STAT_LINK_CLASS)}
          >
            <span className={STAT_LABEL}>{t('statOpenReports')}</span>
            <strong className={STAT_VALUE}>{statsResult.stats.openReports}</strong>
          </Link>
        </div>
      )}

      {/* Szybkie przejścia (`.panel` z wierszami `.job`) */}
      <section aria-labelledby="admin-quick-links" className={PANEL}>
        <div className={SECTION_HEAD}>
          <h2 id="admin-quick-links" className={PANEL_H2}>
            {t('quickLinksTitle')}
          </h2>
        </div>
        <ul>
          {QUICK_LINKS.map((link) => (
            <li key={link.href} className={ROW}>
              <span className={ICON_BOX} aria-hidden="true">
                {link.icon}
              </span>
              <div className="min-w-0 flex-1">
                <Link href={link.href} className={cn(ROW_TITLE, 'group inline-flex min-h-6 items-center gap-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2')}>
                  {t(link.labelKey)}
                  <ArrowRight
                    className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Link>
                <p className={ROW_META}>{t(link.descKey)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
