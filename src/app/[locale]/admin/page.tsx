import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ArrowRight, Building2, Clock, Flag, Users } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { AWAITING_FILTER, getAdminStats } from '@/lib/data/admin';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { StatCard } from '@/components/ui/stat-card';

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

/** Kafelek-link statystyki: zaokrąglenie zgodne z kartą, widoczny fokus (#5). */
const STAT_LINK_CLASS =
  'block min-w-0 rounded-lg transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

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
    <div className="space-y-6">
      <header className="min-w-0 rounded-3xl border border-border bg-card p-5 sm:p-8">
        <p className="mb-2 break-words text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          {t('navSummary')}
        </p>
        <h1 className="break-words text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {/* Statystyki */}
      {statsResult.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}/admin`} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4">
          <StatCard
            label={t('statCompanies')}
            value={statsResult.stats.companies}
            icon={<Building2 />}
            tone="primary"
          />
          <Link
            href={{
              pathname: '/admin/firmy',
              query: { status: AWAITING_FILTER },
            }}
            className={STAT_LINK_CLASS}
          >
            <StatCard
              label={t('statPending')}
              value={statsResult.stats.pendingCompanies}
              icon={<Clock />}
              tone="warning"
            />
          </Link>
          <StatCard
            label={t('statUsers')}
            value={statsResult.stats.users}
            icon={<Users />}
            tone="accent"
          />
          {/* #416: kafelek prowadzi do listy z filtrem „Otwarte” — ta sama liczba co na kafelku. */}
          <Link
            href={{ pathname: '/admin/zgloszenia', query: { status: 'open' } }}
            className={STAT_LINK_CLASS}
          >
            <StatCard
              label={t('statOpenReports')}
              value={statsResult.stats.openReports}
              icon={<Flag />}
              tone="warning"
            />
          </Link>
        </div>
      )}

      {/* Szybkie przejścia */}
      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4">
        {QUICK_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group flex min-w-0 items-start gap-4 rounded-3xl border border-border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-6"
          >
            <span
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary-dark [&_svg]:size-5"
              aria-hidden="true"
            >
              {link.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1 break-words text-base font-bold text-foreground">
                {t(link.labelKey)}
                <ArrowRight
                  className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">{t(link.descKey)}</span>
            </span>
          </Link>
        ))}
      </section>
    </div>
  );
}
