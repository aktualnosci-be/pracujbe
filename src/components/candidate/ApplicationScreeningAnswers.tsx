'use client';

import { useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { loadApplicationScreeningAnswers } from '@/lib/actions/candidate-applications';
import { localizedText, type ScreeningAnswer } from '@/lib/screening/questions';
import { screeningAnswerText } from '@/lib/screening/answer-text';
import { BTN_SMALL, INFO_LABEL, INFO_VALUE, PANEL_P } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

type AnswersState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; answers: ScreeningAnswer[] }
  | { status: 'error' };

/**
 * #101 — rozwijane „Moje odpowiedzi” na karcie zgłoszenia kandydata. Treść wczytywana przy
 * pierwszym rozwinięciu (snapshot pytań i opcji z chwili wysłania), pod sesją i RLS.
 * Wczytane odpowiedzi zostają po zwinięciu; błąd pokazuje komunikat i ponowienie.
 *
 * Stan ładowania jest częścią `state` (nie `useTransition`): odpowiedzi i koniec ładowania
 * (`aria-busy="false"`) trafiają do DOM w tym samym renderze. Z async `startTransition`
 * `setState` po `await` renderował odpowiedzi, zanim React zatwierdził `pending = false`,
 * więc przez chwilę lista była widoczna z `aria-busy="true"` (niestabilny test).
 */
export function ApplicationScreeningAnswers({
  applicationId,
  count,
  locale,
}: {
  applicationId: string;
  count: number;
  locale: string;
}) {
  const t = useTranslations('dashboard');
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AnswersState>({ status: 'idle' });
  const regionId = useId();
  const inFlight = useRef(false);

  const load = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ status: 'loading' });
    void (async () => {
      let next: AnswersState;
      try {
        const result = await loadApplicationScreeningAnswers(applicationId);
        next = result.status === 'ready' ? result : { status: 'error' };
      } catch {
        next = { status: 'error' };
      }
      inFlight.current = false;
      setState(next);
    })();
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state.status !== 'ready') load();
  };

  const answerText = (answer: ScreeningAnswer): string =>
    screeningAnswerText(answer, locale, {
      yes: t('employerApplicationYes'),
      no: t('employerApplicationNo'),
      noAnswer: t('employerApplicationScreeningNoAnswer'),
    });

  return (
    <div className="mb-5 min-w-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={regionId}
        className={cn(BTN_SMALL, 'border-[color:var(--pp-line)] text-foreground hover:bg-soft')}
      >
        {t('applicationAnswersToggle', { count })}
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      <div id={regionId} hidden={!open} className="min-w-0">
        {open ? (
          <section
            aria-label={t('applicationAnswersHeading')}
            aria-busy={state.status === 'loading'}
            className="mt-4 min-w-0 border-t border-[color:var(--pp-line-soft)] pt-4"
          >
            <p className={PANEL_P}>{t('applicationAnswersHint')}</p>
            {state.status === 'ready' ? (
              state.answers.length > 0 ? (
                <dl className="mt-4 grid min-w-0 gap-5">
                  {state.answers.map((answer) => (
                    <div key={answer.position} className="min-w-0">
                      <dt className={INFO_LABEL}>
                        {localizedText(answer.prompt, locale)}
                        {answer.required ? ` (${t('employerApplicationScreeningRequired')})` : ''}
                      </dt>
                      <dd className={cn(INFO_VALUE, 'whitespace-pre-line')}>{answerText(answer)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className={cn(PANEL_P, 'mt-3')}>{t('applicationAnswersEmpty')}</p>
              )
            ) : state.status === 'error' ? (
              <div className="mt-3 min-w-0">
                <p role="alert" className="text-[15px] text-error">{t('applicationAnswersError')}</p>
                <button type="button" onClick={load} className={cn(BTN_SMALL, 'mt-3 border-[color:var(--pp-line)] text-foreground hover:bg-soft')}>
                  {t('candidateListRetry')}
                </button>
              </div>
            ) : (
              <p role="status" className={cn(PANEL_P, 'mt-3')}>{t('applicationAnswersLoading')}</p>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
