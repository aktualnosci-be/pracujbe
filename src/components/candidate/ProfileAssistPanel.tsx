'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { approvedPayload, ProposalChecklist } from '@/components/candidate/ProposalChecklist';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  FORM_ERROR,
  FORM_FIELD,
  FORM_HINT,
  FORM_INPUT,
  FORM_LABEL_TEXT,
  H2_EXTENDED,
  P_EXTENDED,
  PAPER,
} from '@/components/dashboard/panel-styles';
import {
  applyProfileAssistProposals,
  proposeProfileFromAnswers,
  type ApplyCvProposalsResult,
} from '@/lib/actions/profile-assist';
import type { CvRedactionCounts } from '@/lib/cv-import/minimize';
import type { CvProposal, LanguageLevel } from '@/lib/cv-import/types';
import { toUserMessageKey } from '@/lib/errors';
import {
  PROFILE_ANSWER_MAX,
  PROFILE_QUESTION_IDS,
  type ProfileAnswers,
  type ProfileQuestionId,
} from '@/lib/profile-assist/questions';
import { cn } from '@/lib/utils';

/**
 * Asystent budowania profilu (#37, część kandydata) — „profil z odpowiedzi”, bez CV:
 *   1. informacja o AI (art. 50 ust. 1 AI Act) PRZED pierwszym użyciem, powiązana z przyciskiem
 *      (`aria-describedby`); kandydat odpowiada własnymi słowami na kilka pytań;
 *   2. propozycje pól profilu ze źródłem (cytat z odpowiedzi) — domyślnie niezaznaczone;
 *   3. zapis wyłącznie zaznaczonych (dopisanie do profilu; nic nie jest usuwane).
 * Odpowiedzi nie są zapisywane. Invariant #11: blokada w trakcie żądania, zachowanie odpowiedzi
 * po błędzie, fokus na nagłówku nowego kroku, jasny sukces.
 */

type Phase =
  | { step: 'answers' }
  | { step: 'review'; proposals: CvProposal[]; removed: CvRedactionCounts }
  | { step: 'done'; added: Extract<ApplyCvProposalsResult, { ok: true }>['added'] };

const QUESTION_KEY: Record<ProfileQuestionId, { label: string; hint: string }> = {
  work: { label: 'questionWork', hint: 'hintWork' },
  skills: { label: 'questionSkills', hint: 'hintSkills' },
  languages: { label: 'questionLanguages', hint: 'hintLanguages' },
  certificates: { label: 'questionCertificates', hint: 'hintCertificates' },
};

