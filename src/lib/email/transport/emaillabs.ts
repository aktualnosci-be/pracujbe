import { MailSendError, type MailMessage, type MailTransport } from './types';

/**
 * Transport EmailLabs (REST API v2.1, https://apidocs.emaillabs.io).
 *
 * - Wysyłka: `POST {base}/v2.1/email`, JSON, nagłówki `Application-Key` (klucz aplikacji)
 *   i `Authorization` (klucz autoryzacyjny, 128 znaków) z panelu: Konto → Ustawienia → API.
 * - `smtpAccount` (np. `1.pracujbe.smtp`) — konto SMTP w panelu, na którym ustawia się też
 *   domenę nadawcy, DKIM/SPF i wyłączenie open trackingu.
 * - Śledzenie linków wyłączamy w każdym wywołaniu nagłówkiem `X-TRACKING-OFF: 1` (jedyna
 *   opcja dostępna w API). Open tracking jest ustawieniem konta SMTP — patrz
 *   docs/EMAILLABS_SETUP.md.
 * - Identyfikator wiadomości nadajemy SAMI: `to[].messageId = <UUID wiersza>@<domena From>`.
 *   Ten sam identyfikator wraca w odpowiedzi i w webhookach doręczeń (`to.messageId`), więc
 *   zapisujemy go jako `provider_message_id`. ACK tylko, gdy odpowiedź 200 zawiera ten
 *   identyfikator.
 * - Idempotencja: EmailLabs nie ma nagłówka `Idempotency-Key`. Przed każdą wysyłką
 *   sprawdzamy `GET {base}/v2.1/email?messageId=…` — jeśli list o tym identyfikatorze już
 *   istnieje (poprzednia próba została przyjęta, a zapis ACK się nie udał), potwierdzamy go
 *   bez ponownej wysyłki. Błąd tego sprawdzenia = `provider_unavailable` (lepiej ponowić
 *   później niż ryzykować duplikat). Klucz API musi mieć prawo odczytu statusów.
 */

export const EMAILLABS_API_BASE = 'https://api.emaillabs.io';
const SUBJECT_MAX = 128;
const NAME_MIN = 2;
const NAME_MAX = 64;
const REQUEST_TIMEOUT_MS = 10_000;

