'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, FileText, Loader2, Sparkles } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  CHECKBOX,
  FORM_ERROR,
  FORM_FIELD,
  FORM_HINT,
  FORM_INPUT,
  FORM_LABEL_TEXT,
  FORM_SELECT,
  H2_EXTENDED,
  NOTICE,
  NOTICE_TEXT,
  NOTICE_TITLE,
  P_EXTENDED,
  PAPER,
  TAG,
} from '@/components/dashboard/panel-styles';
import {
  applyCvProposals,
  prepareCvImportAction,
  proposeFromCvAction,
  type ApplyCvProposalsResult,
  type PrepareCvImportResult,
} from '@/lib/actions/cv-import';
import {
  parseExperienceYears,
  proposalValueMaxLength,
  proposalValueProblem,
  type CvProposalValueProblem,
} from '@/lib/cv-import/approved';
import type { CvProposal, CvProposalKind, CvRedactionSummary, LanguageLevel } from '@/lib/cv-import/types';
import type { CvTextProblem } from '@/lib/cv-import/text';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { LANGUAGE_LEVELS } from '@/lib/validation/candidate';
import { CV_ALLOWED_TYPES, checkCvFile } from '@/lib/validation/cv-file';

/**
 * Import CV przez AI (#487, #498) — trzy kroki z jawną decyzją kandydata w każdym:
 *   1. wybór pliku → LOKALNY podgląd tego, co zostałoby wysłane (po usunięciu referencji,
 *      kontaktów, danych osobowych i kategorii szczególnych) — bez wywołania AI;
 *   2. „Wyślij do analizy” — dopiero teraz tekst trafia do dostawcy AI;
 *   3. propozycje: każda pozycja osobno zaznaczana (domyślnie NIE), ze źródłem w CV
 *      i oznaczeniem niepewności; kandydat może poprawić wartość (nazwę, poziom języka, lata)
 *      — te same limity co kreator onboardingu (`proposalValueProblem`, błąd przy polu, fokus
 *      na pierwszym błędnym polu), a serwer sprawdza je ponownie; zapis wyłącznie zaznaczonych.
 *      Edycja nie wywołuje modelu.
 * Ręczne wypełnienie profilu działa zawsze (link do kreatora). Plik nie jest zapisywany
 * i nie trafia do firm. Invariant #11: blokada w trakcie żądania, komunikaty przy polach,
 * zachowanie stanu po błędzie, fokus na nagłówku każdego nowego kroku.
 */

type Phase =
  | { step: 'file' }
  | { step: 'preview'; text: string; summary: CvRedactionSummary }
  | { step: 'review'; proposals: CvProposal[]; suspicious: boolean }
  | { step: 'done'; added: Extract<ApplyCvProposalsResult, { ok: true }>['added'] };

const PROBLEM_KEY: Partial<Record<CvTextProblem, string>> = {
  empty: 'errorFileEmpty',
  tooLarge: 'errorFileTooLarge',
  type: 'errorFileType',
  unsupported: 'errorFileDoc',
};

const KIND_ORDER: CvProposalKind[] = ['occupation', 'skill', 'language', 'certificate', 'experienceYears'];
const KIND_LABEL: Record<CvProposalKind, string> = {
  occupation: 'kindOccupation',
  skill: 'kindSkill',
  language: 'kindLanguage',
  certificate: 'kindCertificate',
  experienceYears: 'kindExperience',
};
const LEVEL_LABEL: Record<LanguageLevel, string> = {
  basic: 'levelBasic',
  intermediate: 'levelIntermediate',
  fluent: 'levelFluent',
  native: 'levelNative',
};
const PROBLEM_MESSAGE: Record<CvProposalValueProblem, string> = {
  required: 'errorValueRequired',
  tooLong: 'errorValueTooLong',
  disallowed: 'errorValueDisallowed',
  languageInvalid: 'errorLanguageInvalid',
  experienceInvalid: 'errorExperienceInvalid',
};
const SUMMARY_KEYS: (keyof CvRedactionSummary)[] = [
  'referenceSections',
  'thirdPartyLines',
  'contacts',
  'personalSections',
  'personalLines',
  'specialCategoryLines',
];