export function ProfileAssistPanel(): React.JSX.Element {
  const t = useTranslations('profileAssist');
  const tRoot = useTranslations();
  const id = React.useId();
  const [phase, setPhase] = React.useState<Phase>({ step: 'answers' });
  const [answers, setAnswers] = React.useState<ProfileAnswers>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [levels, setLevels] = React.useState<Record<string, LanguageLevel>>({});
  const inFlight = React.useRef(false);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const firstFieldRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (phase.step !== 'answers') headingRef.current?.focus();
  }, [phase.step]);

  async function run<T>(fn: () => Promise<T>, onDone: (r: T) => void): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      onDone(await fn());
    } catch {
      setError(t('errorNetwork'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function propose(): void {
    void run(
      () => proposeProfileFromAnswers(answers),
      (res) => {
        if (res.ok) {
          setSelected(new Set());
          setLevels(Object.fromEntries(res.proposals.filter((p) => p.level).map((p) => [p.id, p.level!])));
          setPhase({ step: 'review', proposals: res.proposals, removed: res.removed });
        } else {
          setError(tRoot(toUserMessageKey(res.error)));
          firstFieldRef.current?.focus();
        }
      },
    );
  }

  function apply(proposals: CvProposal[]): void {
    if (!proposals.some((p) => selected.has(p.id))) {
      setError(t('errorNothingSelected'));
      return;
    }
    const payload = approvedPayload(proposals, selected, levels);
    void run(
      () => applyProfileAssistProposals(payload),
      (res) => {
        if (res.ok) setPhase({ step: 'done', added: res.added });
        else setError(tRoot(toUserMessageKey(res.error)));
      },
    );
  }

  function backToAnswers(): void {
    // Odpowiedzi zostają — kandydat może je poprawić i spróbować ponownie.
    setPhase({ step: 'answers' });
    setSelected(new Set());
    setError(null);
  }

  const errorId = `${id}-error`;
  const errorBox = error ? (
    <p id={errorId} role="alert" className={cn(FORM_ERROR, 'mt-4')}>
      {error}
    </p>
  ) : null;

  if (phase.step === 'answers') {
    const noticeId = `${id}-notice`;
    return (
      <section aria-labelledby={`${id}-title`} className={cn(PAPER, 'my-0')} aria-busy={busy}>
        <h2 id={`${id}-title`} className={H2_EXTENDED}>{t('answersTitle')}</h2>
        <div id={noticeId} className="mt-2 space-y-1.5">
          <p className="text-sm font-semibold leading-[1.6] text-foreground">{t('aiNotice')}</p>
          <ul className={cn(P_EXTENDED, 'list-disc space-y-1 pl-5')}>
            <li>{t('infoApproval')}</li>
            <li>{t('infoStorage')}</li>
            <li>{t('infoOthers')}</li>
            <li>{t('infoNoMatching')}</li>
          </ul>
        </div>
        <p className={cn(P_EXTENDED, 'mt-3')}>
          {t('infoManual')}{' '}
          <Link href="/candidate/onboarding" className="font-semibold text-foreground underline underline-offset-2">
            {t('manualLink')}
          </Link>
        </p>
        {PROFILE_QUESTION_IDS.map((q, index) => {
          const fieldId = `${id}-${q}`;
          const value = answers[q] ?? '';
          return (
            <div key={q} className={cn(FORM_FIELD, 'mt-6')}>
              <label htmlFor={fieldId} className={FORM_LABEL_TEXT}>{t(QUESTION_KEY[q].label)}</label>
              <p id={`${fieldId}-hint`} className={FORM_HINT}>{t(QUESTION_KEY[q].hint)}</p>
              <textarea
                ref={index === 0 ? firstFieldRef : undefined}
                id={fieldId}
                rows={4}
                maxLength={PROFILE_ANSWER_MAX}
                value={value}
                disabled={busy}
                aria-invalid={error ? true : undefined}
                aria-describedby={[`${fieldId}-hint`, `${fieldId}-count`, error ? errorId : ''].filter(Boolean).join(' ')}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q]: e.target.value }))}
                className={FORM_INPUT}
              />
              <p id={`${fieldId}-count`} className={FORM_HINT}>
                {t('charCount', { count: value.length, max: PROFILE_ANSWER_MAX })}
              </p>
            </div>
          );
        })}
        {errorBox}
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={propose} disabled={busy} aria-describedby={noticeId} className={BTN_PRIMARY}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
            {busy ? t('analyzing') : t('propose')}
          </button>
        </div>
        {busy ? <p role="status" className={cn(P_EXTENDED, 'mt-3')}>{t('busyHint')}</p> : null}
      </section>
    );
  }

  if (phase.step === 'review') {
    const removed = Object.values(phase.removed).reduce((n, v) => n + v, 0);
    return (
      <section aria-labelledby={`${id}-title`} className={cn(PAPER, 'my-0')} aria-busy={busy}>
        <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1} className={cn(H2_EXTENDED, 'focus:outline-none')}>
          {t('reviewTitle')}
        </h2>
        <p className={cn(P_EXTENDED, 'mt-2')}>{t('reviewIntro')}</p>
        {removed > 0 ? <p className={cn(FORM_HINT, 'mt-2')}>{t('removedCount', { count: removed })}</p> : null}
        <ProposalChecklist
          idPrefix={id}
          proposals={phase.proposals}
          selected={selected}
          onToggle={(pid, checked) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (checked) next.add(pid);
              else next.delete(pid);
              return next;
            })
          }
          levels={levels}
          onLevel={(pid, level) => setLevels((prev) => ({ ...prev, [pid]: level }))}
          busy={busy}
          sourceText={(p) => (p.evidence ? t('source', { quote: p.evidence }) : t('noSource'))}
        />
        {errorBox}
        <p role="status" className={cn(FORM_HINT, 'mt-5')}>{t('selectedCount', { count: selected.size })}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" onClick={() => apply(phase.proposals)} disabled={busy} className={BTN_PRIMARY}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
            {busy ? t('saving') : t('apply')}
          </button>
          <button type="button" onClick={backToAnswers} disabled={busy} className={BTN_SECONDARY}>
            {t('editAnswers')}
          </button>
        </div>
      </section>
    );
  }

  const { added } = phase;
  const total = added.occupations + added.skills + added.languages + added.certificates + (added.experienceYears ? 1 : 0);
  return (
    <section aria-labelledby={`${id}-title`} className={cn(PAPER, 'my-0')}>
      <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1} className={cn(H2_EXTENDED, 'focus:outline-none')}>
        {t('doneTitle')}
      </h2>
      <p role="status" className={cn(P_EXTENDED, 'mt-2')}>
        {total > 0 ? t('doneText', { count: total }) : t('doneNothingNew')}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/candidate/profil" className={BTN_PRIMARY}>{t('backToProfile')}</Link>
        <Link href="/candidate/onboarding" className={BTN_SECONDARY}>{t('editProfile')}</Link>
      </div>
    </section>
  );
}
