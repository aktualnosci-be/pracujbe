import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getNotificationPreferences } from '@/lib/data/notification-preferences';
import { NotificationPreferencesForm } from '@/components/settings/NotificationPreferencesForm';

/**
 * Panel pracodawcy — Ustawienia (preferencje powiadomień, Etap 6).
 *
 * Formularz przełączników preferencji (`notification_preferences`), dane pod sesją/RLS z
 * `@/lib/data/notification-preferences`; bez env — wartości domyślne. NOINDEX (panel) +
 * `force-dynamic` (dane zależne od sesji). Guard członkostwa dziedziczony z `employer/layout.tsx`.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'settings' });
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

export default async function EmployerSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'settings' });
  const preferences = await getNotificationPreferences();

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <section className="rounded-lg border border-border bg-card p-5 sm:p-6">
        <NotificationPreferencesForm defaultValues={preferences} />
      </section>
    </div>
  );
}
