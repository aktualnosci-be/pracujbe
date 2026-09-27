'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { BTN_PRIMARY } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';
import { useRouter } from '@/i18n/navigation';
import { setActiveCompany } from '@/lib/actions/company';

/**
 * #843: przycisk pod danymi firmy, której NIE dotyczy aktywny kontekst (cookie
 * `pb_active_company`) — pozwala JAWNIE przełączyć aktywną firmę na tę, zamiast cichego
 * podstawienia innej firmy przy edycji/reakcji na decyzję. Sukces = `setActiveCompany`
 * (walidacja aktywnego członkostwa + zapis cookie po stronie serwera) i powrót na czysty
 * `/employer/firma`, który już czyta nową aktywną firmę.
 */
export function SwitchToCompanyButton({ companyId }: { companyId: string }): React.JSX.Element {
  const t = useTranslations('company');
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  async function onClick(): Promise<void> {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const result = await setActiveCompany(companyId);
      if (!result?.ok) {
        setFailed(true);
        return;
      }
      router.replace('/employer/firma');
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        className={cn(BTN_PRIMARY, 'h-auto whitespace-normal')}
        onClick={onClick}
        disabled={pending}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        <span>{t('targetSwitchAction')}</span>
      </Button>
      {failed ? (
        <p role="alert" className="text-sm text-error">
          {t('targetSwitchError')}
        </p>
      ) : null}
    </div>
  );
}
