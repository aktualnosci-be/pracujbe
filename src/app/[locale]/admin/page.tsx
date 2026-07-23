import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ArrowRight, Building2, Clock, Flag, Users } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { getAdminStats } from '@/lib/data/admin';
import { StatCard } from '@/components/ui/stat-card';

/**
 * Panel administratora — Podsumowanie (Etap 7g).
 *
 * Kafelki statystyk (firmy / oczekujące na weryfikację / użytkownicy / otwarte zgłoszenia)
 * czytane service-rolem po potwierdzeniu roli admina w layoucie (guard). Skróty do
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

interface QuickLink {
  href: string;
  labelKey: string;
  descKey: string;
  icon: ReactNode;
}

const QUICK_LINKS: QuickLink[] = [
  { href: '/admin/firmy', labelKey: 'navCompanies', descKey: 'companiesSubtitle', icon: <Building2 /> },
  { href: '/admin/zgloszenia', labelKey: 'navReports', descKey: 'reportsSubtitle', icon: <Flag /> },
  { href: '/admin/uzytkownicy', labelKey: 'navUsers', descKey: 'usersSubtitle', icon: <Users /> },
];

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'admin' });
  const stats = await getAdminStats();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {/* Statystyki */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('statCompanies')} value={stats.companies} icon={<Building2 />} tone="primary" />
        <StatCard
          label={t('statPending')}
          value={stats.pendingCompanies}
          icon={<Clock />}
          tone="warning"
        />
        <StatCard label={t('statUsers')} value={stats.users} icon={<Users />} tone="accent" />
        <StatCard
          label={t('statOpenReports')}
          value={stats.openReports}
          icon={<Flag />}
          tone="error"
        />
      </div>

      {/* Szybkie przejścia */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {QUICK_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group flex items-start gap-3 rounded-lg border border-border bg-card p-5 transition-colors hover:border-accent/40 hover:bg-soft"
          >
            <span
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:size-5"
              aria-hidden="true"
            >
              {link.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
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
