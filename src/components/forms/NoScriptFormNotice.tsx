import { AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Komunikat dla przeglądarki bez JavaScriptu (#1236, wzorzec #817): formularz wysyła dane tylko
 * przez akcję serwera po hydracji, więc przycisk zostaje zablokowany — użytkownik musi wiedzieć
 * dlaczego.
 */
export function NoScriptFormNotice(): React.JSX.Element {
  const t = useTranslations('common');
  return (
    <noscript>
      <p className="flex items-start gap-3 rounded-[11px] border border-error/30 bg-error/10 p-3 text-sm text-error-text">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        {t('formJsRequired')}
      </p>
    </noscript>
  );
}
