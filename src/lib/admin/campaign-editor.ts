/**
 * Edytor rewizji kampanii e-mail w panelu admina (#45, `/admin/kampanie/nowa`,
 * `/admin/kampanie/[id]/nowa-rewizja`) — czyste reguły, bez DB (działa w przeglądarce
 * i w Server Action).
 *
 *   - formularz: slug + w KAŻDYM języku serwisu 1–3 oferty (slug, tytuł, miasto, stawka),
 *   - treść rewizji = dokładnie kształt, który czyta worker (`newsletterJobsFromPayload`):
 *     `{ "<język>": { "jobs": [{ locale, slug, title, city, salary?, isDemo: false }] } }`,
 *   - walidacja pól: reguły workera (`newsletterJobIssues`, jedno źródło z
 *     `assertRenderableJobs`) + limity długości (lustro `email_campaign_jobs_renderable`, 0202),
 *     a na końcu ta sama funkcja co podgląd (`campaignPreview`). Brak treści w którymś języku =
 *     błąd przy konkretnym polu (Invariant #1: list idzie w języku odbiorcy).
 */

import { routing, type Locale } from '@/i18n/routing';
import { campaignPreview } from '@/lib/admin/campaign-preview';
import {
  NEWSLETTER_JOBS_MAX,
  NEWSLETTER_JOBS_MIN,
  NEWSLETTER_SLUG_PATTERN,
  newsletterJobIssues,
  type NewsletterJobField,
} from '@/lib/email/newsletter-rules';

/** Slug kampanii (CHECK `email_campaigns_slug`, 0101). */
export const CAMPAIGN_SLUG_MAX = 80;

/** Limity pól oferty — te same w `email_campaign_jobs_renderable` (0202). */
export const CAMPAIGN_JOB_LIMITS: Record<NewsletterJobField, number> = {
  slug: 200,
  title: 160,
  city: 100,
  salary: 60,
};

export const CAMPAIGN_JOB_FIELDS: readonly NewsletterJobField[] = ['slug', 'title', 'city', 'salary'];

export interface CampaignEditorJob {
  slug: string;
  title: string;
  city: string;
  salary: string;
}

export interface CampaignEditorForm {
  slug: string;
  content: Record<Locale, CampaignEditorJob[]>;
}

export type CampaignEditorError =
  | 'required'
  | 'slug'
  | 'placeholder'
  | 'tooLong'
  | 'jobsCount'
  | 'invalid';

/** Klucze: `slug`, `<język>.jobs`, `<język>.<indeks>.<pole>`. */
export type CampaignEditorErrors = Partial<Record<string, CampaignEditorError>>;

/** Błąd → klucz i18n (namespace `admin`). */
export const CAMPAIGN_EDITOR_ERROR_KEY: Record<CampaignEditorError, string> = {
  required: 'campaignEditorErrorRequired',
  slug: 'campaignEditorErrorSlug',
  placeholder: 'campaignEditorErrorPlaceholder',
  tooLong: 'campaignEditorErrorTooLong',
  jobsCount: 'campaignEditorErrorJobsCount',
  invalid: 'campaignEditorErrorInvalid',
};

export function jobFieldKey(locale: Locale, index: number, field: NewsletterJobField): string {
  return `${locale}.${index}.${field}`;
}

export function localeJobsKey(locale: Locale): string {
  return `${locale}.jobs`;
}

export function emptyCampaignJob(): CampaignEditorJob {
  return { slug: '', title: '', city: '', salary: '' };
}

