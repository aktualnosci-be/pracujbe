import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { loadNotificationPreferences } from '@/lib/data/notification-preferences';
import { NotificationPreferencesForm } from '@/components/settings/NotificationPreferencesForm';
import { NotificationPreferencesLoadError } from '@/components/settings/NotificationPreferencesLoadError';
import { EYEBROW, H1_EXTENDED, INTRO, PAPER } from '@/components/dashboard/panel-styles';

/**
 * Panel pracodawcy — Ustawienia (preferencje powiadomień, Etap 6).
 *
 * Formularz przełączników preferencji (`notification_preferences`), dane pod sesją/RLS z
 * `@/lib/data/notification-preferences`; bez env — wartości domyślne. Błąd odczytu → stan
 * błędu z ponowieniem zamiast formularza (#309 — zapis nie może nadpisać opt-outów). NOINDEX (panel) +
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
  const tDash = await getTranslations({ locale, namespace: 'dashboard' });
  const load = await loadNotificationPreferences();

  return (
    <div className="min-w-0 max-w-3xl space-y-[22px]">
      <header className="min-w-0">
        <p className={EYEBROW}>{tDash('navSettings')}</p>
        <h1 className={H1_EXTENDED}>{t('title')}</h1>
        <p className={INTRO}>{t('subtitle')}</p>
      </header>

      <section className={PAPER}>
        {load.status === 'ready' ? (
          <NotificationPreferencesForm defaultValues={load.preferences} role="employer" />
        ) : (
          <NotificationPreferencesLoadError />
        )}
      </section>
    </div>
  );
}
