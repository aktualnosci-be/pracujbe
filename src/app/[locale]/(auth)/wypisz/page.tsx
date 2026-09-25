import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { UnsubscribePageContent, type UnsubscribePageLabels } from '@/components/email/UnsubscribePageContent';
import { EMAIL_PREFERENCE_CATEGORIES } from '@/lib/email/categories';

/** Strona nie otrzymuje tokenu w HTML. Nowe linki niosą go we fragmencie URL. */
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'emailUnsubscribe' });
  return {
    title: t('metaTitle'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function UnsubscribePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'emailUnsubscribe' });
  const category = Object.fromEntries(EMAIL_PREFERENCE_CATEGORIES.map((key) => {
    const name = t(`category.${key}`);
    return [key, { confirmText: t('confirmText', { category: name }), doneText: t('doneText', { category: name }) }];
  })) as UnsubscribePageLabels['category'];
  const labels: UnsubscribePageLabels = {
    title: t('title'),
    invalidTitle: t('invalidTitle'),
    expiredTitle: t('expiredTitle'),
    pending: t('pending'),
    invalidText: t('invalidText'),
    expiredText: t('expiredText'),
    unavailableText: t('unavailableText'),
    settingsHint: t('settingsHint'),
    loginLink: t('loginLink'),
    confirmButton: t('confirmButton'),
    allButton: t('allButton'),
    allDoneText: t('allDoneText'),
    doneTitle: t('doneTitle'),
    errorText: t('errorText'),
    category,
  };
  return (
    <UnsubscribePageContent locale={locale} labels={labels} />
  );
}
