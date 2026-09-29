/**
 * Tożsamość nadawcy e-maili (#45).
 *
 * Wiadomość marketingowa (kategoria `marketing`, np. newsletter) wychodzi WYŁĄCZNIE ze
 * skonfigurowaną tożsamością: jawny adres `EMAIL_FROM`, nazwa nadawcy `EMAIL_SENDER_IDENTITY`
 * i adres pocztowy `EMAIL_SENDER_POSTAL_ADDRESS`. Kod niczego nie uzupełnia za operatora —
 * brak którejkolwiek wartości = brak wysyłki marketingowej. Pozostałe e-maile pokazują
 * tożsamość w stopce, gdy jest skonfigurowana.
 */

export const DEFAULT_EMAIL_FROM = 'Pracuj.be <no-reply@pracuj.be>';

/** Limit długości wartości ze środowiska (stopka ma być krótka, bez treści z zewnątrz). */
const MAX_LENGTH = 300;

export interface EmailSenderIdentity {
  /** Nazwa podmiotu wysyłającego (np. firma prowadząca serwis). */
  identity: string;
  /** Adres pocztowy podmiotu (jedna linia). */
  postalAddress: string;
}

function clean(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const oneLine = value.replace(/\s+/g, ' ').trim();
  if (!oneLine || oneLine.length > MAX_LENGTH) return null;
  return oneLine;
}

/** Tożsamość do stopki; `null`, gdy nie jest (poprawnie) skonfigurowana. */
export function senderIdentityFromEnv(
  source: Record<string, string | undefined> = process.env,
): EmailSenderIdentity | null {
  const identity = clean(source.EMAIL_SENDER_IDENTITY);
  const postalAddress = clean(source.EMAIL_SENDER_POSTAL_ADDRESS);
  if (!identity || !postalAddress) return null;
  return { identity, postalAddress };
}

/** Adres nadawcy (nagłówek From). Poza marketingiem obowiązuje dotychczasowy domyślny. */
export function emailFromEnv(source: Record<string, string | undefined> = process.env): string {
  return clean(source.EMAIL_FROM) ?? DEFAULT_EMAIL_FROM;
}

/**
 * Adres odpowiedzi (nagłówek Reply-To) z `EMAIL_REPLY_TO`: `adres@domena` albo
 * `Nazwa <adres@domena>`. Zła wartość (nie adres, więcej adresów, znaki sterujące) = `null`
 * (bez nagłówka), nigdy niepoprawny nagłówek. Bez wartości domyślnej — odpowiedzi trafiają
 * tam, gdzie operator jawnie wskaże skrzynkę.
 */
export function replyToFromEnv(source: Record<string, string | undefined> = process.env): string | null {
  const value = clean(source.EMAIL_REPLY_TO);
  if (!value) return null;
  // `clean` zwija białe znaki (CR/LF/tab), więc zostają tylko pozostałe znaki sterujące.
  // eslint-disable-next-line no-control-regex -- świadome odrzucenie znaków sterujących w nagłówku
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const mailbox = /^(?:[^<>@,;]*<)?[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+>?$/;
  return mailbox.test(value) && (value.includes('<') === value.includes('>')) ? value : null;
}

/**
 * Komplet wymagany do wysyłki marketingowej: jawny `EMAIL_FROM` (bez wartości domyślnej)
 * oraz tożsamość z adresem pocztowym. `null` = marketing nie może wyjść.
 */
export function marketingSenderFromEnv(
  source: Record<string, string | undefined> = process.env,
): (EmailSenderIdentity & { from: string }) | null {
  const from = clean(source.EMAIL_FROM);
  const identity = senderIdentityFromEnv(source);
  if (!from || !identity) return null;
  return { from, ...identity };
}
