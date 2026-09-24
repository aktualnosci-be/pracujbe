import type { NewsletterJob } from '@/emails/newsletter';
import type { Locale } from '@/i18n/routing';

/**
 * Oferty newslettera z payloadu kolejki (#45). Payload buduje `enqueue_campaign_batch`
 * z treści rewizji kampanii w języku odbiorcy; tu tylko kontrola kształtu (czysta funkcja).
 * Reguły treści (1–3 oferty, bez demo, język = język listu, bez placeholderów) sprawdza
 * `assertRenderableJobs` przy renderowaniu. Zły kształt = błąd wiersza (ponowienie), nigdy
 * list z pustą treścią.
 */
export function newsletterJobsFromPayload(
  payload: Record<string, unknown> | null,
  locale: Locale,
): NewsletterJob[] {
  const raw = payload?.jobs;
  if (!Array.isArray(raw)) throw new Error('newsletter_payload_invalid');
  return raw.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) throw new Error('newsletter_payload_invalid');
    const job = item as Record<string, unknown>;
    const { slug, title, city, salary, isDemo } = job;
    if (
      typeof slug !== 'string' ||
      typeof title !== 'string' ||
      typeof city !== 'string' ||
      (salary !== undefined && salary !== null && typeof salary !== 'string') ||
      typeof isDemo !== 'boolean' ||
      job.locale !== locale
    ) {
      throw new Error('newsletter_payload_invalid');
    }
    return {
      locale,
      slug,
      title,
      city,
      ...(typeof salary === 'string' ? { salary } : {}),
      isDemo,
    };
  });
}
