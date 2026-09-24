'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { checkCompanyVies, type ViesActionOutcome } from '@/lib/actions/admin';
import { createAppDateFormatter } from '@/lib/datetime';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { formatBelgianVat } from '@/lib/vies/belgian-vat';
import type { AdminViesState } from '@/lib/vies/state';
import { ADMIN_ACTION_TONE_CLASS, ADMIN_BUTTON_BASE } from '@/components/admin/AdminConfirmDialog';

/**
 * CompanyViesCheck — weryfikacja numeru VAT firmy w VIES w szczególe firmy (#92).
 *
 * Informacja pomocnicza dla decyzji admina: wynik NIE zmienia statusu firmy. Pokazuje
 * ostatni zapisany wynik rozstrzygający (ważny z datą i nazwą z rejestru / nieważny) albo
 * stan numeru (brak, błędny zapis, spoza Belgii, zmieniony od sprawdzenia). „Sprawdź w VIES”
 * odpytuje usługę na żądanie (ręczne ponowienie). Niedostępność i limit VIES mają osobne,
 * neutralne komunikaty („to nie znaczy, że numer jest nieważny”) i nie zastępują
 * wcześniejszego wyniku. Rozbieżna nazwa = sygnał do ręcznego sprawdzenia.
 *
 * Wynik ręcznego sprawdzenia ogłaszany w regionie `role="status"`; przycisk zablokowany
 * na czas zapytania (`aria-busy`), bez podwójnego wysłania.
 */

type Notice =
  | { kind: 'demo' }
  | { kind: 'rate_limited' }
  | { kind: 'unavailable' }
  | { kind: 'not_saved' }
  | { kind: 'error'; code: ErrorCode };

function fromOutcome(outcome: ViesActionOutcome): AdminViesState | null {
  switch (outcome.status) {
    case 'valid':
      return {
        kind: 'valid',
        vatNumber: outcome.vatNumber,
        checkedAt: outcome.checkedAt,
        viesName: outcome.name,
        nameMatch: outcome.nameMatch,
      };
    case 'invalid':
      return { kind: 'invalid', vatNumber: outcome.vatNumber, checkedAt: outcome.checkedAt };
    case 'format_invalid':
      return outcome.reason === 'empty'
        ? { kind: 'no_vat' }
        : { kind: 'format_invalid', reason: outcome.reason };
    default:
      return null;
  }
}

const FORMAT_KEY: Record<string, string> = {
  not_belgian: 'viesNotBelgian',
  length: 'viesFormatInvalid',
  checksum: 'viesFormatChecksum',
};

export interface CompanyViesCheckProps {
  companyId: string;
  initial: AdminViesState;
}

