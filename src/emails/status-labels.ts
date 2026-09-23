/**
 * Etykiety statusów aplikacji w e-mailach (#288).
 *
 * RPC `transition_application` przekazuje do kolejki surową wartość enuma `application_status`
 * (np. `shortlisted`, `offer_sent`). Kandydat ma zobaczyć tę samą, przetłumaczoną etykietę co
 * w UI — dlatego źródłem są klucze `status.*` z `src/messages/<locale>.json` (jedno źródło
 * tekstów, bez duplikowania tłumaczeń w szablonach e-mail).
 *
 * Nierozpoznana wartość → `undefined` (szablon przełącza się wtedy na neutralny wariant treści
 * bez tokena — INVARIANT #8: odbiorca nie widzi kodów technicznych).
 */

import type { Locale } from '@/i18n/routing';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/** Wartości enuma `application_status` → klucz w przestrzeni `status` plików tłumaczeń. */
const APPLICATION_STATUS_KEYS = {
  draft: 'draft',
  submitted: 'submitted',
  viewed: 'viewed',
  shortlisted: 'shortlisted',
  interview: 'interview',
  offer_sent: 'offerSent',
  offer_accepted: 'offerAccepted',
  offer_declined: 'offerDeclined',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
  hired: 'hired',
} as const;

type StatusKey = (typeof APPLICATION_STATUS_KEYS)[keyof typeof APPLICATION_STATUS_KEYS];

const labels: Record<Locale, Record<StatusKey, string>> = {
  pl: pl.status,
  nl: nl.status,
  fr: fr.status,
  en: en.status,
};

/** Zwraca etykietę statusu aplikacji w języku odbiorcy albo `undefined` dla nieznanej wartości. */
export function applicationStatusLabel(locale: Locale, status: unknown): string | undefined {
  if (typeof status !== 'string') return undefined;
  const normalized = status.trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(APPLICATION_STATUS_KEYS, normalized)) return undefined;
  const key = APPLICATION_STATUS_KEYS[normalized as keyof typeof APPLICATION_STATUS_KEYS];
  return labels[locale][key];
}
