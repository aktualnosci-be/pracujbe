import { createHash } from 'node:crypto';

import type { Locale } from '@/i18n/routing';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * Elementy formularza rejestracji/onboardingu (#493), każdy z osobnym dowodem:
 * - `terms`   — akceptacja regulaminu (wymagana),
 * - `privacy` — potwierdzenie zapoznania się z informacją o prywatności (wymagane, NIE zgoda),
 * - cele opcjonalne (`OPTIONAL_CONSENT_PURPOSES`) — każdy osobno, domyślnie niezaznaczony,
 *   odmowa nie blokuje konta. Lustro allow-listy `record_signup_consents` (0108); dowód zgody
 *   zapisuje dziennik #513 (`email_consent_events`, źródło `signup`).
 *
 * Wersja pokazanej treści = `sha256:` z etykiety w języku formularza. Dopóki strony prawne
 * nie mają wpisu w `consent_versions`, to jedyny ślad tego, co użytkownik widział.
 */

export const OPTIONAL_CONSENT_PURPOSES = ['email_marketing'] as const;
export type OptionalConsentPurpose = (typeof OPTIONAL_CONSENT_PURPOSES)[number];

export type ConsentChannel = 'signup' | 'onboarding';
type ConsentElement = 'terms' | 'privacy' | OptionalConsentPurpose;

/** Klucz etykiety w `src/messages` dla elementu w danym kanale. */
export const CONSENT_WORDING_KEYS: Readonly<
  Record<ConsentChannel, Readonly<Partial<Record<ConsentElement, string>>>>
> = {
  signup: {
    terms: 'auth.termsAcceptLinks',
    privacy: 'auth.privacyNoticeAckLinks',
    email_marketing: 'auth.marketingOptIn',
  },
  onboarding: {
    terms: 'onboarding.termsAcceptLinks',
    privacy: 'onboarding.privacyNoticeAckLinks',
  },
};

const MESSAGES: Readonly<Record<Locale, unknown>> = { pl, nl, fr, en };

function messageAt(locale: Locale, key: string): string | null {
  let node: unknown = MESSAGES[locale];
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : null;
}

/** `sha256:<hex>` treści etykiety; brak etykiety → brak wersji. */
export function consentWordingVersion(locale: Locale, key: string): string | null {
  const text = messageAt(locale, key);
  if (text === null) return null;
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * Wersje treści dla elementów pokazanych w formularzu kanału. Cele opcjonalne tylko te,
 * które formularz pokazał (`shown`).
 */
export function consentWordingVersions(
  channel: ConsentChannel,
  locale: Locale,
  shown: readonly OptionalConsentPurpose[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = CONSENT_WORDING_KEYS[channel];
  for (const element of ['terms', 'privacy', ...shown] as const) {
    const key = keys[element];
    const version = key ? consentWordingVersion(locale, key) : null;
    if (version) out[element] = version;
  }
  return out;
}

/** Wybory zgód opcjonalnych z formularza rejestracji: niezaznaczone = odmowa. */
export function signupOptionalConsents(input: {
  marketingOptIn?: boolean;
}): Record<OptionalConsentPurpose, boolean> {
  return { email_marketing: input.marketingOptIn === true };
}
