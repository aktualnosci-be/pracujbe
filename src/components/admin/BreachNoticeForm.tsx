'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { routing } from '@/i18n/routing';
import { notifyBreachSubjects } from '@/lib/actions/breaches';
import { BREACH_LIMITS, parseBreachRecipients } from '@/lib/admin/breach';
import { ADMIN_PAGE_HEADING_FOCUS } from '@/lib/admin/focus';
import { toUserMessageKey } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { AdminConfirmDialog } from '@/components/admin/AdminConfirmDialog';
import { useAdminFeedback } from '@/components/admin/AdminFeedback';
import {
  BTN_PRIMARY,
  FORM_CONTROL,
  FORM_ERROR,
  FORM_FIELD,
  FORM_HINT,
  FORM_LABEL_TEXT,
} from '@/components/admin/admin-styles';

/**
 * BreachNoticeForm — zawiadomienie osób, których dotyczy naruszenie (#490).
 *
 * Szablon jest techniczny: temat i treść wpisuje administrator osobno dla każdego języka.
 * Każda osoba dostanie wersję w SWOIM języku (Invariant #1 — baza wyznacza język odbiorcy
 * i odrzuca wysyłkę, gdy brakuje treści w którymś z potrzebnych języków; wtedy pokazujemy,
 * których języków brakuje i których pozycji nie rozpoznano). Wysyłka idzie przez kolejkę
 * e-mail: „zakolejkowano” nie oznacza doręczenia. Jeden klucz idempotencji na operację.
 */

type Content = Record<string, { subject: string; body: string }>;

const LANGUAGE_KEY: Record<string, string> = {
  pl: 'breachLanguagePl',
  nl: 'breachLanguageNl',
  fr: 'breachLanguageFr',
  en: 'breachLanguageEn',
};

function emptyContent(): Content {
  return Object.fromEntries(routing.locales.map((l) => [l, { subject: '', body: '' }]));
}

