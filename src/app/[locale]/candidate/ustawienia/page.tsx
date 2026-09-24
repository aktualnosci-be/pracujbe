import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { loadNotificationPreferences } from '@/lib/data/notification-preferences';
import { loadMyCompanyBlocks } from '@/lib/data/company-blocks';
import { loadProfileVisibility } from '@/lib/data/profile-visibility';
import { CompanyBlocksSettings } from '@/components/settings/CompanyBlocksSettings';
import { NotificationPreferencesForm } from '@/components/settings/NotificationPreferencesForm';
import { NotificationPreferencesLoadError } from '@/components/settings/NotificationPreferencesLoadError';
import { ProfileVisibilitySettings } from '@/components/settings/ProfileVisibilitySettings';

/**
 * Panel kandydata — Ustawienia (preferencje powiadomień, Etap 6; widoczność profilu, #494;
 * zablokowane firmy, #97).
 *
 * Formularz przełączników preferencji (`notification_preferences`), dane pod sesją/RLS z
 * `@/lib/data/notification-preferences`; bez env — wartości domyślne. Błąd odczytu → stan
 * błędu z ponowieniem zamiast formularza (#309 — zapis nie może nadpisać opt-outów). NOINDEX (panel) +
 * `force-dynamic` (dane zależne od sesji). Guard zalogowania dziedziczony z `candidate/layout.tsx`.
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

export default async function CandidateSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'settings' });
  const tBlocks = await getTranslations({ locale, namespace: 'companyBlocks' });
  const tVisibility = await getTranslations({ locale, namespace: 'profileVisibility' });
  const [load, blocks, visibility] = await Promise.all([
    loadNotificationPreferences(),
    loadMyCompanyBlocks(),
    loadProfileVisibility(),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <section className="rounded-lg border border-border bg-card p-5 sm:p-6">
        {load.status === 'ready' ? (
          <NotificationPreferencesForm defaultValues={load.preferences} />
        ) : (
          <NotificationPreferencesLoadError />
        )}
      </section>

      {visibility.status === 'ready' ? (
        <ProfileVisibilitySettings initial={visibility} />
      ) : (
        <section aria-labelledby="profile-visibility-title" className="rounded-lg border border-border bg-card p-5 sm:p-6">
          <h2 id="profile-visibility-title" className="text-lg font-semibold text-foreground">
            {tVisibility('sectionTitle')}
          </h2>
          <p role="alert" className="mt-2 text-sm text-error">
            {tVisibility('loadError')}
          </p>
        </section>
      )}

      {blocks.status === 'ready' ? (
        <CompanyBlocksSettings initialBlocks={blocks.blocks} />
      ) : (
        <section aria-labelledby="company-blocks-title" className="rounded-lg border border-border bg-card p-5 sm:p-6">
          <h2 id="company-blocks-title" className="text-lg font-semibold text-foreground">
            {tBlocks('sectionTitle')}
          </h2>
          <p role="alert" className="mt-2 text-sm text-error">
            {tBlocks('loadError')}
          </p>
        </section>
      )}
    </div>
  );
}
