import { isLocale, type Locale } from '@/i18n/routing';
import { formatSalaryRange, type SalaryInput } from '@/lib/salary';
import { salaryLabelsFor } from '@/lib/salary-labels';

/**
 * Dane szablonu dla wiersza kolejki `email_deliveries` (czysta funkcja, bez I/O — testowalna).
 *
 * #290: przyciski CTA prowadzą do sekcji panelu, której dotyczy wiadomość (propozycje,
 * zgłoszenia, właściwy wątek), a NIE na ogólny pulpit. Prefiks języka w URL = locale ODBIORCY
 * (kolumna `locale`, wyznaczona w DB wg INVARIANTU #1) — nigdy język nadawcy.
 *
 * #294: powitanie z imieniem odbiorcy (z `profiles.first_name`, odczytane przez workera), o ile
 * RPC nie przekazało własnego.
 *
 * #22: wynagrodzenie w e-mailu buduje ten sam formatter co karta i szczegół oferty, w locale
 * ODBIORCY — z kwot w payloadzie (`salaryMin`/`salaryMax`/`salaryPeriod`/`currency`), a nie
 * z gotowego tekstu nadawcy. Payload bez kwot → pole wynagrodzenia pominięte.
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
    case 'jobPublished':
      return '/employer/oferty';
    case 'companyVerified':
    case 'companyRejected':
    case 'companySuspended':
      return '/employer/firma';
    case 'teamInvitation':
      return '/employer/zespol';
    case 'guestApplicationConfirm':
      return '/aplikacja/potwierdz';
    case 'guestApplicationSent':
      return '/aplikacja/przejmij';
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

const numberOrUndefined = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : undefined;

/** Tekst wynagrodzenia w locale odbiorcy z kwot w payloadzie albo `undefined`. */
export function deliverySalary(payload: Record<string, unknown>, locale: Locale): string | undefined {
  const period = payload['salaryPeriod'];
  const input: SalaryInput = {
    salaryMin: numberOrUndefined(payload['salaryMin']),
    salaryMax: numberOrUndefined(payload['salaryMax']),
    currency: typeof payload['currency'] === 'string' ? payload['currency'] : undefined,
    salaryPeriod: period === 'hour' || period === 'month' || period === 'year' ? period : undefined,
  };
  return formatSalaryRange(input, locale, salaryLabelsFor(locale)) ?? undefined;
}

/** Szablony do gościa (#98): link niesie jednorazowy token, którego nie ma w bazie. */
export const GUEST_TOKEN_TEMPLATES: ReadonlySet<string> = new Set([
  'guestApplicationConfirm',
  'guestApplicationSent',
]);

/**
 * Buduje dane do `renderEmail` dla wiersza kolejki.
 *
 * #98: dla szablonów gościa `guestToken` (liczony przez workera z `nonce` i sekretu serwera)
 * trafia do adresu CTA; `nonce` nie trafia do danych szablonu. Brak tokenu = błąd (worker
 * ponowi wysyłkę), a nie e-mail z niedziałającym linkiem.
 */
export function buildDeliveryData(
  row: DeliveryInput,
  site: string,
  recipientFirstName?: string | null,
  guestToken?: string | null,
): { locale: Locale; data: Record<string, unknown> } {
  const locale = deliveryLocale(row.locale);
  const { nonce: _nonce, ...payload } = row.payload ?? {};
  const isGuest = GUEST_TOKEN_TEMPLATES.has(row.template);
  if (isGuest && !guestToken) throw new Error('guest_token_unavailable');
  const query = isGuest ? `?token=${encodeURIComponent(guestToken ?? '')}` : '';
  const url = `${site.replace(/\/+$/, '')}/${locale}${emailTargetPath(row.template, payload)}${query}`;
  const firstName = recipientFirstName?.trim() || undefined;
  const salary = deliverySalary(payload, locale);

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
      jobUrl: url,
      salary,
    },
  };
}
