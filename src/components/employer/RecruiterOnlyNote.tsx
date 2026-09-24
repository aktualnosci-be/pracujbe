import { getTranslations } from 'next-intl/server';

import { NOTICE, NOTICE_TEXT, NOTICE_TITLE } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * Wyjaśnienie zamiast akcji rekrutacyjnych dla roli `member` (#403): dodawanie/edycja ofert,
 * zgłoszenia i propozycje wymagają recruiter+ (0033/0037) — zamiast błędu po zapisie mówimy
 * od razu, dlaczego akcji nie ma. Serwerowy (tekst z i18n, Invariant #2).
 */
export async function RecruiterOnlyNote({ locale }: { locale: string }): Promise<React.JSX.Element> {
  const t = await getTranslations({ locale, namespace: 'team' });
  return (
    <div className={cn(NOTICE, 'my-0 max-w-md')}>
      <div className="min-w-0">
        <p className={NOTICE_TITLE}>{t('recruitOnlyTitle')}</p>
        <p className={cn(NOTICE_TEXT, 'mb-0')}>{t('recruitOnlyDesc')}</p>
      </div>
    </div>
  );
}
