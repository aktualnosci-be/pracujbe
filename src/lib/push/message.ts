import { isLocale, type Locale } from '@/i18n/routing';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * Treść powiadomienia push (#724) — w języku ODBIORCY (Invariant #1, `resolve_recipient_locale`
 * w claimie), teksty z `src/messages` (`push.*`). Payload zawiera tylko tytuł, ogólną treść
 * z liczbą nowych ofert, ścieżkę panelu i znacznik grupy — bez nazwy wyszukiwania, filtrów,
 * tytułów ofert ani danych osobowych (treść pokazuje się na ekranie blokady).
 */

type PushMessages = typeof pl.push;

const MESSAGES: Record<Locale, PushMessages> = { pl: pl.push, nl: nl.push, fr: fr.push, en: en.push };

export interface PushMessage {
  title: string;
  body: string;
  /** Ścieżka w tym samym serwisie (service worker otwiera tylko taką). */
  url: string;
  tag: string;
}

export function buildSavedSearchPushMessage(locale: string, jobCount: number | null): PushMessage {
  const lang: Locale = isLocale(locale) ? locale : 'en';
  const m = MESSAGES[lang];
  const body =
    typeof jobCount === 'number' && jobCount > 0
      ? m.savedSearchBody.replace('{count}', String(jobCount))
      : m.savedSearchBodyNoCount;
  return {
    title: m.savedSearchTitle,
    body,
    url: `/${lang}/candidate/wyszukiwania`,
    tag: 'saved-search-alert',
  };
}
