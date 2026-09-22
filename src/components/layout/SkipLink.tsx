import { getTranslations } from 'next-intl/server';

/** Widoczny po fokusie skrót klawiaturowy do głównej treści strony. */
export async function SkipLink(): Promise<React.JSX.Element> {
  const t = await getTranslations('common');

  return (
    <a
      href="#main-content"
      className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
    >
      {t('skipToContent')}
    </a>
  );
}
