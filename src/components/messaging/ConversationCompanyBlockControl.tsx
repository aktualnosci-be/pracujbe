'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { setCompanyBlockAction } from '@/lib/actions/company-blocks';

export interface ConversationCompanyBlockControlProps {
  companyId: string;
  companyName: string;
  initialBlocked: boolean;
}

/**
 * ConversationCompanyBlockControl — blokada/odblokowanie firmy z istniejącego wątku (#832).
 *
 * Do #832 kandydat mógł zablokować firmę wyłącznie ze szczegółu jej AKTYWNEJ publicznej oferty
 * (`JobCompanyBlockControl`) — gdy firma zamknęła ostatnie ogłoszenie, ta ścieżka znikała, choć
 * istniejąca rozmowa (i prawo firmy do wysyłania wiadomości) zostawały. Ta kontrolka daje drugą
 * ścieżkę wprost z wątku: stan początkowy przychodzi z serwera razem z wątkiem
 * (`ConversationThread.companyBlock`, odczyt pod RLS z `candidate_company_blocks` — bez osobnego
 * wywołania po montażu, bo `/…/wiadomosci` jest już `force-dynamic` per sesja). Zapis przez ten
 * sam `setCompanyBlockAction` co ustawienia i szczegół oferty (#97): RPC `set_company_block`
 * przyjmuje dowolną nieusuniętą firmę, bez wymogu jej aktywnej publicznej oferty.
 *
 * Renderowana tylko dla strony kandydackiej rozmowy (serwer zwraca `companyBlock: null` dla
 * widza po stronie firmy) — pracodawca nigdy jej nie widzi.
 */
export function ConversationCompanyBlockControl({
  companyId,
  companyName,
  initialBlocked,
}: ConversationCompanyBlockControlProps): React.JSX.Element {
  const t = useTranslations('companyBlocks');
  const [blocked, setBlocked] = React.useState(initialBlocked);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [changed, setChanged] = React.useState(false);

  const toggle = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError(false);
    setChanged(false);
    try {
      const result = await setCompanyBlockAction(companyId, !blocked);
      if (!result.ok) {
        setError(true);
        return;
      }
      setBlocked(result.blocked);
      setChanged(true);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };

  const statusText = blocked
    ? t('blockedSuccess', { company: companyName })
    : t('unblockedSuccess', { company: companyName });

  return (
    <div data-testid="conversation-company-block" className="border-t border-border pt-3">
      <h3 className="sr-only">{t('conversationTitle')}</h3>
      <p className="text-xs leading-[1.6] text-muted-foreground">
        {blocked
          ? t('conversationBlockedDescription', { company: companyName })
          : t('conversationDescription', { company: companyName })}
      </p>
      <div aria-live="polite">
        {error ? (
          <p role="alert" className="mt-2 flex items-start gap-2 text-xs text-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('saveError')}
          </p>
        ) : null}
        {changed ? (
          <p role="status" className="mt-2 text-xs text-success-text">
            {statusText}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        aria-busy={pending || undefined}
        disabled={pending}
        onClick={() => void toggle()}
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {pending ? (blocked ? t('unblocking') : t('blocking')) : blocked ? t('unblock') : t('block')}
      </Button>
    </div>
  );
}
