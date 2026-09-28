'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { deleteMessageTemplate, saveMessageTemplate, type TemplateError } from '@/lib/actions/message-templates';
import { toUserMessageKey } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  TEMPLATE_BODY_MAX,
  TEMPLATE_NAME_MAX,
  TEMPLATES_PER_COMPANY_MAX,
  findSensitiveVariant,
  type MessageTemplate,
} from '@/lib/validation/message-template';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_SMALL,
  FORM_CONTROL,
  FORM_ERROR,
  FORM_FIELD,
  FORM_HINT,
  FORM_LABEL_TEXT,
  PANEL,
  PANEL_H2,
  PANEL_P,
  TAG,
} from '@/components/dashboard/panel-styles';

/**
 * Zarządzanie szablonami odpowiedzi firmy (/employer/szablony, 0170).
 *
 * Formularz: nazwa + treść w każdym języku serwisu (wypełnia się dowolne; kompozytor wybiera
 * wariant wg języka kandydata). Zapis blokuje przycisk (Invariant #11), błąd przy polu
 * i komunikat z kodu (Invariant #8), dane zostają po błędzie. Usunięcie z potwierdzeniem.
 * `companyId` = firma widoku (sprawdzana w akcji — ACTIVE_COMPANY_CHANGED).
 */

type Draft = { id: string | null; name: string; variants: Record<Locale, string>; updatedAt: string | null };

function emptyDraft(): Draft {
  return { id: null, name: '', variants: { pl: '', nl: '', fr: '', en: '' }, updatedAt: null };
}

function draftOf(template: MessageTemplate): Draft {
  return {
    id: template.id,
    name: template.name,
    variants: {
      pl: template.variants.pl ?? '',
      nl: template.variants.nl ?? '',
      fr: template.variants.fr ?? '',
      en: template.variants.en ?? '',
    },
    updatedAt: template.updatedAt,
  };
}

export interface MessageTemplatesManagerProps {
  companyId: string;
  templates: MessageTemplate[];
}

