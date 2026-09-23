import { isLocale, type Locale } from '@/i18n/routing';

/**
 * Dane szablonu dla wiersza kolejki `email_deliveries` (czysta funkcja, bez I/O — testowalna).
 *
 * #290: przyciski CTA prowadzą do sekcji panelu, której dotyczy wiadomość (propozycje,
 * zgłoszenia, właściwy wątek), a NIE na ogólny pulpit. Prefiks języka w URL = locale ODBIORCY
 * (kolumna `locale`, wyznaczona w DB wg INVARIANTU #1) — nigdy język nadawcy.
 *
 * #294: powitanie z imieniem odbiorcy (z `profiles.first_name`, odczytane przez workera), o ile
 * RPC nie przekazało własnego.
 */

export interface DeliveryInput {
  template: string;
  locale: string;
  payload: Record<string, unknown> | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Locale odbiorcy z wiersza kolejki; wartość spoza obsługiwanych → 'en' (fallback INVARIANTU #1). */
export function deliveryLocale(value: string): Locale {
  return isLocale(value) ? value : 'en';
}

/** Ścieżka (bez prefiksu locale) sekcji panelu, do której prowadzi CTA danego typu maila. */
export function emailTargetPath(template: string, payload: Record<string, unknown> | null): string {
  switch (template) {
    case 'jobOffer':
      return '/candidate/propozycje';
    case 'statusChanged':
    case 'applicationViewed':
      return '/candidate/aplikacje';
    case 'newApplication':
    case 'offerAccepted':
      return '/employer/aplikacje';
    case 'offerDeclined':
      return '/employer/kandydaci';
    case 'newMessage': {
      const panel = payload?.['panel'] === 'employer' ? 'employer' : 'candidate';
      const conversationId = payload?.['conversationId'];
      const query =
        typeof conversationId === 'string' && UUID_RE.test(conversationId)
          ? `?c=${conversationId}`
          : '';
      return `/${panel}/wiadomosci${query}`;
    }
    default:
      return payload?.['panel'] === 'employer' ? '/employer' : '/candidate';
  }
}

/** Buduje dane do `renderEmail` dla wiersza kolejki. */
export function buildDeliveryData(
  row: DeliveryInput,
  site: string,
  recipientFirstName?: string | null,
): { locale: Locale; data: Record<string, unknown> } {
  const locale = deliveryLocale(row.locale);
  const payload = row.payload ?? {};
  const url = `${site.replace(/\/+$/, '')}/${locale}${emailTargetPath(row.template, payload)}`;
  const firstName = recipientFirstName?.trim() || undefined;

  return {
    locale,
    data: {
      firstName,
      recipientName: firstName,
      ...payload,
      applicationUrl: url,
      offerUrl: url,
      actionUrl: url,
      messageUrl: url,
    },
  };
}
