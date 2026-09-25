'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  BTN_PRIMARY,
  BTN_RESET,
  BTN_SECONDARY,
  FORM_ERROR,
  FORM_HINT,
  H3_EXTENDED,
  P_EXTENDED,
} from '@/components/dashboard/panel-styles';
import { suggestJobText } from '@/lib/actions/job-assist';
import {
  sameAssistValue,
  type AssistDropped,
  type AssistField,
  type AssistSuggestion,
  type AssistValue,
} from '@/lib/ai-assist/fields';
import { toUserMessageKey } from '@/lib/errors';
import { cn } from '@/lib/utils';

/**
 * Asystent redagowania treści oferty (#37) na kroku kreatora. Pracodawca prosi o propozycje
 * dla pól danego kroku; serwer zwraca je pole po polu. Pole w formularzu zmienia się
 * WYŁĄCZNIE po kliknięciu „Użyj propozycji” — nic nie jest zapisywane (zapis robi kreator
 * przyciskiem „Dalej”/„Zapisz zmiany”), nic nie jest publikowane.
 *
 * Informacja o korzystaniu z AI (#37, art. 50 ust. 1 AI Act — technicznie) jest widoczna
 * przed pierwszym użyciem i powiązana z przyciskiem (`aria-describedby`). Obok propozycji
 * zawsze widać tekst pracodawcy; po akceptacji można przywrócić własny tekst.
 *
 * Invariant #11: jedno żądanie naraz, przycisk zablokowany w trakcie, błąd `role="alert"`,
 * wynik z fokusem na nagłówku.
 */

type Decision = 'pending' | 'accepted' | 'rejected' | 'restored';

interface Row extends AssistSuggestion {
  decision: Decision;
}

export interface JobAssistPanelProps {
  fields: readonly AssistField[];
  /** Język treści oferty — propozycja w tym języku. */
  contentLocale: string;
  title: string;
  /** Bieżące wartości pól w formularzu. */
  values: Record<AssistField, AssistValue>;
  /** Etykiety pól (z kreatora). */
  labels: Record<AssistField, string>;
  onApply: (field: AssistField, value: AssistValue) => void;
}

const DROPPED_KEY: Record<AssistDropped['reason'], 'droppedNewFacts' | 'droppedSensitive' | 'droppedInvalid'> = {
  newFacts: 'droppedNewFacts',
  sensitive: 'droppedSensitive',
  invalid: 'droppedInvalid',
};

