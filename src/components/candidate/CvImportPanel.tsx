'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, FileText, Loader2, Sparkles } from 'lucide-react';

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
  NOTICE,
  NOTICE_TEXT,
  NOTICE_TITLE,
  P_EXTENDED,
  PAPER,
} from '@/components/dashboard/panel-styles';
import {
  applyCvProposals,
  prepareCvImportAction,
  proposeFromCvAction,
  type ApplyCvProposalsResult,
  type PrepareCvImportResult,
} from '@/lib/actions/cv-import';
import type { CvProposal, CvRedactionSummary, LanguageLevel } from '@/lib/cv-import/types';
import type { CvTextProblem } from '@/lib/cv-import/text';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { CV_ALLOWED_TYPES, checkCvFile } from '@/lib/validation/cv-file';

/**
 * Import CV przez AI (#487, #498) — trzy kroki z jawną decyzją kandydata w każdym:
 *   1. wybór pliku → LOKALNY podgląd tego, co zostałoby wysłane (po usunięciu referencji,
 *      kontaktów, danych osobowych i kategorii szczególnych) — bez wywołania AI;
 *   2. „Wyślij do analizy” — dopiero teraz tekst trafia do dostawcy AI;
 *   3. propozycje: każda pozycja osobno zaznaczana (domyślnie NIE), ze źródłem w CV
 *      i oznaczeniem niepewności; zapis wyłącznie zaznaczonych.
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
  const tRoot = useTranslations();
  const id = React.useId();
  const [phase, setPhase] = React.useState<Phase>({ step: 'file' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [levels, setLevels] = React.useState<Record<string, LanguageLevel>>({});
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
          setPhase({ step: 'review', proposals: res.proposals, suspicious: res.suspicious });
        } else setError(errorText(res.error));
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
