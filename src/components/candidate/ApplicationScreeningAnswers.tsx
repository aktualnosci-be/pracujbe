'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { loadApplicationScreeningAnswers } from '@/lib/actions/candidate-applications';
import { localizedText, type ScreeningAnswer } from '@/lib/screening/questions';
import { BTN_SMALL, INFO_LABEL, INFO_VALUE, PANEL_P } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

type AnswersState =
  | { status: 'idle' }
  | { status: 'ready'; answers: ScreeningAnswer[] }
  | { status: 'error' };

/**
 * #101 — rozwijane „Moje odpowiedzi” na karcie zgłoszenia kandydata. Treść wczytywana przy
 * pierwszym rozwinięciu (snapshot pytań i opcji z chwili wysłania), pod sesją i RLS.
 * Wczytane odpowiedzi zostają po zwinięciu; błąd pokazuje komunikat i ponowienie.
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
  const [pending, startTransition] = useTransition();
  const regionId = useId();
  const inFlight = useRef(false);

  const load = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    startTransition(async () => {
      try {
        const result = await loadApplicationScreeningAnswers(applicationId);
        setState(result.status === 'ready' ? result : { status: 'error' });
      } catch {
        setState({ status: 'error' });
      } finally {
        inFlight.current = false;
      }
    });
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state.status !== 'ready') load();
  };

  const answerText = (answer: ScreeningAnswer): string => {
    if (answer.type === 'yes_no' && answer.answerBoolean !== null) {
      return answer.answerBoolean ? t('employerApplicationYes') : t('employerApplicationNo');
    }
    if (answer.type === 'date' && answer.answerDate) {
      const ts = Date.parse(`${answer.answerDate}T12:00:00Z`);
      if (!Number.isNaN(ts)) {
        return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(ts);
      }
    }
    if (answer.type === 'single_choice' && answer.answerText) {
      const option = answer.options.find((o) => o.id === answer.answerText);
      return option ? localizedText(option.label, locale) : answer.answerText;
    }
    if (answer.type === 'short_text' && answer.answerText) return answer.answerText;
    return t('employerApplicationScreeningNoAnswer');
  };

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
            aria-busy={pending}
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
            ) : state.status === 'error' && !pending ? (
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
