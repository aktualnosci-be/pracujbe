'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { localeNames, routing, type Locale } from '@/i18n/routing';
import { createEmailCampaignRevision } from '@/lib/actions/admin-campaigns';
import {
  CAMPAIGN_EDITOR_ERROR_KEY,
  CAMPAIGN_JOB_FIELDS,
  CAMPAIGN_JOB_LIMITS,
  CAMPAIGN_SLUG_MAX,
  campaignContentFromForm,
  campaignEditorErrorOrder,
  campaignEditorErrors,
  campaignEditorLimit,
  emptyCampaignJob,
  jobFieldKey,
  localeJobsKey,
  type CampaignEditorErrors,
  type CampaignEditorForm,
  type CampaignEditorJob,
} from '@/lib/admin/campaign-editor';
import { campaignPreview } from '@/lib/admin/campaign-preview';
import { NEWSLETTER_JOBS_MAX } from '@/lib/email/newsletter-rules';
import { toUserMessageKey } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  BTN_PRIMARY,
  BTN_SMALL,
  FORM_CONTROL,
  FORM_ERROR,
  FORM_FIELD,
  FORM_HINT,
  FORM_LABEL_TEXT,
  PANEL,
  PANEL_H2,
  PANEL_P,
  SECTION_HEAD,
  chipClass,
} from '@/components/admin/admin-styles';
import { CampaignPreviewCard } from '@/components/admin/CampaignPreviewCard';

/**
 * EmailCampaignEditor — nowa kampania albo nowa rewizja istniejącego sluga (#45, panel admina).
 *
 * Treść w KAŻDYM języku serwisu (list idzie w języku odbiorcy — Invariant #1): 1–3 oferty
 * (slug, tytuł, miasto, stawka opcjonalnie). Walidacja = `campaignEditorErrors` (reguły workera
 * + podgląd), błędy przy polach (`aria-invalid` + `aria-describedby`), fokus na pierwszym
 * błędzie, dane zostają po błędzie, przycisk zablokowany w trakcie zapisu i jeden klucz
 * idempotencji na operację (Invariant #11). Podgląd wybranego języka liczy `campaignPreview`
 * (ta sama funkcja co szczegół rewizji). Zapis tworzy SZKIC — aktywacja w szczególe rewizji.
 */

type JobField = (typeof CAMPAIGN_JOB_FIELDS)[number];

const FIELD_LABEL_KEY: Record<JobField, string> = {
  slug: 'campaignEditorJobSlug',
  title: 'campaignEditorJobTitle',
  city: 'campaignEditorJobCity',
  salary: 'campaignEditorJobSalary',
};

export interface EmailCampaignEditorProps {
  mode: 'new' | 'revision';
  initial: CampaignEditorForm;
}

