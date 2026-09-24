import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { loadNotificationPreferences } from '@/lib/data/notification-preferences';
import { loadMyCompanyBlocks } from '@/lib/data/company-blocks';
import { loadProfileVisibility } from '@/lib/data/profile-visibility';
import { loadMyAgeAttestation } from '@/lib/data/age-policy';
import { AgeAttestationSettings } from '@/components/settings/AgeAttestationSettings';
import { AccountDataSettings } from '@/components/settings/AccountDataSettings';
import { CompanyBlocksSettings } from '@/components/settings/CompanyBlocksSettings';
import { NotificationPreferencesForm } from '@/components/settings/NotificationPreferencesForm';
import { NotificationPreferencesLoadError } from '@/components/settings/NotificationPreferencesLoadError';
import { ProfileVisibilitySettings } from '@/components/settings/ProfileVisibilitySettings';
import { CandidatePageHeader } from '@/components/candidate/CandidatePageHeader';
import { H2_EXTENDED, PAPER } from '@/components/dashboard/panel-styles';

/**
 * Panel kandydata — Ustawienia (preferencje powiadomień, Etap 6; wiek, #492; widoczność
 * profilu, #494; zablokowane firmy, #97; pobranie danych i usunięcie konta, #486).
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
  const tDash = await getTranslations({ locale, namespace: 'dashboard' });
  const tVisibility = await getTranslations({ locale, namespace: 'profileVisibility' });
  const tAge = await getTranslations({ locale, namespace: 'ageAttestation' });
  const [load, blocks, visibility, age] = await Promise.all([
    loadNotificationPreferences(),
    loadMyCompanyBlocks(),
    loadProfileVisibility(),
    loadMyAgeAttestation(),
  ]);

  return (
    <div className="min-w-0 max-w-3xl">
      <CandidatePageHeader eyebrow={tDash('candidatePlaceEyebrow')} title={t('title')} intro={t('subtitle')} />

      <section className={PAPER}>
        {load.status === 'ready' ? (
          <NotificationPreferencesForm defaultValues={load.preferences} />
        ) : (
          <NotificationPreferencesLoadError />
        )}
      </section>

      {age.status === 'ready' ? (
        <AgeAttestationSettings initial={age} />
      ) : (
        <section aria-labelledby="age-attestation-title" className={PAPER}>
          <h2 id="age-attestation-title" className={H2_EXTENDED}>
            {tAge('sectionTitle')}
          </h2>
          <p role="alert" className="mt-2 text-sm text-error">
            {tAge('loadError')}
          </p>
        </section>
      )}

      {visibility.status === 'ready' ? (
        <ProfileVisibilitySettings initial={visibility} />
      ) : (
        <section aria-labelledby="profile-visibility-title" className={PAPER}>
          <h2 id="profile-visibility-title" className={H2_EXTENDED}>
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
        <section aria-labelledby="company-blocks-title" className={PAPER}>
          <h2 id="company-blocks-title" className={H2_EXTENDED}>
            {tBlocks('sectionTitle')}
          </h2>
          <p role="alert" className="mt-2 text-sm text-error">
            {tBlocks('loadError')}
          </p>
        </section>
      )}

      <AccountDataSettings />
    </div>
  );
}
