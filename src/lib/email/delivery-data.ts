import { isLocale, type Locale } from '@/i18n/routing';
import { formatSalaryRange, type SalaryInput } from '@/lib/salary';
import { ACCESS_CODE_RE, CASE_NUMBER_RE } from '@/lib/validation/content-report';
import { salaryLabelsFor } from '@/lib/salary-labels';
import { buildMessageExcerpt } from '@/lib/email/message-excerpt';
import { minimizeEmailPayload } from '@/lib/email/payload-fields';

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
    case 'moderationJobRemoved':
    case 'moderationCompanySuspended':
    case 'moderationRestored':
      return '/employer/firma';
    case 'appealReceived':
    case 'appealUpheld':
    case 'appealReversed':
      // #43: autor wraca do danych firmy, zgłaszający — na stronę sprawy.
      return payload?.['appellantRole'] === 'author' ? '/employer/firma' : '/zglos-tresc/sprawa';
    case 'reportDecisionActioned':
    case 'reportDecisionNoAction':
    case 'reportRestored':
      // #42: bez kodu dostępu (baza zna tylko jego skrót) — zgłaszający wpisuje go sam.
      return '/zglos-tresc/sprawa';
    case 'teamInvitation':
      return '/employer/zespol';
    case 'supportContact':
      // #61: nadawca (często bez konta) — strona Pomoc, nie panel.
      return '/pomoc';
    case 'contactMessageAdmin':
      return '/admin/kontakt';
    case 'teamInvitationSignup':
      return '/rejestracja-pracodawca';
    case 'jobMatch':
      return '/candidate/wyszukiwania';
    case 'guestApplicationConfirm':
      return '/aplikacja/potwierdz';
    case 'guestApplicationSent':
      return '/aplikacja/przejmij';
    case 'guestStatusChanged':
      // Gość nie ma panelu; e-mail bez tokenu — CTA prowadzi do listy ofert.
      return '/oferty-pracy';
    case 'reportReceived': {
      // #41: numer sprawy i kod dostępu w części `#` (nie trafia do serwera ani logów).
      const caseNumber = payload?.['caseNumber'];
      const accessCode = payload?.['accessCode'];
      const fragment =
        typeof caseNumber === 'string' &&
        CASE_NUMBER_RE.test(caseNumber) &&
        typeof accessCode === 'string' &&
        ACCESS_CODE_RE.test(accessCode)
          ? `#nr=${caseNumber}&kod=${accessCode}`
          : '';
      return `/zglos-tresc/sprawa${fragment}`;
    }
    case 'inactiveCvWarning':
    case 'inactiveAccountWarning':
      // #574: logowanie tworzy sesję → last_seen_at (0127) → ostrzeżenie traci ważność.
      return '/logowanie';
    case 'breachNotice':
      // #490: ustawienia konta odbiorcy (panel z roli w payloadzie RPC).
      return payload?.['panel'] === 'employer' ? '/employer/ustawienia' : '/candidate/ustawienia';
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

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,159}$/i;

/**
 * #100: oferty digestu `jobMatch` z payloadu → adresy szczegółu w locale ODBIORCY. Slug
 * spoza wzorca (albo brak) → oferta pominięta; najwyżej 5 pozycji. Adres buduje worker —
 * payload nie podaje gotowych URL-i.
 */
export function deliveryJobMatchJobs(
  payload: Record<string, unknown>,
  base: string,
  locale: Locale,
): Array<{ title: string; companyName?: string; city?: string; url: string }> {
  const raw = Array.isArray(payload['jobs']) ? (payload['jobs'] as unknown[]) : [];
  const out: Array<{ title: string; companyName?: string; city?: string; url: string }> = [];
  for (const item of raw) {
    if (out.length >= 5) break;
    const r = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    const slug = typeof r['slug'] === 'string' ? r['slug'] : '';
    const title = typeof r['title'] === 'string' ? r['title'].trim() : '';
    if (!SLUG_RE.test(slug) || !title) continue;
    out.push({
      title,
      ...(typeof r['companyName'] === 'string' && r['companyName'] ? { companyName: r['companyName'] } : {}),
      ...(typeof r['city'] === 'string' && r['city'] ? { city: r['city'] } : {}),
      url: `${base}/${locale}/oferty-pracy/${slug}`,
    });
  }
  return out;
}

/**
 * Szablony z linkiem niosącym jednorazowy token, którego nie ma w bazie: gość (#98) i
 * zaproszenie do zespołu dla adresu bez konta (0121).
 */
export const GUEST_TOKEN_TEMPLATES: ReadonlySet<string> = new Set([
  'guestApplicationConfirm',
  'guestApplicationSent',
  'teamInvitationSignup',
]);

/**
 * Buduje dane do `renderEmail` dla wiersza kolejki (payload po minimalizacji, #503).
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
  // #503: do szablonu (i dostawcy poczty) trafiają tylko pola z listy dozwolonych dla typu;
  // `nonce` gościa nigdy (token liczy worker osobno).
  const payload = minimizeEmailPayload(row.template, row.payload);
  // #503 (decyzja 26.09.2026): cytat wiadomości rekrutera — zawsze ponownie oczyszczony i
  // obcięty, niezależnie od tego, kto go dołożył (worker z `offers.message` albo payload).
  if (Object.hasOwn(payload, 'messageExcerpt')) {
    const excerpt = buildMessageExcerpt(payload['messageExcerpt']);
    if (excerpt) payload['messageExcerpt'] = excerpt;
    else delete payload['messageExcerpt'];
  }
  const isGuest = GUEST_TOKEN_TEMPLATES.has(row.template);
  if (isGuest && !guestToken) throw new Error('guest_token_unavailable');
  // Fragment stays out of HTTP request targets and proxy logs. The landing page clears it
  // before exchanging the token for a short-lived HttpOnly cookie via POST.
  const fragment = isGuest ? `#token=${encodeURIComponent(guestToken ?? '')}` : '';
  const base = site.replace(/\/+$/, '');
  const url = `${base}/${locale}${emailTargetPath(row.template, payload)}${fragment}`;
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
      ...(row.template === 'jobMatch' ? { jobs: deliveryJobMatchJobs(payload, base, locale) } : {}),
    },
  };
}
