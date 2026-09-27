/**
 * Podgląd treści rewizji kampanii e-mail (#45) — czysty moduł bez zależności serwerowych:
 * szczegół rewizji (`/admin/kampanie/[id]`) i edytor (`EmailCampaignEditor`, przeglądarka)
 * budują podgląd tą samą funkcją.
 */

import type { NewsletterJob } from '@/emails/newsletter';
import { routing, type Locale } from '@/i18n/routing';
import { newsletterJobsFromPayload } from '@/lib/email/newsletter-delivery';
import { newsletterJobIssues } from '@/lib/email/newsletter-rules';

export type CampaignLocalePreview =
  | { locale: Locale; status: 'ok'; jobs: NewsletterJob[] }
  | { locale: Locale; status: 'invalid' };

/**
 * Treść rewizji (`{ "<język>": { "jobs": [...] } }`) → podgląd w KAŻDYM języku serwisu.
 * Kształt sprawdza ta sama funkcja co worker (`newsletterJobsFromPayload`), a pola — te same
 * reguły co `assertRenderableJobs` (`newsletterJobIssues`), więc „niepoprawna” w podglądzie =
 * list, którego worker nie wyrenderuje.
 */
export function campaignPreview(content: unknown): CampaignLocalePreview[] {
  const byLocale =
    typeof content === 'object' && content !== null ? (content as Record<string, unknown>) : {};
  return routing.locales.map((locale) => {
    const entry = byLocale[locale];
    const payload =
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null;
    try {
      const jobs = newsletterJobsFromPayload(payload, locale);
      if (jobs.length === 0) return { locale, status: 'invalid' };
      // Pola, których worker nie wyrenderuje (`assertRenderableJobs`): pusty tytuł/miasto,
      // zły slug, placeholder. Oferta demo zostaje widoczna z etykietą (dane DEMO panelu).
      if (jobs.some((job) => Object.keys(newsletterJobIssues(job)).length > 0)) {
        return { locale, status: 'invalid' };
      }
      return { locale, status: 'ok', jobs };
    } catch {
      return { locale, status: 'invalid' };
    }
  });
}