export interface EmailLabsConfig {
  appKey: string;
  secretKey: string;
  smtpAccount: string;
  /** Tylko testy (atrapa HTTP); produkcja zawsze `EMAILLABS_API_BASE`. */
  baseUrl?: string;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** `Nazwa <adres@domena>` albo sam adres → części EmailLabs; `null` = zły zapis. */
export function parseMailbox(value: string): { email: string; name?: string } | null {
  const trimmed = value.trim();
  const match = /^(.*)<([^<>\s]+@[^<>\s]+)>$/.exec(trimmed);
  const email = (match?.[2] ?? trimmed).trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return null;
  const rawName = (match?.[1] ?? '').trim().replace(/^"(.*)"$/, '$1').trim();
  const name = rawName.length >= NAME_MIN ? rawName.slice(0, NAME_MAX) : undefined;
  return name ? { email, name } : { email };
}

/** Identyfikator wiadomości EmailLabs dla wiersza kolejki (stabilny między ponowieniami). */
export function emailLabsMessageId(idempotencyKey: string, fromEmail: string): string {
  const domain = fromEmail.slice(fromEmail.lastIndexOf('@') + 1).toLowerCase();
  return `${idempotencyKey}@${domain}`;
}

function truncateSubject(subject: string): string {
  const chars = [...subject];
  return chars.length <= SUBJECT_MAX ? subject : `${chars.slice(0, SUBJECT_MAX - 1).join('')}…`;
}

/** Treść żądania `POST /v2.1/email` (eksport dla testów kontraktu). */
export function emailLabsPayload(
  message: MailMessage,
  messageId: string,
  smtpAccount: string,
): Record<string, unknown> {
  const from = parseMailbox(message.from);
  if (!from) throw new MailSendError('delivery_failed');
  return {
    subject: truncateSubject(message.subject),
    smtpAccount,
    from,
    to: [{ email: message.to, messageId }],
    content: { html: message.html, text: message.text },
    headers: { ...(message.headers ?? {}), 'X-TRACKING-OFF': '1' },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Czy odpowiedź 200 wysyłki zawiera nasz identyfikator wiadomości (warunek ACK). */
export function responseHasMessageId(body: unknown, messageId: string): boolean {
  if (!isRecord(body) || !Array.isArray(body['data'])) return false;
  return body['data'].some((item) =>
    isRecord(item) && Array.isArray(item['to']) &&
    item['to'].some((to) => isRecord(to) && to['messageId'] === messageId));
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** 429, 5xx i błędy uwierzytelnienia (konfiguracja, nie odbiorca) = ponowić; reszta = odrzucenie. */
function sendErrorFor(status: number): MailSendError {
  const retryable = status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
  return new MailSendError(retryable ? 'provider_unavailable' : 'delivery_failed');
}

/** Limit pojedynczego żądania albo wcześniejszy termin workera — co nastąpi pierwsze. */
function requestSignal(deadline?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // Timer nie trzyma procesu przy życiu (worker kończy się po paczce).
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  deadline?.addEventListener('abort', () => controller.abort(), { once: true });
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller.signal;
}

export function emailLabsTransport(config: EmailLabsConfig, fetchImpl: FetchLike = fetch): MailTransport {
  const base = (config.baseUrl ?? EMAILLABS_API_BASE).replace(/\/$/, '');
  const authHeaders = {
    'Application-Key': config.appKey,
    Authorization: config.secretKey,
  };

  async function call(url: string, init: RequestInit, deadline?: AbortSignal): Promise<Response> {
    // #628: termin wysyłki workera przerywa też trwające żądanie (nie tylko limit pojedynczego).
    if (deadline?.aborted) throw new MailSendError('provider_unavailable');
    const signal = requestSignal(deadline);
    try {
      return await fetchImpl(url, {
        ...init,
        headers: { ...authHeaders, Accept: 'application/json', ...(init.headers ?? {}) },
        redirect: 'error',
        signal,
      });
    } catch {
      // Sieć, timeout, przekierowanie — bez szczegółów (URL i nagłówki zawierają klucze).
      throw new MailSendError('provider_unavailable');
    }
  }

  /** `true` = list o tym identyfikatorze już jest u dostawcy (poprzednia próba przyjęta). */
  async function alreadyAccepted(messageId: string, deadline?: AbortSignal): Promise<boolean> {
    const query = new URLSearchParams({ messageId, smtpAccount: config.smtpAccount, limit: '1' });
    const response = await call(`${base}/v2.1/email?${query.toString()}`, { method: 'GET' }, deadline);
    // 404 = zapytanie poprawne, brak wyników (kontrakt API EmailLabs).
    if (response.status === 404) return false;
    if (response.status !== 200) throw new MailSendError('provider_unavailable');
    const body = await readJson(response);
    if (!isRecord(body) || !Array.isArray(body['data'])) throw new MailSendError('provider_unavailable');
    return body['data'].length > 0;
  }

  return {
    provider: 'emaillabs',
    async send(message, options) {
      const from = parseMailbox(message.from);
      if (!from) throw new MailSendError('delivery_failed');
      const messageId = emailLabsMessageId(options.idempotencyKey, from.email);
      if (await alreadyAccepted(messageId, options.signal)) return { id: messageId };

      const response = await call(`${base}/v2.1/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emailLabsPayload(message, messageId, config.smtpAccount)),
      }, options.signal);
      // 207 = część elementów odrzucona walidacją — przy jednym odbiorcy to odrzucenie listu.
      if (response.status !== 200) throw sendErrorFor(response.status);
      const body = await readJson(response);
      // Bez identyfikatora wiadomości w odpowiedzi nie potwierdzamy wysyłki; ponowienie
      // sprawdzi najpierw, czy list o tym identyfikatorze już istnieje.
      if (!responseHasMessageId(body, messageId)) throw new MailSendError('provider_unavailable');
      return { id: messageId };
    },
  };
}