export function CompanyViesCheck({ companyId, initial }: CompanyViesCheckProps): React.JSX.Element {
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const formatDate = React.useMemo(
    () => createAppDateFormatter(locale, { withTime: true }),
    [locale],
  );

  const [pending, startTransition] = React.useTransition();
  const [fresh, setFresh] = React.useState<AdminViesState | null>(null);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const busy = React.useRef(false);

  const shown: AdminViesState = fresh ?? initial;
  const canCheck = shown.kind !== 'no_vat' && shown.kind !== 'format_invalid';
  const checkedBefore = shown.kind === 'valid' || shown.kind === 'invalid';

  function runCheck() {
    if (busy.current) return;
    busy.current = true;
    setNotice(null);
    startTransition(async () => {
      try {
        const res = await checkCompanyVies(companyId);
        if (!res.ok) {
          setNotice({ kind: 'error', code: res.error });
          return;
        }
        if (res.demo) {
          setNotice({ kind: 'demo' });
          return;
        }
        const next = fromOutcome(res.outcome);
        if (next) setFresh(next);
        if (res.outcome.status === 'rate_limited') setNotice({ kind: 'rate_limited' });
        else if (res.outcome.status === 'unavailable') setNotice({ kind: 'unavailable' });
        else if (
          (res.outcome.status === 'valid' || res.outcome.status === 'invalid') &&
          !res.saved
        ) {
          setNotice({ kind: 'not_saved' });
        }
        if (res.saved) router.refresh();
      } catch {
        setNotice({ kind: 'error', code: 'INTERNAL' });
      } finally {
        busy.current = false;
      }
    });
  }

  let noticeText: string | null = null;
  if (notice?.kind === 'demo') noticeText = t('viesDemo');
  else if (notice?.kind === 'rate_limited') noticeText = t('viesRateLimitedHint');
  else if (notice?.kind === 'unavailable') noticeText = t('viesUnavailableHint');
  else if (notice?.kind === 'not_saved') noticeText = t('viesNotSaved');
  else if (notice?.kind === 'error') noticeText = tRoot(toUserMessageKey(notice.code));

  return (
    <section
      aria-labelledby="company-vies-heading"
      className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5"
    >
      <div className="space-y-1">
        <h2 id="company-vies-heading" className="text-base font-semibold text-foreground">
          {t('viesHeading')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('viesIntro')}</p>
      </div>

      <div className="space-y-2 text-sm" data-testid="vies-state" data-vies-state={shown.kind}>
        {shown.kind === 'valid' ? (
          <>
            <p>
              <span className="inline-flex items-center rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 font-medium text-success-text">
                {t('viesStateValid')}
              </span>
            </p>
            <p className="text-foreground">{t('viesCheckedAt', { date: formatDate(shown.checkedAt) })}</p>
            <p className="text-muted-foreground">
              {t('viesNumberLabel')}: {formatBelgianVat(shown.vatNumber)}
            </p>
            <p className="break-words text-foreground">
              {t('viesOfficialName')}: {shown.viesName ?? t('viesNameUnknown')}
            </p>
            {shown.nameMatch === 'mismatch' ? (
              <p className="rounded-md bg-soft p-3 text-foreground">{t('viesNameMismatch')}</p>
            ) : shown.nameMatch === 'match' ? (
              <p className="text-muted-foreground">{t('viesNameMatch')}</p>
            ) : null}
          </>
        ) : shown.kind === 'invalid' ? (
          <>
            <p>
              <span className="inline-flex items-center rounded-full border border-error/40 bg-error/10 px-2.5 py-0.5 font-medium text-error-text">
                {t('viesStateInvalid')}
              </span>
            </p>
            <p className="text-foreground">{t('viesCheckedAt', { date: formatDate(shown.checkedAt) })}</p>
            <p className="text-muted-foreground">
              {t('viesNumberLabel')}: {formatBelgianVat(shown.vatNumber)}
            </p>
            <p className="text-foreground">{t('viesInvalidHint')}</p>
          </>
        ) : shown.kind === 'stale' ? (
          <p className="text-foreground">{t('viesStale')}</p>
        ) : shown.kind === 'not_checked' ? (
          <p className="text-foreground">{t('viesNotChecked')}</p>
        ) : shown.kind === 'load_error' ? (
          <p className="text-foreground">{t('viesLoadError')}</p>
        ) : shown.kind === 'no_vat' ? (
          <p className="text-foreground">{t('viesNoVat')}</p>
        ) : (
          <p className="text-foreground">{t(FORMAT_KEY[shown.reason] ?? 'viesFormatInvalid')}</p>
        )}
      </div>

      <div role="status" aria-live="polite" className="text-sm">
        {noticeText ? (
          <p
            className={cn(
              'rounded-md p-3',
              notice?.kind === 'error' || notice?.kind === 'not_saved'
                ? 'bg-error/10 text-error-text'
                : 'bg-soft text-foreground',
            )}
          >
            {noticeText}
          </p>
        ) : null}
      </div>

      {canCheck ? (
        <button
          type="button"
          onClick={runCheck}
          disabled={pending}
          aria-busy={pending || undefined}
          className={cn(ADMIN_BUTTON_BASE, 'border', ADMIN_ACTION_TONE_CLASS.neutral)}
        >
          {pending ? t('viesChecking') : checkedBefore ? t('viesRecheckAction') : t('viesCheckAction')}
        </button>
      ) : null}
    </section>
  );
}