export function BreachNoticeForm({ incidentId }: { incidentId: string }): React.JSX.Element {
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const locale = useLocale();
  const feedback = useAdminFeedback();
  const [pending, startTransition] = React.useTransition();
  const [recipients, setRecipients] = React.useState('');
  const [content, setContent] = React.useState<Content>(emptyContent);
  const [confirming, setConfirming] = React.useState(false);
  const [problem, setProblem] = React.useState<{ field: string | null; message: string } | null>(null);
  const clientKey = React.useRef('');
  const submitRef = React.useRef<HTMLButtonElement | null>(null);
  const idBase = React.useId();
  const recipientsId = `${idBase}-recipients`;
  const parsed = React.useMemo(() => parseBreachRecipients(recipients), [recipients]);
  const numberFormat = React.useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const change = () => {
    // Zmiana treści/odbiorców = nowa operacja (nowy klucz przy następnym wysłaniu).
    clientKey.current = '';
    if (problem) setProblem(null);
  };

  const focusField = (field: string | null) => {
    if (!field) return;
    window.setTimeout(() => document.getElementById(`${idBase}-${field}`)?.focus(), 0);
  };

  const openConfirm = () => {
    if (parsed.entries.length === 0) {
      setProblem({ field: 'recipients', message: t('breachNoticeRecipientsRequired') });
      focusField('recipients');
      return;
    }
    if (parsed.malformed.length > 0) {
      setProblem({
        field: 'recipients',
        message: t('breachNoticeRecipientsMalformed', { list: parsed.malformed.slice(0, 10).join(', ') }),
      });
      focusField('recipients');
      return;
    }
    setProblem(null);
    setConfirming(true);
  };

  const send = () => {
    if (pending) return;
    if (!clientKey.current) clientKey.current = crypto.randomUUID();
    startTransition(async () => {
      try {
        const res = await notifyBreachSubjects(incidentId, clientKey.current, { recipients, content });
        setConfirming(false);
        if (res.ok) {
          clientKey.current = '';
          setRecipients('');
          setContent(emptyContent());
          feedback.succeed({
            message: res.demo
              ? t('breachDemoNotSaved')
              : t('breachNoticeQueued', {
                  queued: numberFormat.format(res.queued ?? 0),
                  recipients: numberFormat.format(res.recipients ?? 0),
                }),
            focusKey: ADMIN_PAGE_HEADING_FOCUS,
          });
          return;
        }
        // Odrzucenie bez zapisu — ten sam klucz można bezpiecznie użyć po poprawce.
        clientKey.current = '';
        const parts: string[] = [];
        if (res.missingLocales && res.missingLocales.length > 0) {
          parts.push(
            t('breachNoticeMissingLocales', {
              list: res.missingLocales.map((l) => (LANGUAGE_KEY[l] ? t(LANGUAGE_KEY[l]) : l)).join(', '),
            }),
          );
        }
        if (res.unknown && res.unknown.length > 0) {
          parts.push(
            t('breachNoticeUnknown', {
              count: res.unknownCount ?? res.unknown.length,
              list: res.unknown.slice(0, 10).join(', '),
            }),
          );
        }
        if (parts.length > 0) {
          const field = res.missingLocales?.[0] ? `subject_${res.missingLocales[0]}` : 'recipients';
          setProblem({ field, message: parts.join(' ') });
          focusField(field);
          return;
        }
        if (res.problem === 'notifyNotDecided' || res.problem === 'closed') {
          setProblem({ field: null, message: t('breachNoticeNotAllowed') });
          return;
        }
        if (res.field) {
          const message =
            res.field === 'content'
              ? t('breachNoticeContentRequired')
              : res.field === 'recipients'
                ? t('breachNoticeRecipientsRequired')
                : t(res.fieldError === 'tooLong' ? 'breachErrorTooLong' : 'breachErrorRequired', {
                    max: res.field.startsWith('body') ? BREACH_LIMITS.noticeBody : BREACH_LIMITS.noticeSubject,
                  });
          setProblem({ field: res.field, message });
          focusField(res.field);
          return;
        }
        feedback.fail(tRoot(toUserMessageKey(res.error)));
      } catch {
        // Błąd sieci: klucz zostaje — ponowienie nie zakolejkuje drugi raz.
        setConfirming(false);
        feedback.fail(tRoot(toUserMessageKey('INTERNAL')));
      }
    });
  };

  const invalid = (field: string) => problem?.field === field || undefined;
  const errorId = `${idBase}-problem`;

  return (
    <div className="min-w-0 space-y-5" aria-busy={pending || undefined}>
      <div className={FORM_FIELD}>
        <label htmlFor={recipientsId} className={FORM_LABEL_TEXT}>
          {t('breachNoticeRecipientsLabel')}
        </label>
        <p id={`${recipientsId}-hint`} className={FORM_HINT}>
          {t('breachNoticeRecipientsHint', { max: numberFormat.format(BREACH_LIMITS.recipients) })}
        </p>
        <textarea
          id={recipientsId}
          rows={5}
          value={recipients}
          disabled={pending}
          aria-invalid={invalid('recipients')}
          aria-describedby={problem ? `${recipientsId}-hint ${errorId}` : `${recipientsId}-hint`}
          onChange={(e) => {
            setRecipients(e.target.value);
            change();
          }}
          className={FORM_CONTROL}
        />
      </div>

      <p className={FORM_HINT}>{t('breachNoticeContentHint')}</p>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        {routing.locales.map((l) => (
          <fieldset key={l} className="min-w-0 space-y-3 rounded-[14px] border border-[color:var(--pp-line)] p-4">
            <legend className={cn(FORM_LABEL_TEXT, 'px-1')}>{t(LANGUAGE_KEY[l] ?? 'breachLanguageEn')}</legend>
            <div className={FORM_FIELD}>
              <label htmlFor={`${idBase}-subject_${l}`} className={FORM_LABEL_TEXT}>
                {t('breachNoticeSubjectLabel')}
              </label>
              <input
                id={`${idBase}-subject_${l}`}
                type="text"
                lang={l}
                maxLength={BREACH_LIMITS.noticeSubject}
                value={content[l]?.subject ?? ''}
                disabled={pending}
                aria-invalid={invalid(`subject_${l}`)}
                aria-describedby={invalid(`subject_${l}`) ? errorId : undefined}
                onChange={(e) => {
                  const value = e.target.value;
                  setContent((prev) => ({ ...prev, [l]: { subject: value, body: prev[l]?.body ?? '' } }));
                  change();
                }}
                className={FORM_CONTROL}
              />
            </div>
            <div className={FORM_FIELD}>
              <label htmlFor={`${idBase}-body_${l}`} className={FORM_LABEL_TEXT}>
                {t('breachNoticeBodyLabel')}
              </label>
              <textarea
                id={`${idBase}-body_${l}`}
                rows={6}
                lang={l}
                maxLength={BREACH_LIMITS.noticeBody}
                value={content[l]?.body ?? ''}
                disabled={pending}
                aria-invalid={invalid(`body_${l}`)}
                aria-describedby={invalid(`body_${l}`) ? errorId : undefined}
                onChange={(e) => {
                  const value = e.target.value;
                  setContent((prev) => ({ ...prev, [l]: { subject: prev[l]?.subject ?? '', body: value } }));
                  change();
                }}
                className={FORM_CONTROL}
              />
            </div>
          </fieldset>
        ))}
      </div>

      <div role="alert">
        {problem ? (
          <p id={errorId} className={cn(FORM_ERROR, 'font-semibold')}>
            {problem.message}
          </p>
        ) : null}
      </div>

      <button
        ref={submitRef}
        type="button"
        disabled={pending}
        aria-haspopup="dialog"
        onClick={openConfirm}
        className={BTN_PRIMARY}
      >
        {t('breachNoticeSubmit')}
      </button>

      {confirming ? (
        <AdminConfirmDialog
          title={t('breachNoticeConfirmTitle')}
          description={t('breachNoticeConfirmHint')}
          details={[
            {
              key: 'recipients',
              label: t('breachNoticeRecipientsLabel'),
              value: numberFormat.format(parsed.entries.length),
            },
          ]}
          confirmLabel={t('breachNoticeSubmit')}
          tone="warning"
          pending={pending}
          onConfirm={send}
          onCancel={() => {
            setConfirming(false);
            window.setTimeout(() => submitRef.current?.focus(), 0);
          }}
        />
      ) : null}
    </div>
  );
}
