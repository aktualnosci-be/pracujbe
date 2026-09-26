/**
 * Reguły treści oferty w newsletterze (#45) — jedno źródło dla workera
 * (`assertRenderableJobs` w `src/emails/newsletter.tsx`) i edytora kampanii w panelu admina
 * (`src/lib/admin/campaign-editor.ts`); lustro w bazie: `email_campaign_jobs_renderable`
 * (migracja 0202). Czyste funkcje, bez zależności serwerowych (działa w przeglądarce).
 */

export const NEWSLETTER_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const NEWSLETTER_PLACEHOLDER_PATTERN = /\{\{[^}]+\}\}/;

/** Liczba ofert w jednym liście (CHECK `email_campaign_content_ok`, 0101). */
export const NEWSLETTER_JOBS_MIN = 1;
export const NEWSLETTER_JOBS_MAX = 3;

export type NewsletterJobField = 'slug' | 'title' | 'city' | 'salary';
export type NewsletterJobIssue = 'required' | 'slug' | 'placeholder';

export interface NewsletterJobText {
  slug: string;
  title: string;
  city: string;
  salary?: string;
}

const FIELDS: readonly NewsletterJobField[] = ['slug', 'title', 'city', 'salary'];

/**
 * Problemy pól jednej oferty, których worker nie wyrenderuje (pierwszy problem na pole):
 * pusty slug/tytuł/miasto, slug spoza wzorca, placeholder `{{…}}` w dowolnym polu.
 * Pusty obiekt = oferta poprawna.
 */
export function newsletterJobIssues(
  job: NewsletterJobText,
): Partial<Record<NewsletterJobField, NewsletterJobIssue>> {
  const issues: Partial<Record<NewsletterJobField, NewsletterJobIssue>> = {};
  for (const field of FIELDS) {
    const value = job[field] ?? '';
    if (field !== 'salary' && value.trim().length === 0) issues[field] = 'required';
    else if (field === 'slug' && !NEWSLETTER_SLUG_PATTERN.test(value)) issues[field] = 'slug';
    else if (NEWSLETTER_PLACEHOLDER_PATTERN.test(value)) issues[field] = 'placeholder';
  }
  return issues;
}