export function emptyCampaignForm(slug = ''): CampaignEditorForm {
  const content = {} as Record<Locale, CampaignEditorJob[]>;
  for (const locale of routing.locales) content[locale] = [emptyCampaignJob()];
  return { slug, content };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Treść istniejącej rewizji → formularz nowej rewizji (ten sam slug). Brak/nieczytelny język
 * = jedna pusta oferta (admin musi ją uzupełnić). `isDemo` nie jest polem formularza — nowa
 * treść zawsze zapisuje `isDemo: false` (worker nie wyśle oferty demonstracyjnej).
 */
export function campaignFormFromContent(slug: string, content: unknown): CampaignEditorForm {
  const form = emptyCampaignForm(slug);
  const byLocale =
    typeof content === 'object' && content !== null ? (content as Record<string, unknown>) : {};
  for (const locale of routing.locales) {
    const entry = byLocale[locale];
    const jobs =
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>).jobs : null;
    if (!Array.isArray(jobs) || jobs.length === 0) continue;
    form.content[locale] = jobs.slice(0, NEWSLETTER_JOBS_MAX).map((item: unknown) => {
      const job = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
      return { slug: text(job.slug), title: text(job.title), city: text(job.city), salary: text(job.salary) };
    });
  }
  return form;
}

/** Formularz → treść rewizji w kształcie workera (wartości przycięte, pusta stawka pominięta). */
export function campaignContentFromForm(form: CampaignEditorForm): Record<Locale, { jobs: unknown[] }> {
  const content = {} as Record<Locale, { jobs: unknown[] }>;
  for (const locale of routing.locales) {
    content[locale] = {
      jobs: (form.content[locale] ?? []).map((job) => {
        const salary = job.salary.trim();
        return {
          locale,
          slug: job.slug.trim(),
          title: job.title.trim(),
          city: job.city.trim(),
          ...(salary ? { salary } : {}),
          isDemo: false,
        };
      }),
    };
  }
  return content;
}

/** Błędy formularza (pusty obiekt = można zapisać). */
export function campaignEditorErrors(form: CampaignEditorForm): CampaignEditorErrors {
  const errors: CampaignEditorErrors = {};
  const slug = form.slug.trim();
  if (!slug) errors.slug = 'required';
  else if (slug.length > CAMPAIGN_SLUG_MAX) errors.slug = 'tooLong';
  else if (!NEWSLETTER_SLUG_PATTERN.test(slug)) errors.slug = 'slug';

  for (const locale of routing.locales) {
    const jobs = form.content[locale] ?? [];
    if (jobs.length < NEWSLETTER_JOBS_MIN || jobs.length > NEWSLETTER_JOBS_MAX) {
      errors[localeJobsKey(locale)] = 'jobsCount';
      continue;
    }
    jobs.forEach((job, index) => {
      const trimmed = {
        slug: job.slug.trim(),
        title: job.title.trim(),
        city: job.city.trim(),
        salary: job.salary.trim(),
      };
      const issues = newsletterJobIssues(trimmed);
      for (const field of CAMPAIGN_JOB_FIELDS) {
        const issue = trimmed[field].length > CAMPAIGN_JOB_LIMITS[field] ? 'tooLong' : issues[field];
        if (issue) errors[jobFieldKey(locale, index, field)] = issue;
      }
    });
  }

  // Ta sama funkcja co podgląd i worker: język, którego nie da się wyrenderować, bez błędu pola.
  for (const entry of campaignPreview(campaignContentFromForm(form))) {
    const hasFieldError = Object.keys(errors).some((key) => key.startsWith(`${entry.locale}.`));
    if (entry.status === 'invalid' && !hasFieldError) errors[localeJobsKey(entry.locale)] = 'invalid';
  }
  return errors;
}

/** Klucze błędów w kolejności formularza (fokus na pierwszym błędzie). */
export function campaignEditorErrorOrder(form: CampaignEditorForm, errors: CampaignEditorErrors): string[] {
  const order = ['slug'];
  for (const locale of routing.locales) {
    order.push(localeJobsKey(locale));
    (form.content[locale] ?? []).forEach((_job, index) => {
      for (const field of CAMPAIGN_JOB_FIELDS) order.push(jobFieldKey(locale, index, field));
    });
  }
  return order.filter((key) => errors[key]);
}

/** Limit dla komunikatu `tooLong` przy danym kluczu. */
export function campaignEditorLimit(key: string): number {
  if (key === 'slug') return CAMPAIGN_SLUG_MAX;
  const field = key.split('.')[2] as NewsletterJobField | undefined;
  return field && field in CAMPAIGN_JOB_LIMITS ? CAMPAIGN_JOB_LIMITS[field] : CAMPAIGN_SLUG_MAX;
}
