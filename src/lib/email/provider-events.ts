/**
 * Zdarzenia doręczeń dostawcy poczty (#44) — normalizacja do jednego modelu.
 *
 * Model (`NormalizedEmailEvent`) jest niezależny od dostawcy: webhook Resend (dziś) i przyszły
 * adapter innego dostawcy mapują swoje zdarzenia na te same cztery rodzaje, które zapisuje RPC
 * `record_email_event` (0099). Zdarzenie spoza modelu (np. `email.opened`, `email.sent`) jest
 * pomijane — nigdy nie udaje doręczenia.
 *
 * Macierz możliwości Resend:
 *   email.delivered        → delivered
 *   email.delivery_delayed → delivery_delayed (bez zmiany statusu)
 *   email.bounced          → bounced (`bounce.type`: Permanent = trwałe → blokada adresu;
 *                            Transient / inne = bez blokady)
 *   email.complained       → complained (blokada adresu)
 *   pozostałe              → ignorowane
 */

export const EMAIL_EVENT_KINDS = ['delivered', 'delivery_delayed', 'bounced', 'complained'] as const;
export type EmailEventKind = (typeof EMAIL_EVENT_KINDS)[number];

export type BounceType = 'permanent' | 'transient' | 'undetermined';

export interface NormalizedEmailEvent {
  provider: 'resend';
  kind: EmailEventKind;
  providerMessageId: string;
  /** Czas zdarzenia u dostawcy (ISO) albo null, gdy brak/niepoprawny (baza użyje `now()`). */
  occurredAt: string | null;
  /** Adres odbiorcy — tylko do blokady wiadomości spoza kolejki (np. e-maile Auth). */
  recipient: string | null;
  bounceType: BounceType | null;
}

export type NormalizeResult =
  | { status: 'event'; event: NormalizedEmailEvent }
  | { status: 'ignored' }
  | { status: 'invalid' };

const RESEND_EVENT_KIND: Record<string, EmailEventKind> = {
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
};

const MAX_ID_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function recipientOf(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== 'string') return null;
  const email = first.trim();
  return email.length >= 3 && email.length <= MAX_EMAIL_LENGTH && email.includes('@') ? email : null;
}

export function normalizeBounceType(value: unknown): BounceType {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (v === 'permanent') return 'permanent';
  if (v === 'transient') return 'transient';
  return 'undetermined';
}

/**
 * Payload webhooka Resend (`{ type, created_at, data: { email_id, to, bounce? } }`) →
 * zdarzenie modelu. Wymaga niepustego, stabilnego `email_id` — bez niego zdarzenie jest
 * niepoprawne (nie da się go powiązać z wysyłką).
 */
export function normalizeResendEvent(payload: unknown): NormalizeResult {
  const root = asRecord(payload);
  if (!root || typeof root['type'] !== 'string') return { status: 'invalid' };
  const kind = RESEND_EVENT_KIND[root['type']];
  if (!kind) return { status: 'ignored' };

  const data = asRecord(root['data']);
  const id = data?.['email_id'];
  if (typeof id !== 'string' || id.trim().length === 0 || id.length > MAX_ID_LENGTH) {
    return { status: 'invalid' };
  }

  return {
    status: 'event',
    event: {
      provider: 'resend',
      kind,
      providerMessageId: id.trim(),
      occurredAt: isoOrNull(root['created_at']),
      recipient: recipientOf(data?.['to']),
      bounceType: kind === 'bounced' ? normalizeBounceType(asRecord(data?.['bounce'])?.['type']) : null,
    },
  };
}
