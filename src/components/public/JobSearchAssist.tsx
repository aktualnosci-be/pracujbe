'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';

import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  FIELD,
  FIELD_LABEL,
  FORM_ERROR,
  FORM_HINT,
  P_EXTENDED,
} from '@/components/dashboard/panel-styles';
import { useRouter } from '@/i18n/navigation';
import { localeNames, routing, type Locale } from '@/i18n/routing';
import { suggestJobSearchFilters } from '@/lib/actions/job-search-assist';
import {
  proposalHref,
  selectedProposalParams,
  type JobSearchProposal,
} from '@/lib/ai-search/proposal';
import { toUserMessageKey } from '@/lib/errors';
import { cn } from '@/lib/utils';

/** Limity pola = `SEARCH_ASSIST_LIMITS` (schemat serwera; serwer sprawdza ponownie). */
const TEXT_MIN = 3;
const TEXT_MAX = 500;

/**
 * Wyszukiwanie opisem (#711). Użytkownik opisuje, jakiej pracy szuka; serwer zwraca PROPOZYCJĘ
 * filtrów. Lista ofert zmienia się WYŁĄCZNIE po kliknięciu „Zastosuj filtry” — wcześniej każdy
 * filtr można odznaczyć, a nierozpoznaną miejscowość wybrać jako wyszukiwanie tekstowe (domyślnie
 * żadna). Nic nie jest zapisywane ani wysyłane do pracodawców.
 *
 * Informacja o AI jest widoczna przed pierwszym użyciem i powiązana z przyciskiem
 * (`aria-describedby`). Invariant #11: jedno żądanie naraz, przycisk zablokowany w trakcie, tekst
 * zostaje po błędzie, błąd `role="alert"`, wynik z fokusem na nagłówku.
 */
export interface JobSearchAssistProps {
  /** Język interfejsu (etykiety propozycji i domyślny język opisu). */
  locale: string;
}

