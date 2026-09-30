'use client';

import * as React from 'react';
import { ExternalLink, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  FORM_ERROR,
  FORM_FIELD,
  FORM_GRID,
  FORM_HINT,
  FORM_INPUT,
  FORM_LABEL_TEXT,
  FORM_WIDE,
  H2_EXTENDED,
  PAPER,
  P_EXTENDED,
} from '@/components/dashboard/panel-styles';
import { deleteJournalEntryAction, saveJournalEntryAction } from '@/lib/actions/application-journal';
import type { JournalEntry } from '@/lib/data/application-journal';
import { toUserMessageKey } from '@/lib/errors';
import { containsPersonalIdentifier } from '@/lib/privacy/sensitive-data';
import {
  JOURNAL_LIMITS,
  JOURNAL_STAGES,
  isJournalHttpsUrl,
  isValidYmd,
  type JournalFieldName,
  type JournalStage,
} from '@/lib/validation/application-journal';
import { cn } from '@/lib/utils';

/**
 * Dziennik aplikacji kandydata (#904): prywatne notatki o aplikacjach składanych u pracodawców
 * poza portalem. Formularz (nowy/edycja) i lista z usuwaniem po potwierdzeniu. Invariant #11:
 * blokada w trakcie zapisu, dane zostają po błędzie, błędy przy polach z fokusem na pierwszym,
 * jeden klucz idempotencji na otwarcie formularza, jasny wynik w regionie `status`/`alert`.
 * Dane widzi wyłącznie właściciel — nic nie trafia do firm (RLS, zapis przez RPC).
 */
export interface ApplicationJournalProps {
  entries: Array<JournalEntry & { appliedLabel: string | null; remindLabel: string | null }>;
  /** Tryb demo: zapis niedostępny. */
  demo?: boolean;
}

interface FormState {
  entryId: string | null;
  jobTitle: string;
  companyName: string;
  sourceUrl: string;
  location: string;
  appliedOn: string;
  stage: JournalStage;
  note: string;
  remindOn: string;
}

const EMPTY_FORM: FormState = {
  entryId: null,
  jobTitle: '',
  companyName: '',
  sourceUrl: '',
  location: '',
  appliedOn: '',
  stage: 'sent',
  note: '',
  remindOn: '',
};

type Errors = Partial<Record<JournalFieldName, string>>;
type Feedback = { tone: 'ok' | 'error'; text: string } | null;