function ValueView({ value }: { value: AssistValue }): React.JSX.Element {
  if (typeof value === 'string') {
    return <p className="whitespace-pre-line break-words text-sm leading-[1.7] text-foreground">{value}</p>;
  }
  return (
    <ul className="list-disc space-y-1 break-words pl-5 text-sm leading-[1.6] text-foreground">
      {value.map((item, i) => (
        <li key={`${i}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

export function JobAssistPanel({
  fields,
  contentLocale,
  title,
  values,
  labels,
  onApply,
}: JobAssistPanelProps): React.JSX.Element {
  const t = useTranslations('jobAssist');
  const tRoot = useTranslations();
  const id = React.useId();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [dropped, setDropped] = React.useState<AssistDropped[]>([]);
  const [announcement, setAnnouncement] = React.useState('');
  // Licznik wyników — fokus na nagłówku tylko po nowej odpowiedzi, nie po każdej decyzji.
  const [resultKey, setResultKey] = React.useState(0);
  const inFlight = React.useRef(false);
  const resultRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    if (resultKey > 0) resultRef.current?.focus();
  }, [resultKey]);

  async function request(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setAnnouncement('');
    const payload: Partial<Record<AssistField, AssistValue>> = {};
    for (const field of fields) payload[field] = values[field];
    try {
      const res = await suggestJobText({ locale: contentLocale, title, fields: payload });
      if (res.ok) {
        setDropped(res.dropped);
        setRows(res.suggestions.map((s) => ({ ...s, decision: 'pending' })));
        setResultKey((k) => k + 1);
      } else {
        setRows(null);
        setDropped([]);
        setError(tRoot(toUserMessageKey(res.error)));
      }
    } catch {
      setError(t('errorNetwork'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function decide(row: Row, decision: Decision): void {
    const label = labels[row.field];
    if (decision === 'accepted') {
      onApply(row.field, row.suggested);
      setAnnouncement(t('accepted', { field: label }));
    } else if (decision === 'restored') {
      onApply(row.field, row.original);
      setAnnouncement(t('restored', { field: label }));
    } else {
      setAnnouncement(t('rejected', { field: label }));
    }
    setRows((prev) => prev?.map((r) => (r.field === row.field ? { ...r, decision } : r)) ?? null);
  }

  const noticeId = `${id}-notice`;

  return (
    <section aria-labelledby={`${id}-title`} className="col-span-2 min-w-0 rounded-[16px] border border-border px-[23px] py-5 max-[600px]:col-span-1 max-[600px]:p-[18px]">
      <h3 id={`${id}-title`} className="flex items-center gap-2 break-words text-lg font-bold text-foreground">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        {t('title')}
      </h3>
      <div id={noticeId} className="mt-2 space-y-1.5">
        <p className="text-sm font-semibold leading-[1.6] text-foreground">{t('aiNotice')}</p>
        <p className={FORM_HINT}>{t('scopeNote')}</p>
      </div>
      <div className="mt-4" aria-busy={busy}>
        <Button
          type="button"
          onClick={() => void request()}
          disabled={busy}
          aria-describedby={noticeId}
          className={`${BTN_SECONDARY} ${BTN_RESET}`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
          {busy ? t('suggesting') : t('suggest')}
        </Button>
        {busy ? (
          <p role="status" className={cn(FORM_HINT, 'mt-2')}>
            {t('busyHint')}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className={cn(FORM_ERROR, 'mt-2 flex items-start gap-2')}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}
      </div>

      {rows ? (
        <div className="mt-5 space-y-5">
          <h4 ref={resultRef} tabIndex={-1} className={cn(H3_EXTENDED, 'mt-0 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>
            {t('resultTitle')}
          </h4>
          {rows.length === 0 && dropped.length === 0 ? <p className={P_EXTENDED}>{t('noSuggestions')}</p> : null}
          {dropped.map((d) => (
            <p key={d.field} className={cn(FORM_HINT, 'flex items-start gap-2 text-warning-text')}>
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {t(DROPPED_KEY[d.reason], { field: labels[d.field] })}
            </p>
          ))}
          {rows.map((row) => {
            const label = labels[row.field];
            const current = values[row.field];
            const stale =
              row.decision === 'accepted' ? !sameAssistValue(current, row.suggested) : !sameAssistValue(current, row.original);
            const groupId = `${id}-${row.field}`;
            return (
              <div key={row.field} role="group" aria-labelledby={groupId} className="space-y-3 border-t border-border pt-4">
                <p id={groupId} className="text-[13px] font-semibold leading-[1.4] text-foreground">
                  {label}
                </p>
                <div className="grid min-w-0 gap-4 md:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <p className={FORM_HINT}>{t('yourText')}</p>
                    <ValueView value={row.original} />
                  </div>
                  <div className="min-w-0 space-y-1.5 rounded-[11px] border border-primary/40 p-3">
                    <p className={FORM_HINT}>{t('suggestion')}</p>
                    <ValueView value={row.suggested} />
                  </div>
                </div>
                {stale && row.decision !== 'rejected' && row.decision !== 'restored' ? (
                  <p className={FORM_HINT}>{t('stale')}</p>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  {row.decision === 'accepted' ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={stale}
                      aria-label={t('restoreField', { field: label })}
                      onClick={() => decide(row, 'restored')}
                      className={`${BTN_SECONDARY} ${BTN_RESET}`}
                    >
                      {t('restore')}
                    </Button>
                  ) : row.decision === 'pending' ? (
                    <>
                      <Button
                        type="button"
                        disabled={stale}
                        aria-label={t('acceptField', { field: label })}
                        onClick={() => decide(row, 'accepted')}
                        className={`${BTN_PRIMARY} ${BTN_RESET}`}
                      >
                        {t('accept')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        aria-label={t('rejectField', { field: label })}
                        onClick={() => decide(row, 'rejected')}
                        className={`${BTN_SECONDARY} ${BTN_RESET}`}
                      >
                        {t('reject')}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