export function MessageTemplatesManager({ companyId, templates }: MessageTemplatesManagerProps): React.JSX.Element {
  const t = useTranslations('messageTemplates');
  const tc = useTranslations('common');
  const tRoot = useTranslations();
  const router = useRouter();
  const formId = React.useId();
  const nameRef = React.useRef<HTMLInputElement>(null);
  const statusRef = React.useRef<HTMLParagraphElement>(null);

  const [draft, setDraft] = React.useState<Draft>(emptyDraft);
  const [fieldError, setFieldError] = React.useState<{ field: 'name' | 'variants' | Locale; message: string } | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [toDelete, setToDelete] = React.useState<MessageTemplate | null>(null);

  function errorText(code: TemplateError): string {
    if (code === 'TEMPLATE_LIMIT') return t('errorLimit', { max: TEMPLATES_PER_COMPANY_MAX });
    if (code === 'STALE_STATE') return t('errorStale');
    return tRoot(toUserMessageKey(code));
  }

  function startEdit(template: MessageTemplate | null): void {
    setDraft(template ? draftOf(template) : emptyDraft());
    setFieldError(null);
    setFormError(null);
    setNotice(null);
    requestAnimationFrame(() => nameRef.current?.focus());
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (pending) return;
    setFormError(null);
    setNotice(null);
    if (draft.name.trim().length === 0) {
      setFieldError({ field: 'name', message: t('errorNameRequired') });
      nameRef.current?.focus();
      return;
    }
    if (!routing.locales.some((locale) => draft.variants[locale].trim().length > 0)) {
      setFieldError({ field: 'variants', message: t('errorBodyRequired') });
      document.getElementById(`${formId}-pl`)?.focus();
      return;
    }
    const sensitive = findSensitiveVariant(draft.variants);
    if (sensitive) {
      setFieldError({ field: sensitive, message: t('errorSensitiveId') });
      document.getElementById(`${formId}-${sensitive}`)?.focus();
      return;
    }
    setFieldError(null);
    startTransition(async () => {
      try {
        const result = await saveMessageTemplate(
          { id: draft.id, name: draft.name, variants: draft.variants, expectedUpdatedAt: draft.updatedAt },
          companyId,
        );
        if (result.ok) {
          setDraft(emptyDraft());
          setNotice(draft.id ? t('savedUpdated') : t('savedCreated'));
          router.refresh();
          requestAnimationFrame(() => statusRef.current?.focus());
        } else if (result.reason === 'sensitiveId') {
          setFormError(t('errorSensitiveId'));
        } else {
          setFormError(errorText(result.error));
        }
      } catch {
        setFormError(t('errorUncertain'));
      }
    });
  }

  function confirmDelete(): void {
    const template = toDelete;
    if (!template || pending) return;
    startTransition(async () => {
      try {
        const result = await deleteMessageTemplate(template.id, companyId);
        setToDelete(null);
        if (result.ok) {
          if (draft.id === template.id) setDraft(emptyDraft());
          setNotice(t('deleted', { name: template.name }));
          router.refresh();
        } else {
          setFormError(errorText(result.error));
        }
      } catch {
        setToDelete(null);
        setFormError(t('errorUncertain'));
      }
      requestAnimationFrame(() => statusRef.current?.focus());
    });
  }

  const nameErrorId = `${formId}-name-error`;
  const variantsErrorId = `${formId}-variants-error`;

  return (
    <div className="space-y-7">
      <p ref={statusRef} tabIndex={-1} role="status" className="text-[13px] font-semibold text-foreground outline-none">
        {notice}
      </p>

      <section aria-labelledby={`${formId}-list`} className={PANEL}>
        <h2 id={`${formId}-list`} className={PANEL_H2}>{t('listTitle')}</h2>
        {templates.length === 0 ? (
          <p className={`mt-2 ${PANEL_P}`}>{t('listEmpty')}</p>
        ) : (
          <ul className="mt-4 divide-y divide-[color:var(--pp-line)]">
            {templates.map((template) => (
              <li key={template.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="break-words text-[15px] font-bold text-foreground">{template.name}</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {routing.locales.filter((locale) => template.variants[locale]).map((locale) => (
                      <span key={locale} className={TAG}>{t(`languages.${locale}`)}</span>
                    ))}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={BTN_SMALL} disabled={pending}
                    aria-label={t('editLabel', { name: template.name })} onClick={() => startEdit(template)}>
                    {t('edit')}
                  </button>
                  <button type="button" className={BTN_SMALL} disabled={pending}
                    aria-label={t('deleteLabel', { name: template.name })} onClick={() => setToDelete(template)}>
                    {t('delete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={submit} noValidate aria-labelledby={`${formId}-form`} className={cn(PANEL, 'space-y-5')}>
        <h2 id={`${formId}-form`} className={PANEL_H2}>{draft.id ? t('formEditTitle') : t('formNewTitle')}</h2>
        <p className={PANEL_P}>{t('formHint')}</p>
        <div className={FORM_FIELD}>
          <label htmlFor={`${formId}-name`} className={FORM_LABEL_TEXT}>{t('nameLabel')}</label>
          <input
            ref={nameRef}
            id={`${formId}-name`}
            className={FORM_CONTROL}
            value={draft.name}
            maxLength={TEMPLATE_NAME_MAX}
            readOnly={pending}
            aria-invalid={fieldError?.field === 'name' ? true : undefined}
            aria-describedby={fieldError?.field === 'name' ? nameErrorId : undefined}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          {fieldError?.field === 'name' ? <p id={nameErrorId} className={FORM_ERROR}>{fieldError.message}</p> : null}
        </div>
        <p className={FORM_HINT}>{t('variablesHint')}</p>
        {routing.locales.map((locale) => {
          const id = `${formId}-${locale}`;
          const invalid = fieldError?.field === locale || fieldError?.field === 'variants';
          return (
            <div key={locale} className={FORM_FIELD}>
              <label htmlFor={id} className={FORM_LABEL_TEXT}>{t('bodyLabel', { language: t(`languages.${locale}`) })}</label>
              <textarea
                id={id}
                rows={4}
                className={cn(FORM_CONTROL, 'resize-y')}
                value={draft.variants[locale]}
                maxLength={TEMPLATE_BODY_MAX}
                readOnly={pending}
                aria-invalid={invalid ? true : undefined}
                aria-describedby={invalid ? variantsErrorId : undefined}
                onChange={(event) => setDraft({ ...draft, variants: { ...draft.variants, [locale]: event.target.value } })}
              />
            </div>
          );
        })}
        {fieldError && fieldError.field !== 'name' ? (
          <p id={variantsErrorId} className={FORM_ERROR}>{fieldError.message}</p>
        ) : null}
        {formError ? <p role="alert" className={FORM_ERROR}>{formError}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={cn(BTN_PRIMARY, 'disabled:opacity-60')} disabled={pending} aria-busy={pending}>
            {pending ? t('saving') : t('save')}
          </button>
          {draft.id ? (
            <button type="button" className={BTN_SECONDARY} disabled={pending} onClick={() => startEdit(null)}>
              {t('cancelEdit')}
            </button>
          ) : null}
        </div>
      </form>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => { if (!open) setToDelete(null); }}
        title={t('deleteConfirmTitle', { name: toDelete?.name ?? '' })}
        description={t('deleteConfirmDescription')}
        confirmLabel={t('delete')}
        cancelLabel={tc('cancel')}
        onConfirm={confirmDelete}
        pending={pending}
        getReturnFocus={() => statusRef.current}
      />
    </div>
  );
}
