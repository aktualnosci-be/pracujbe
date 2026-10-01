/**
 * Oferty kampanii e-mail niedostępne publicznie (#720, migracja 0954). Baza odrzuca zapis
 * i aktywację rewizji, w której slug oferty nie wskazuje aktywnej, nieusuniętej, niewygasłej,
 * niedemonstracyjnej oferty zweryfikowanej firmy: `CAMPAIGN_JOB_UNAVAILABLE: slug1,slug2`
 * (`email_campaign_unavailable_slugs`). Tu tylko odczyt tego komunikatu i przypięcie błędu
 * do pól formularza edytora — czyste funkcje.
 */

import { routing } from '@/i18n/routing';
import { jobFieldKey, type CampaignEditorErrors, type CampaignEditorForm } from '@/lib/admin/campaign-editor';
import { NEWSLETTER_SLUG_PATTERN } from '@/lib/email/newsletter-rules';

const PREFIX = 'CAMPAIGN_JOB_UNAVAILABLE:';

/** Slugi z komunikatu bazy; `null` = to nie jest błąd niedostępnej oferty. */
export function parseUnavailableJobSlugs(message: string): string[] | null {
  const at = message.indexOf(PREFIX);
  if (at < 0) return null;
  const rest = message.slice(at + PREFIX.length).split(/\s/).find((part) => part.length > 0) ?? '';
  return rest.split(',').filter((slug) => NEWSLETTER_SLUG_PATTERN.test(slug));
}

/** Błąd `unavailable` przy każdym polu sluga oferty z listy (w każdym języku). */
export function unavailableJobFieldErrors(form: CampaignEditorForm, slugs: readonly string[]): CampaignEditorErrors {
  const set = new Set(slugs);
  const errors: CampaignEditorErrors = {};
  for (const locale of routing.locales) {
    (form.content[locale] ?? []).forEach((job, index) => {
      if (set.has(job.slug.trim())) errors[jobFieldKey(locale, index, 'slug')] = 'unavailable';
    });
  }
  return errors;
}