export function JobSearchAssist({ locale }: JobSearchAssistProps): React.JSX.Element {
  const t = useTranslations('jobSearchAssist');
  const tRoot = useTranslations();
  const router = useRouter();
  const id = React.useId();
  const [text, setText] = React.useState('');
  const [inputLocale, setInputLocale] = React.useState(locale);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [proposal, setProposal] = React.useState<JobSearchProposal | null>(null);
  const [deselected, setDeselected] = React.useState<ReadonlySet<string>>(new Set());
  const [place, setPlace] = React.useState<string | null>(null);
  const [resultKey, setResultKey] = React.useState(0);
  const inFlight = React.useRef(false);
  const resultRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    if (resultKey > 0) resultRef.current?.focus();
  }, [resultKey]);

  const trimmed = text.trim();
  const textValid = trimmed.length >= TEXT_MIN && trimmed.length <= TEXT_MAX;

  async function request(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (inFlight.current || !textValid) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await suggestJobSearchFilters({ text: trimmed, inputLocale, locale });
      if (res.ok) {
        setProposal(res.proposal);
        setDeselected(new Set());
        setPlace(null);
        setResultKey((k) => k + 1);
      } else {
        setProposal(null);
        setError(tRoot(toUserMessageKey(res.error)));
      }
    } catch {
      setError(t('errorNetwork'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function toggle(itemId: string, checked: boolean): void {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  const selectedParams = proposal ? selectedProposalParams(proposal, deselected, place) : null;
  const nothingSelected = selectedParams !== null && Object.keys(selectedParams).length === 0;

  function apply(): void {
    if (!selectedParams || nothingSelected) return;
    router.push(proposalHref(selectedParams));
  }

  const noticeId = `${id}-notice`;
  const hintId = `${id}-hint`;

  return (
    <div className="mt-3 min-w-0">
      <div id={noticeId} className="mt-2 space-y-1.5">
        <p className="text-sm font-semibold leading-[1.6] text-foreground">{t('aiNotice')}</p>
        <p className={FORM_HINT}>{t('scopeNote')}</p>
      </div>

      <form method="post" onSubmit={(e) => void request(e)} className="mt-4 space-y-3" aria-busy={busy}>
        <div>
          <label htmlFor={`${id}-text`} className={FIELD_LABEL}>
            {t('textLabel')}
          </label>
          <textarea
            id={`${id}-text`}
            name="description"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={TEXT_MAX}
            rows={3}
            placeholder={t('textPlaceholder')}
            aria-describedby={hintId}
            className={cn(FIELD, 'resize-y')}
          />
          <p id={hintId} className={cn(FORM_HINT, 'mt-1')}>
            {t('textHint', { min: TEXT_MIN, max: TEXT_MAX })}
          </p>
        </div>
        <div className="max-w-[260px]">
          <label htmlFor={`${id}-lang`} className={FIELD_LABEL}>
            {t('inputLocaleLabel')}
          </label>
          <select
            id={`${id}-lang`}
            name="inputLocale"
            value={inputLocale}
            onChange={(e) => setInputLocale(e.target.value)}
            className={FIELD}
          >
            {routing.locales.map((code) => (
              <option key={code} value={code} lang={code}>
                {localeNames[code as Locale]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={busy || !textValid}
          aria-describedby={noticeId}
          className={BTN_SECONDARY}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
          {busy ? t('suggesting') : t('suggest')}
        </button>
        {error ? (
          <div role="alert" className="space-y-1">
            <p className={cn(FORM_ERROR, 'flex items-start gap-2')}>
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
            <p className={FORM_HINT}>{t('fallback')}</p>
          </div>
        ) : null}
      </form>

      {proposal ? (
        <div className="mt-5 space-y-4 border-t border-border pt-4">
          <h2
            ref={resultRef}
            tabIndex={-1}
            className="break-words text-base font-bold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('resultTitle')}
          </h2>
          <p className={P_EXTENDED}>{t('resultIntro')}</p>

          {proposal.items.length > 0 ? (
            <fieldset className="min-w-0">
              <legend className={FIELD_LABEL}>{t('filtersLegend')}</legend>
              <ul className="mt-2 flex flex-wrap gap-2">
                {proposal.items.map((item) => (
                  <li key={item.id}>
                    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border px-3 py-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={!deselected.has(item.id)}
                        onChange={(e) => toggle(item.id, e.target.checked)}
                        className="h-4 w-4 accent-[color:var(--primary)]"
                      />
                      <span className="break-words">{item.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}

          {proposal.places.length > 0 ? (
            <fieldset className="min-w-0">
              <legend className={FIELD_LABEL}>{t('placesLegend')}</legend>
              <div className="mt-2 space-y-1">
                <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    name={`${id}-place`}
                    checked={place === null}
                    onChange={() => setPlace(null)}
                    className="h-4 w-4"
                  />
                  {t('placeNone')}
                </label>
                {proposal.places.map((p) => (
                  <label key={p} className="flex min-h-11 items-center gap-2 break-words text-sm text-foreground">
                    <input
                      type="radio"
                      name={`${id}-place`}
                      checked={place === p}
                      onChange={() => setPlace(p)}
                      className="h-4 w-4"
                    />
                    {t('placeOption', { place: p })}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {proposal.uncertain.length > 0 ? (
            <div>
              <p className={FIELD_LABEL}>{t('uncertainTitle')}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground">
                {proposal.uncertain.map((fragment) => (
                  <li key={fragment} className="break-words">
                    {fragment}
                  </li>
                ))}
              </ul>
              <p className={cn(FORM_HINT, 'mt-1')}>{t('uncertainHint')}</p>
            </div>
          ) : null}

          {proposal.droppedCount > 0 ? (
            <p className={FORM_HINT}>{t('droppedNote', { count: proposal.droppedCount })}</p>
          ) : null}

          {nothingSelected ? (
            <p role="status" className={FORM_HINT}>
              {t('nothingSelected')}
            </p>
          ) : null}
          <button type="button" onClick={apply} disabled={nothingSelected} className={BTN_PRIMARY}>
            {t('apply')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