export function EmailCampaignEditor({ mode, initial }: EmailCampaignEditorProps): React.JSX.Element {
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState<CampaignEditorForm>(initial);
  const [errors, setErrors] = React.useState<CampaignEditorErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [previewLocale, setPreviewLocale] = React.useState<Locale>(routing.locales[0]);
  const clientKey = React.useRef<string>('');
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const idBase = React.useId();

  const idOf = (key: string) => `${idBase}-${key.replace(/\./g, '-')}`;

  const clearError = (...keys: string[]) => {
    if (!keys.some((key) => errors[key])) return;
    setErrors((prev) => {
      const next = { ...prev };
      for (const key of keys) delete next[key];
      return next;
    });
  };

  const changeContent = (locale: Locale, jobs: CampaignEditorJob[]) => {
    // Zmiana treści = nowa operacja (nowy klucz przy kolejnym zapisie).
    clientKey.current = '';
    setForm((prev) => ({ ...prev, content: { ...prev.content, [locale]: jobs } }));
  };

  const setJobField = (locale: Locale, index: number, field: JobField, value: string) => {
    const jobs = form.content[locale].map((job, i) => (i === index ? { ...job, [field]: value } : job));
    changeContent(locale, jobs);
    clearError(jobFieldKey(locale, index, field), localeJobsKey(locale));
  };

  const addJob = (locale: Locale) => {
    changeContent(locale, [...form.content[locale], emptyCampaignJob()]);
    clearError(localeJobsKey(locale));
  };

  const removeJob = (locale: Locale, index: number) => {
    changeContent(
      locale,
      form.content[locale].filter((_job, i) => i !== index),
    );
    // Indeksy się przesuwają — błędy tego języka liczymy od nowa przy zapisie.
    setErrors((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(`${locale}.`))),
    );
  };

  const focusFirstError = (found: CampaignEditorErrors, current: CampaignEditorForm) => {
    const [first] = campaignEditorErrorOrder(current, found);
    if (!first) return;
    window.setTimeout(() => {
      const target = formRef.current?.querySelector<HTMLElement>(`[data-campaign-field="${first}"]`);
      target?.focus();
    }, 0);
  };

  const showErrors = (found: CampaignEditorErrors, current: CampaignEditorForm) => {
    setErrors(found);
    setFormError(t('campaignEditorHasErrors'));
    focusFirstError(found, current);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setNotice(null);
    const found = campaignEditorErrors(form);
    if (Object.keys(found).length > 0) {
      showErrors(found, form);
      return;
    }
    setErrors({});
    setFormError(null);
    if (!clientKey.current) clientKey.current = crypto.randomUUID();
    const current = form;
    startTransition(async () => {
      try {
        const res = await createEmailCampaignRevision(clientKey.current, current);
        if (res.ok) {
          if (res.demo || !res.id) {
            clientKey.current = '';
            setNotice(t('campaignEditorDemoNotSaved'));
            return;
          }
          router.push(`/admin/kampanie/${res.id}`);
          return;
        }
        if (res.fields && Object.keys(res.fields).length > 0) {
          showErrors(res.fields, current);
          return;
        }
        setFormError(tRoot(toUserMessageKey(res.error)));
      } catch {
        // Sieć: ponowienie z tym samym kluczem nie utworzy drugiej rewizji.
        setFormError(tRoot(toUserMessageKey('INTERNAL')));
      }
    });
  };

  const errorText = (key: string) => {
    const error = errors[key];
    if (!error) return null;
    return (
      <p id={`${idOf(key)}-error`} className={FORM_ERROR}>
        {t(CAMPAIGN_EDITOR_ERROR_KEY[error], { max: campaignEditorLimit(key) })}
      </p>
    );
  };

  const preview = campaignPreview(campaignContentFromForm(form));
  const previewEntry = preview.find((entry) => entry.locale === previewLocale) ?? preview[0]!;
  const slugHintId = `${idOf('slug')}-hint`;

  return (
    <form ref={formRef} noValidate onSubmit={submit} aria-busy={pending} className="min-w-0 space-y-[22px]">
      <section aria-labelledby={`${idBase}-slug-heading`} className={PANEL}>
        <div className={SECTION_HEAD}>
          <h2 id={`${idBase}-slug-heading`} className={PANEL_H2}>
            {t('campaignEditorSectionSlug')}
          </h2>
        </div>
        <div className={FORM_FIELD}>
          <label htmlFor={idOf('slug')} className={FORM_LABEL_TEXT}>
            {t('campaignEditorSlug')}
          </label>
          <input
            id={idOf('slug')}
            data-campaign-field="slug"
            type="text"
            value={form.slug}
            readOnly={mode === 'revision'}
            required
            maxLength={CAMPAIGN_SLUG_MAX + 20}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={errors.slug ? true : undefined}
            aria-describedby={[slugHintId, errors.slug ? `${idOf('slug')}-error` : null].filter(Boolean).join(' ')}
            onChange={(event) => {
              clientKey.current = '';
              setForm((prev) => ({ ...prev, slug: event.target.value }));
              clearError('slug');
            }}
            className={cn(FORM_CONTROL, mode === 'revision' && 'bg-soft')}
          />
          <p id={slugHintId} className={FORM_HINT}>
            {mode === 'revision' ? t('campaignEditorSlugFixedHint') : t('campaignEditorSlugHint')}
          </p>
          {errorText('slug')}
        </div>
      </section>

      {routing.locales.map((locale) => {
        const jobs = form.content[locale];
        const jobsKey = localeJobsKey(locale);
        const headingId = `${idBase}-${locale}-heading`;
        return (
          <section
            key={locale}
            aria-labelledby={headingId}
            aria-describedby={errors[jobsKey] ? `${idOf(jobsKey)}-error` : undefined}
            data-campaign-field={jobsKey}
            tabIndex={-1}
            className={cn(PANEL, 'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
          >
            <div className={SECTION_HEAD}>
              <h2 id={headingId} className={PANEL_H2}>
                {localeNames[locale]}
              </h2>
            </div>
            <p className={PANEL_P}>{t('campaignEditorLocaleHint')}</p>
            {errorText(jobsKey)}
            <div lang={locale} className="mt-4 space-y-5">
              {jobs.map((job, index) => (
                <fieldset key={index} className="min-w-0 space-y-4 rounded-[14px] border border-border p-4">
                  <legend className="px-1 text-sm font-semibold text-foreground">
                    {t('campaignEditorJobLegend', { number: index + 1 })}
                  </legend>
                  <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    {CAMPAIGN_JOB_FIELDS.map((field) => {
                      const key = jobFieldKey(locale, index, field);
                      return (
                        <div key={field} className={FORM_FIELD}>
                          <label htmlFor={idOf(key)} className={FORM_LABEL_TEXT}>
                            {t(FIELD_LABEL_KEY[field])}
                          </label>
                          <input
                            id={idOf(key)}
                            data-campaign-field={key}
                            type="text"
                            value={job[field]}
                            required={field !== 'salary'}
                            maxLength={CAMPAIGN_JOB_LIMITS[field] + 20}
                            autoComplete="off"
                            spellCheck={field === 'title' || field === 'city'}
                            aria-invalid={errors[key] ? true : undefined}
                            aria-describedby={errors[key] ? `${idOf(key)}-error` : undefined}
                            onChange={(event) => setJobField(locale, index, field, event.target.value)}
                            className={FORM_CONTROL}
                          />
                          {errorText(key)}
                        </div>
                      );
                    })}
                  </div>
                  {jobs.length > 1 ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => removeJob(locale, index)}
                      className={cn(BTN_SMALL, 'border-[color:var(--pp-line-btn)] text-foreground hover:bg-soft')}
                    >
                      {t('campaignEditorRemoveJob', { number: index + 1 })}
                    </button>
                  ) : null}
                </fieldset>
              ))}
            </div>
            {jobs.length < NEWSLETTER_JOBS_MAX ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => addJob(locale)}
                className={cn(BTN_SMALL, 'mt-4 border-[color:var(--pp-line-btn)] text-foreground hover:bg-soft')}
              >
                {t('campaignEditorAddJob', { language: localeNames[locale] })}
              </button>
            ) : null}
          </section>
        );
      })}

      <section aria-labelledby={`${idBase}-preview-heading`} className={PANEL}>
        <div className={SECTION_HEAD}>
          <h2 id={`${idBase}-preview-heading`} className={PANEL_H2}>
            {t('campaignSectionPreview')}
          </h2>
        </div>
        <p className={PANEL_P}>{t('campaignEditorPreviewHint')}</p>
        <div role="group" aria-label={t('campaignEditorPreviewLocales')} className="mt-4 flex flex-wrap gap-2">
          {routing.locales.map((locale) => (
            <button
              key={locale}
              type="button"
              aria-pressed={locale === previewLocale}
              onClick={() => setPreviewLocale(locale)}
              className={chipClass(locale === previewLocale)}
            >
              {localeNames[locale]}
            </button>
          ))}
        </div>
        <div className="mt-4">
          <CampaignPreviewCard
            entry={previewEntry}
            idPrefix={`${idBase}-preview`}
            invalidLabel={t('campaignPreviewInvalid')}
            demoLabel={t('campaignPreviewDemo')}
          />
        </div>
      </section>

      <div role="alert" className="min-h-0">
        {formError ? <p className={cn(FORM_ERROR, 'font-semibold')}>{formError}</p> : null}
      </div>
      <div role="status" className="min-h-0">
        {notice ? <p className={PANEL_P}>{notice}</p> : null}
      </div>

      <button type="submit" disabled={pending} className={BTN_PRIMARY}>
        {pending ? t('confirmSaving') : t('campaignEditorSave')}
      </button>
    </form>
  );
}