export function ApplicationJournal({ entries, demo = false }: ApplicationJournalProps): React.JSX.Element {
  const t = useTranslations('applicationJournal');
  const tRoot = useTranslations();
  const router = useRouter();
  const [form, setForm] = React.useState<FormState | null>(null);
  const [errors, setErrors] = React.useState<Errors>({});
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [confirm, setConfirm] = React.useState<JournalEntry | null>(null);
  const clientKey = React.useRef<string>('');
  const statusRef = React.useRef<HTMLParagraphElement>(null);
  const addRef = React.useRef<HTMLButtonElement>(null);
  const editButtons = React.useRef(new Map<string, HTMLButtonElement>());
  const fieldRefs = React.useRef<Partial<Record<JournalFieldName, HTMLElement | null>>>({});

  const openForm = (next: FormState) => {
    clientKey.current = crypto.randomUUID();
    setErrors({});
    setFeedback(null);
    setForm(next);
  };
  const closeForm = (returnTo?: string) => {
    setForm(null);
    setErrors({});
    requestAnimationFrame(() => {
      const target = returnTo ? editButtons.current.get(returnTo) : null;
      (target ?? addRef.current)?.focus();
    });
  };

  const validate = (f: FormState): Errors => {
    const e: Errors = {};
    if (!f.jobTitle.trim()) e.jobTitle = t('required');
    if (!f.companyName.trim()) e.companyName = t('required');
    if (f.sourceUrl.trim() && !isJournalHttpsUrl(f.sourceUrl.trim())) e.sourceUrl = t('urlInvalid');
    if (f.appliedOn && !isValidYmd(f.appliedOn)) e.appliedOn = t('required');
    if (f.remindOn && !isValidYmd(f.remindOn)) e.remindOn = t('required');
    if (containsPersonalIdentifier(f.note)) e.note = t('noteSensitive');
    return e;
  };

  const focusFirstError = (e: Errors) => {
    const order: JournalFieldName[] = ['jobTitle', 'companyName', 'sourceUrl', 'location', 'appliedOn', 'stage', 'note', 'remindOn'];
    const first = order.find((name) => e[name]);
    if (first) requestAnimationFrame(() => fieldRefs.current[first]?.focus());
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form || pending) return;
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstError(found);
      return;
    }
    setPending(true);
    setFeedback(null);
    try {
      const res = await saveJournalEntryAction({
        clientKey: clientKey.current,
        entryId: form.entryId ?? undefined,
        jobTitle: form.jobTitle,
        companyName: form.companyName,
        sourceUrl: form.sourceUrl,
        location: form.location,
        appliedOn: form.appliedOn,
        stage: form.stage,
        note: form.note,
        remindOn: form.remindOn,
      });
      if (res.ok) {
        const id = form.entryId ?? res.id;
        setFeedback({ tone: 'ok', text: t('saved') });
        closeForm(id);
        router.refresh();
        return;
      }
      if (res.field) {
        const fieldErrors: Errors = { [res.field]: res.field === 'sourceUrl' ? t('urlInvalid') : res.field === 'note' ? t('noteSensitive') : t('required') };
        setErrors(fieldErrors);
        focusFirstError(fieldErrors);
      } else {
        setFeedback({ tone: 'error', text: tRoot(toUserMessageKey(res.error === 'UNAUTHENTICATED' ? 'PERMISSION_DENIED' : res.error)) });
      }
    } catch {
      setFeedback({ tone: 'error', text: t('errorNetwork') });
    } finally {
      setPending(false);
    }
  };

  const remove = async (entry: JournalEntry) => {
    if (pending) return;
    setPending(true);
    setFeedback(null);
    try {
      const res = await deleteJournalEntryAction(entry.id);
      if (res.ok) {
        setFeedback({ tone: 'ok', text: t('deleted') });
        router.refresh();
      } else {
        setFeedback({ tone: 'error', text: tRoot(toUserMessageKey(res.error)) });
      }
    } catch {
      setFeedback({ tone: 'error', text: t('errorNetwork') });
    } finally {
      setPending(false);
      setConfirm(null);
    }
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const fieldProps = (name: JournalFieldName, id: string, hint?: boolean) => ({
    id,
    ref: (node: HTMLElement | null) => {
      fieldRefs.current[name] = node;
    },
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': [hint ? `${id}-hint` : null, errors[name] ? `${id}-error` : null].filter(Boolean).join(' ') || undefined,
    disabled: pending,
  });
  const errorFor = (name: JournalFieldName, id: string) =>
    errors[name] ? (
      <p id={`${id}-error`} className={FORM_ERROR}>
        {errors[name]}
      </p>
    ) : null;

  return (
    <div className="min-w-0">
      <p
        ref={statusRef}
        tabIndex={-1}
        role={feedback?.tone === 'error' ? 'alert' : 'status'}
        className={feedback?.tone === 'error' ? 'text-sm text-error-text' : 'text-sm text-foreground'}
      >
        {feedback?.text ?? ''}
      </p>

      {demo ? <p className={cn(P_EXTENDED, 'my-3')}>{t('demo')}</p> : null}

      {form === null ? (
        <button
          type="button"
          ref={addRef}
          onClick={() => openForm(EMPTY_FORM)}
          disabled={demo || pending}
          className={cn(BTN_PRIMARY, 'my-3')}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('add')}
        </button>
      ) : (
        <form onSubmit={submit} noValidate aria-busy={pending || undefined} className={PAPER}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !pending) {
              event.preventDefault();
              closeForm(form.entryId ?? undefined);
            }
          }}
        >
          <h2 className={H2_EXTENDED}>{form.entryId ? t('formEditTitle') : t('formNewTitle')}</h2>
          <div className={FORM_GRID}>
            <div className={FORM_FIELD}>
              <label htmlFor="aj-title" className={FORM_LABEL_TEXT}>{t('jobTitle')}</label>
              <input {...fieldProps('jobTitle', 'aj-title')} type="text" required maxLength={JOURNAL_LIMITS.title}
                value={form.jobTitle} onChange={(e) => setField('jobTitle', e.target.value)} className={FORM_INPUT} />
              {errorFor('jobTitle', 'aj-title')}
            </div>
            <div className={FORM_FIELD}>
              <label htmlFor="aj-company" className={FORM_LABEL_TEXT}>{t('company')}</label>
              <input {...fieldProps('companyName', 'aj-company')} type="text" required maxLength={JOURNAL_LIMITS.company}
                value={form.companyName} onChange={(e) => setField('companyName', e.target.value)} className={FORM_INPUT} />
              {errorFor('companyName', 'aj-company')}
            </div>
            <div className={cn(FORM_FIELD, FORM_WIDE)}>
              <label htmlFor="aj-url" className={FORM_LABEL_TEXT}>{t('sourceUrl')}</label>
              <input {...fieldProps('sourceUrl', 'aj-url', true)} type="url" inputMode="url" maxLength={JOURNAL_LIMITS.url}
                value={form.sourceUrl} onChange={(e) => setField('sourceUrl', e.target.value)} className={FORM_INPUT} />
              <p id="aj-url-hint" className={FORM_HINT}>{t('sourceUrlHint')}</p>
              {errorFor('sourceUrl', 'aj-url')}
            </div>
            <div className={FORM_FIELD}>
              <label htmlFor="aj-location" className={FORM_LABEL_TEXT}>{t('location')}</label>
              <input {...fieldProps('location', 'aj-location')} type="text" maxLength={JOURNAL_LIMITS.location}
                value={form.location} onChange={(e) => setField('location', e.target.value)} className={FORM_INPUT} />
              {errorFor('location', 'aj-location')}
            </div>
            <div className={FORM_FIELD}>
              <label htmlFor="aj-stage" className={FORM_LABEL_TEXT}>{t('stage')}</label>
              <select {...fieldProps('stage', 'aj-stage')} value={form.stage}
                onChange={(e) => setField('stage', e.target.value as JournalStage)} className={FORM_INPUT}>
                {JOURNAL_STAGES.map((stage) => (
                  <option key={stage} value={stage}>{t(`stages.${stage}`)}</option>
                ))}
              </select>
            </div>
            <div className={FORM_FIELD}>
              <label htmlFor="aj-applied" className={FORM_LABEL_TEXT}>{t('appliedOn')}</label>
              <input {...fieldProps('appliedOn', 'aj-applied')} type="date"
                value={form.appliedOn} onChange={(e) => setField('appliedOn', e.target.value)} className={FORM_INPUT} />
              {errorFor('appliedOn', 'aj-applied')}
            </div>
            <div className={FORM_FIELD}>
              <label htmlFor="aj-remind" className={FORM_LABEL_TEXT}>{t('remindOn')}</label>
              <input {...fieldProps('remindOn', 'aj-remind')} type="date"
                value={form.remindOn} onChange={(e) => setField('remindOn', e.target.value)} className={FORM_INPUT} />
              {errorFor('remindOn', 'aj-remind')}
            </div>
            <div className={cn(FORM_FIELD, FORM_WIDE)}>
              <label htmlFor="aj-note" className={FORM_LABEL_TEXT}>{t('note')}</label>
              <textarea {...fieldProps('note', 'aj-note', true)} rows={4} maxLength={JOURNAL_LIMITS.note}
                value={form.note} onChange={(e) => setField('note', e.target.value)} className={FORM_INPUT} />
              <p id="aj-note-hint" className={FORM_HINT}>{t('noteHint')}</p>
              {errorFor('note', 'aj-note')}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={pending} className={BTN_PRIMARY}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {pending ? t('saving') : t('save')}
            </button>
            <button type="button" disabled={pending} onClick={() => closeForm(form.entryId ?? undefined)} className={BTN_SECONDARY}>
              {t('cancel')}
            </button>
          </div>
        </form>
      )}

      <ul aria-label={t('listLabel')} className="min-w-0">
        {entries.map((entry) => (
          <li key={entry.id} className={cn(PAPER, 'space-y-3')}>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className={cn(H2_EXTENDED, 'break-words')}>{entry.jobTitle}</h2>
                <p className="mt-1 break-words text-[15px] leading-[1.7] text-foreground">
                  {entry.companyName}
                  {entry.location ? ` · ${entry.location}` : ''}
                </p>
              </div>
              <span className="inline-flex w-fit shrink-0 rounded-full border border-border bg-soft px-3 py-1 text-[13px] font-semibold text-foreground">
                {t(`stages.${entry.stage}`)}
              </span>
            </div>
            <p className="text-[15px] leading-[1.7] text-muted-foreground">
              {[entry.appliedLabel ? t('appliedLabel', { date: entry.appliedLabel }) : null,
                entry.remindLabel ? t('remindLabel', { date: entry.remindLabel }) : null]
                .filter(Boolean)
                .join(' · ')}
              {entry.remindDue ? (
                <strong className="ml-2 font-semibold text-error-text">{t('remindDue')}</strong>
              ) : null}
            </p>
            {entry.note ? <p className="whitespace-pre-line break-words text-[15px] leading-[1.7] text-foreground">{entry.note}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              {entry.sourceUrl ? (
                <a
                  href={entry.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex min-h-11 items-center gap-2 rounded-[11px] px-3 text-[13px] font-semibold text-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  {t('openSource')}
                  <span className="sr-only">: {entry.jobTitle}</span>
                </a>
              ) : null}
              <button
                type="button"
                ref={(node) => {
                  if (node) editButtons.current.set(entry.id, node);
                  else editButtons.current.delete(entry.id);
                }}
                disabled={pending || demo}
                onClick={() =>
                  openForm({
                    entryId: entry.id,
                    jobTitle: entry.jobTitle,
                    companyName: entry.companyName,
                    sourceUrl: entry.sourceUrl ?? '',
                    location: entry.location ?? '',
                    appliedOn: entry.appliedOn ?? '',
                    stage: entry.stage,
                    note: entry.note ?? '',
                    remindOn: entry.remindOn ?? '',
                  })
                }
                className="inline-flex min-h-11 items-center gap-2 rounded-[11px] px-3 text-[13px] font-semibold text-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 sm:ml-auto"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                {t('edit')}
                <span className="sr-only">: {entry.jobTitle}</span>
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirm(entry)}
                className="inline-flex min-h-11 items-center gap-2 rounded-[11px] px-3 text-[13px] font-semibold text-error-text hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t('delete')}
                <span className="sr-only">: {entry.jobTitle}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm ? t('deleteTitle', { name: confirm.jobTitle }) : ''}
        description={t('deleteDescription')}
        confirmLabel={t('delete')}
        cancelLabel={tRoot('common.cancel')}
        pending={pending}
        getReturnFocus={() => statusRef.current}
        onConfirm={() => {
          if (confirm) void remove(confirm);
        }}
      />
    </div>
  );
}