export function CvImportPanel(): React.JSX.Element {
  const t = useTranslations('cvImport');
  const to = useTranslations('onboarding');
  const tRoot = useTranslations();
  const id = React.useId();
  const [phase, setPhase] = React.useState<Phase>({ step: 'file' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [levels, setLevels] = React.useState<Record<string, LanguageLevel>>({});
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, CvProposalValueProblem>>({});
  const valueRefs = React.useRef<Map<string, HTMLInputElement>>(new Map());
  const inFlight = React.useRef(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  // Nowy krok → fokus na jego nagłówku (nie gubimy fokusu na <body>).
  React.useEffect(() => {
    if (phase.step !== 'file') headingRef.current?.focus();
  }, [phase.step]);

  function errorText(code: ErrorCode, reason?: CvTextProblem): string {
    const key = reason ? PROBLEM_KEY[reason] : undefined;
    return key ? t(key) : tRoot(toUserMessageKey(code));
  }

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

  function prepare(): void {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError(t('errorFileMissing'));
      fileRef.current?.focus();
      return;
    }
    const problem = checkCvFile(file);
    if (problem) {
      setError(t(PROBLEM_KEY[problem] ?? 'errorFileType'));
      fileRef.current?.focus();
      return;
    }
    const formData = new FormData();
    formData.set('file', file);
    void run<PrepareCvImportResult>(
      () => prepareCvImportAction(formData),
      (res) => {
        if (res.ok) setPhase({ step: 'preview', text: res.text, summary: res.summary });
        else {
          setError(errorText(res.error, res.reason));
          fileRef.current?.focus();
        }
      },
    );
  }

  function propose(text: string): void {
    void run(
      () => proposeFromCvAction(text),
      (res) => {
        if (res.ok) {
          setSelected(new Set());
          setLevels(Object.fromEntries(res.proposals.filter((p) => p.level).map((p) => [p.id, p.level!])));
          setValues(Object.fromEntries(res.proposals.map((p) => [p.id, p.value])));
          setFieldErrors({});
          setPhase({ step: 'review', proposals: res.proposals, suspicious: res.suspicious });
        } else setError(errorText(res.error));
      },
    );
  }

  function apply(proposals: CvProposal[]): void {
    const chosen = proposals.filter((p) => selected.has(p.id));
    if (chosen.length === 0) {
      setError(t('errorNothingSelected'));
      return;
    }
    const valueOf = (p: CvProposal) => (values[p.id] ?? p.value).trim();
    const levelOf = (p: CvProposal): LanguageLevel => levels[p.id] ?? p.level ?? 'basic';
    // Walidacja zaznaczonych pól przed wysłaniem — te same schematy co serwer i kreator.
    const problems: Record<string, CvProposalValueProblem> = {};
    for (const p of chosen) {
      const problem = proposalValueProblem(p.kind, valueOf(p), levelOf(p));
      if (problem) problems[p.id] = problem;
    }
    setFieldErrors(problems);
    const firstInvalid = KIND_ORDER.flatMap((kind) => proposals.filter((p) => p.kind === kind)).find((p) => problems[p.id]);
    if (firstInvalid) {
      setError(t('errorFieldsInvalid'));
      valueRefs.current.get(firstInvalid.id)?.focus();
      return;
    }
    const of = (kind: CvProposalKind) => chosen.filter((p) => p.kind === kind);
    const experience = of('experienceYears')[0];
    const payload = {
      occupations: of('occupation').map(valueOf),
      skills: of('skill').map(valueOf),
      languages: of('language').map((p) => ({ language: valueOf(p), level: levelOf(p) })),
      certificates: of('certificate').map(valueOf),
      experienceYears: experience ? parseExperienceYears(valueOf(experience)) : null,
    };
    void run(
      () => applyCvProposals(payload),
      (res) => {
        if (res.ok) setPhase({ step: 'done', added: res.added });
        else setError(errorText(res.error));
      },
    );
  }

  function reset(): void {
    setPhase({ step: 'file' });
    setSelected(new Set());
    setValues({});
    setFieldErrors({});
    setError(null);
  }

  const errorId = `${id}-error`;
  const errorBox = error ? (
    <p id={errorId} role="alert" className={cn(FORM_ERROR, 'mt-4')}>
      {error}
    </p>
  ) : null;
  const manualLink = (
    <Link href="/candidate/onboarding" className="font-semibold text-foreground underline underline-offset-2">
      {t('manualLink')}
    </Link>
  );

  if (phase.step === 'file') {
    return (
      <section aria-labelledby={`${id}-title`} className={cn(PAPER, 'my-0')} aria-busy={busy}>
        <h2 id={`${id}-title`} className={H2_EXTENDED}>{t('fileTitle')}</h2>
        <ul className={cn(P_EXTENDED, 'mt-2 list-disc space-y-1 pl-5')}>
          <li>{t('infoPurpose')}</li>
          <li>{t('infoProvider')}</li>
          <li>{t('infoStorage')}</li>
          <li>{t('infoThirdParties')}</li>
          <li>{t('infoNoSharing')}</li>
        </ul>
        <p className={cn(P_EXTENDED, 'mt-3')}>
          {t('infoManual')} {manualLink}
        </p>
        <div className={cn(FORM_FIELD, 'mt-6')}>
          <label htmlFor={`${id}-file`} className={FORM_LABEL_TEXT}>{t('fileLabel')}</label>
          <p id={`${id}-hint`} className={FORM_HINT}>{t('fileHint')}</p>
          <input
            ref={fileRef}
            id={`${id}-file`}
            type="file"
            accept={[...CV_ALLOWED_TYPES.keys()].filter((type) => type !== 'application/msword').join(',')}
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={[`${id}-hint`, error ? errorId : ''].filter(Boolean).join(' ')}
            className={FORM_INPUT}
          />
        </div>
        {errorBox}
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={prepare} disabled={busy} className={BTN_PRIMARY}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileText className="size-4" aria-hidden="true" />}
            {busy ? t('preparing') : t('prepare')}
          </button>
        </div>
      </section>
    );
  }

  if (phase.step === 'preview') {
    const removed = SUMMARY_KEYS.filter((k) => phase.summary[k] > 0);
    return (
      <section aria-labelledby={`${id}-title`} className={cn(PAPER, 'my-0')} aria-busy={busy}>
        <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1} className={cn(H2_EXTENDED, 'focus:outline-none')}>
          {t('previewTitle')}
        </h2>
        <p className={cn(P_EXTENDED, 'mt-2')}>{t('previewIntro')}</p>
        {removed.length > 0 ? (
          <ul className={cn(P_EXTENDED, 'mt-3 list-disc space-y-1 pl-5')}>
            {removed.map((k) => (
              <li key={k}>{t(`removed.${k}`, { count: phase.summary[k] })}</li>
            ))}
          </ul>
        ) : (
          <p className={cn(P_EXTENDED, 'mt-3')}>{t('removedNone')}</p>
        )}
        <pre
          tabIndex={0}
          aria-label={t('previewLabel')}
          className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[11px] border border-border bg-muted/40 p-4 font-sans text-[13px] leading-[1.6] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {phase.text}
        </pre>
        <p className={cn(FORM_HINT, 'mt-3')}>{t('previewHint')}</p>
        {errorBox}
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={() => propose(phase.text)} disabled={busy} className={BTN_PRIMARY}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
            {busy ? t('analyzing') : t('send')}
          </button>
          <button type="button" onClick={reset} disabled={busy} className={BTN_SECONDARY}>
            {t('cancel')}
          </button>
        </div>
        {busy ? <p role="status" className={cn(P_EXTENDED, 'mt-3')}>{t('busyHint')}</p> : null}
      </section>
    );
  }

  if (phase.step === 'review') {
    const count = selected.size;
    return (
      <section aria-labelledby={`${id}-title`} className={cn(PAPER, 'my-0')} aria-busy={busy}>
        <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1} className={cn(H2_EXTENDED, 'focus:outline-none')}>
          {t('reviewTitle')}
        </h2>
        <p className={cn(P_EXTENDED, 'mt-2')}>{t('reviewIntro')}</p>
        {phase.suspicious ? (
          <div className={cn(NOTICE, 'mt-4')} role="note">
            <p className={NOTICE_TITLE}>
              <AlertCircle className="mr-1.5 inline size-4 align-[-2px]" aria-hidden="true" />
              {t('suspiciousTitle')}
            </p>
            <p className={NOTICE_TEXT}>{t('suspiciousText')}</p>
          </div>
        ) : null}
        {KIND_ORDER.map((kind) => {
          const items = phase.proposals.filter((p) => p.kind === kind);
          if (items.length === 0) return null;
          return (
            <fieldset key={kind} className="mt-6 min-w-0 border-t border-border pt-4">
              <legend className="float-left mb-2 w-full text-[15px] font-bold text-foreground">{t(KIND_LABEL[kind])}</legend>
              <ul className="clear-both flex list-none flex-col gap-3 p-0">
                {items.map((p) => {
                  const checkboxId = `${id}-${p.id}`;
                  const sourceId = `${checkboxId}-source`;
                  const valueId = `${checkboxId}-value`;
                  const valueErrorId = `${valueId}-error`;
                  const current = values[p.id] ?? p.value;
                  const problem = fieldErrors[p.id];
                  const isExperience = kind === 'experienceYears';
                  const experienceCount = parseExperienceYears(current);
                  return (
                    <li key={p.id} className="min-w-0 rounded-[11px] border border-border p-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-[9px]">
                        <input
                          id={checkboxId}
                          type="checkbox"
                          className={CHECKBOX}
                          checked={selected.has(p.id)}
                          disabled={busy}
                          aria-describedby={sourceId}
                          onChange={(e) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(p.id);
                              else next.delete(p.id);
                              return next;
                            })
                          }
                        />
                        <label htmlFor={checkboxId} className="min-w-0 break-words text-[15px] font-semibold text-foreground">
                          {isExperience
                            ? Number.isNaN(experienceCount)
                              ? t('kindExperience')
                              : t('experienceValue', { count: experienceCount })
                            : current.trim() || p.value}
                        </label>
                        {p.uncertain ? <span className={cn(TAG, 'text-[12px] font-semibold text-warning-text')}>{t('uncertain')}</span> : null}
                      </div>
                      <p id={sourceId} className={cn(FORM_HINT, 'mt-1.5 break-words')}>
                        {p.evidence ? t('source', { quote: p.evidence }) : t('noSource')}
                      </p>
                      <div className={cn(FORM_FIELD, 'mt-2', isExperience ? 'max-w-[10rem]' : 'max-w-md')}>
                        <label htmlFor={valueId} className={FORM_LABEL_TEXT}>
                          {isExperience ? t('experienceEditLabel') : t('editLabel', { value: p.value })}
                        </label>
                        <input
                          ref={(el) => {
                            if (el) valueRefs.current.set(p.id, el);
                            else valueRefs.current.delete(p.id);
                          }}
                          id={valueId}
                          type="text"
                          inputMode={isExperience ? 'numeric' : undefined}
                          className={FORM_INPUT}
                          value={current}
                          disabled={busy}
                          aria-invalid={problem ? true : undefined}
                          aria-describedby={problem ? valueErrorId : undefined}
                          onChange={(e) => {
                            const next = e.target.value;
                            setValues((prev) => ({ ...prev, [p.id]: next }));
                            if (problem) {
                              setFieldErrors((prev) => {
                                const rest = { ...prev };
                                delete rest[p.id];
                                return rest;
                              });
                            }
                          }}
                        />
                        {problem ? (
                          <p id={valueErrorId} className={FORM_ERROR}>
                            {problem === 'tooLong' && !isExperience
                              ? t('errorValueTooLong', { max: proposalValueMaxLength(kind) })
                              : t(PROBLEM_MESSAGE[problem])}
                          </p>
                        ) : null}
                      </div>
                      {kind === 'language' ? (
                        <div className={cn(FORM_FIELD, 'mt-2 max-w-xs')}>
                          <label htmlFor={`${checkboxId}-level`} className={FORM_LABEL_TEXT}>
                            {t('levelLabel', { language: current.trim() || p.value })}
                          </label>
                          <select
                            id={`${checkboxId}-level`}
                            className={FORM_SELECT}
                            disabled={busy}
                            value={levels[p.id] ?? p.level ?? 'basic'}
                            onChange={(e) => setLevels((prev) => ({ ...prev, [p.id]: e.target.value as LanguageLevel }))}
                          >
                            {LANGUAGE_LEVELS.map((lvl) => (
                              <option key={lvl} value={lvl}>{to(LEVEL_LABEL[lvl])}</option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}
        {errorBox}
        <p role="status" className={cn(FORM_HINT, 'mt-5')}>{t('selectedCount', { count })}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" onClick={() => apply(phase.proposals)} disabled={busy} className={BTN_PRIMARY}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
            {busy ? t('saving') : t('apply')}
          </button>
          <button type="button" onClick={reset} disabled={busy} className={BTN_SECONDARY}>
            {t('discard')}
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
