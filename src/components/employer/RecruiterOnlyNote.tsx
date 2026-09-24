import { getTranslations } from 'next-intl/server';

/**
 * Wyjaśnienie zamiast akcji rekrutacyjnych dla roli `member` (#403): dodawanie/edycja ofert,
 * zgłoszenia i propozycje wymagają recruiter+ (0033/0037) — zamiast błędu po zapisie mówimy
 * od razu, dlaczego akcji nie ma. Serwerowy (tekst z i18n, Invariant #2).
 */
export async function RecruiterOnlyNote({ locale }: { locale: string }): Promise<React.JSX.Element> {
  const t = await getTranslations({ locale, namespace: 'team' });
  return (
    <div className="max-w-md rounded-2xl border border-border bg-soft p-4 text-sm">
      <p className="font-semibold text-foreground">{t('recruitOnlyTitle')}</p>
      <p className="mt-1 text-muted-foreground">{t('recruitOnlyDesc')}</p>
    </div>
  );
}
