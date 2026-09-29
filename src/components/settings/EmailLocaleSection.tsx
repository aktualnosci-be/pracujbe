import { getTranslations } from 'next-intl/server';

import { EmailLocaleSettings } from '@/components/settings/EmailLocaleSettings';
import { H2_EXTENDED, PAPER } from '@/components/dashboard/panel-styles';
import { routing, type Locale } from '@/i18n/routing';
import { loadEmailLocale } from '@/lib/data/email-locale';

/**
 * Sekcja „Język e-maili i powiadomień” (#1049) — komponent serwerowy: odczyt języka pod sesją
 * i formularz albo, przy błędzie odczytu, komunikat (bez formularza, żeby nie udawać stanu).
 */
export async function EmailLocaleSection({ locale }: { locale: string }): Promise<React.JSX.Element> {
  const t = await getTranslations({ locale, namespace: 'settings' });
  const pageLocale: Locale = (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;
  const load = await loadEmailLocale(pageLocale);

  if (load.status === 'ready') return <EmailLocaleSettings initial={load.locale} />;
  return (
    <section aria-labelledby="email-locale-title" className={PAPER}>
      <h2 id="email-locale-title" className={H2_EXTENDED}>
        {t('emailLocaleTitle')}
      </h2>
      <p role="alert" className="mt-2 text-sm text-error-text">
        {t('emailLocaleLoadError')}
      </p>
    </section>
  );
}
