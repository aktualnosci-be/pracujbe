import 'server-only';

import { createHash } from 'node:crypto';

import type { Locale } from '@/i18n/routing';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';
import {
  descriptionKey,
  EMAIL_FIELDS,
  type NotificationPreferencesRole,
} from '@/lib/settings/email-preference-fields';

/**
 * Wersja treści zgody e-mail (#45): `sha256:<hex>` z etykiet i opisów przełączników e-mail,
 * które widzi użytkownik w danym języku i roli. Zmiana dowolnego tekstu = nowa wersja, więc
 * dowód zgody (`email_consent_events.wording_version`) wskazuje dokładnie pokazaną treść
 * (odtworzalną z historii `src/messages`). Bez treści prawnych — tylko etykiety formularza.
 */

const MESSAGES: Record<Locale, { settings: Record<string, string> }> = { pl, nl, fr, en };

export function emailConsentWordingVersion(locale: Locale, role: NotificationPreferencesRole): string {
  const settings = MESSAGES[locale].settings;
  const shown = EMAIL_FIELDS[role].map((field) => [
    field,
    settings[`${field}Label`] ?? '',
    settings[descriptionKey(field, role)] ?? '',
  ]);
  const digest = createHash('sha256')
    .update(JSON.stringify({ locale, role, shown }))
    .digest('hex');
  return `sha256:${digest}`;
}
