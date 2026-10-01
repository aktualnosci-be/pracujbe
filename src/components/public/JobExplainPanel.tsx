'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';

import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  FORM_CONTROL,
  FORM_HINT,
  FORM_LABEL_TEXT,
  H2_EXTENDED,
  H3_EXTENDED,
  P_EXTENDED,
  PAPER,
} from '@/components/dashboard/panel-styles';
import { routing, type Locale } from '@/i18n/routing';
import { explainJobOffer, type ExplainSourceView, type JobExplainResult } from '@/lib/actions/job-explain';
import { toUserMessageKey } from '@/lib/errors';
import { cn } from '@/lib/utils';

/**
 * „Wyjaśnij ofertę” (#773) — wyspa kliencka na szczególe aktywnej oferty. Odwiedzający
 * DOBROWOLNIE prosi o objaśnienie warunków prostym językiem w wybranym języku. Treść oferty na
 * stronie zostaje bez zmian; wynik to osobna sekcja z objaśnieniami, źródłem każdego z nich
 * (fragment oferty w oryginale) i listą brakujących/sprzecznych/niejasnych informacji.
 *
 * Informacja o AI i zastrzeżenie (bez porady prawnej) są widoczne przed pierwszym użyciem
 * i powiązane z przyciskiem (`aria-describedby`). Jedno żądanie naraz, przycisk zablokowany
 * w trakcie, stan ładowania w regionie `role="status"`, błąd `role="alert"` z ponowieniem,
 * po wyniku fokus na jego nagłówku.
 */

export interface JobExplainPanelProps {
  slug: string;
  /** Język strony (domyślny język odpowiedzi). */
  locale: Locale;
}

type Ok = Extract<JobExplainResult, { ok: true }>;

function SourceList({ sources, label }: { sources: readonly ExplainSourceView[]; label: string }): React.JSX.Element | null {
  const t = useTranslations('jobExplain');
  if (sources.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <ul className="mt-1 space-y-1">
        {sources.map((s) => (
          <li key={s.id} className="break-words border-l-2 border-[color:var(--pp-line)] pl-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t(`fields.${s.field}`)}: </span>
            <q lang={s.lang}>{s.text}</q>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function JobExplainPanel({ slug, locale }: JobExplainPanelProps): React.JSX.Element {
  const t = useTranslations('jobExplain');
  const tRoot = useTranslations();
  const id = React.useId();
  const [target, setTarget] = React.useState<Locale>(locale);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Ok | null>(null);
  const [resultKey, setResultKey] = React.useState(0);
  const inFlight = React.useRef(false);
  const resultRef = React.useRef<HTMLHeadingElement>(null);
  const errorRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (resultKey > 0) resultRef.current?.focus();
  }, [resultKey]);

  async function request(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await explainJobOffer({ slug, locale, targetLocale: target });
      if (res.ok) {
        setResult(res);
        setResultKey((k) => k + 1);
      } else {
        setResult(null);
        setError(tRoot(toUserMessageKey(res.error)));
      }
    } catch {
      setResult(null);
      setError(t('errorNetwork'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  React.useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const empty = result !== null && result.items.length === 0 && result.gaps.length === 0;

  return (
    <section aria-labelledby={`${id}-title`} className={cn(PAPER, 'mt-[25px]')} data-testid="job-explain">
      <h2 id={`${id}-title`} className={cn(H2_EXTENDED, 'flex items-center gap-2')}>
        <Sparkles className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
        {t('title')}
      </h2>
      <p id={`${id}-intro`} className={cn(P_EXTENDED, 'mt-2')}>
        {t('intro')}
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-col gap-[9px]">
          <span className={FORM_LABEL_TEXT}>{t('languageLabel')}</span>
          <select
            className={cn(FORM_CONTROL, 'min-h-[49px] w-auto')}
            value={target}
            disabled={busy}
            onChange={(e) => setTarget(e.target.value as Locale)}
          >
            {routing.locales.map((l) => (
              <option key={l} value={l} lang={l}>
                {t(`languages.${l}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={BTN_PRIMARY}
          onClick={() => void request()}
          disabled={busy}
          aria-busy={busy}
          aria-describedby={`${id}-intro`}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {busy ? t('loading') : result ? t('again') : t('button')}
        </button>
      </div>

      <p role="status" className={cn(FORM_HINT, 'mt-2')}>
        {busy ? t('loading') : ''}
      </p>

      {error ? (
        <div ref={errorRef} tabIndex={-1} role="alert" className="mt-3 flex flex-wrap items-start gap-3 text-sm text-error-text">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button type="button" className={BTN_SECONDARY} onClick={() => void request()} disabled={busy}>
            {t('retry')}
          </button>
        </div>
      ) : null}

      {result ? (
        <div className="mt-4" data-testid="job-explain-result">
          <h3 ref={resultRef} tabIndex={-1} className={cn(H3_EXTENDED, 'mt-0')}>
            {t('resultTitle', { language: t(`languages.${result.targetLocale}`) })}
          </h3>
          {result.demo ? <p className={cn(FORM_HINT, 'mt-1')}>{t('demoNote')}</p> : null}
          {empty ? <p className={cn(P_EXTENDED, 'mt-2')}>{t('empty')}</p> : null}

          {result.items.length > 0 ? (
            <ul className="mt-3 space-y-4" aria-label={t('itemsLabel')}>
              {result.items.map((item, i) => (
                <li key={`${i}-${item.topic}`} className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{t(`topics.${item.topic}`)}</p>
                  <p lang={result.targetLocale} className="mt-1 break-words text-[15px] leading-[1.7] text-foreground">
                    {item.explanation}
                  </p>
                  <SourceList sources={item.sources} label={t('sourceLabel')} />
                </li>
              ))}
            </ul>
          ) : null}

          {result.gaps.length > 0 ? (
            <>
              <h3 className={H3_EXTENDED}>{t('gapsTitle')}</h3>
              <ul className="mt-2 space-y-3">
                {result.gaps.map((gap, i) => (
                  <li key={`${i}-${gap.topic}`} className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {t(`gapKinds.${gap.kind}`)} · {t(`topics.${gap.topic}`)}
                    </p>
                    <p lang={result.targetLocale} className="mt-1 break-words text-sm leading-[1.7] text-foreground">
                      {gap.note}
                    </p>
                    <SourceList sources={gap.sources} label={t('sourceLabel')} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {result.dropped > 0 ? (
            <p className={cn(FORM_HINT, 'mt-3')}>{t('dropped', { count: result.dropped })}</p>
          ) : null}
          <p className={cn(FORM_HINT, 'mt-3')}>{t('disclaimer')}</p>
        </div>
      ) : null}
    </section>
  );
}
