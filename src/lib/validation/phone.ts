import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

/**
 * Normalizacja numeru telefonu kandydata do kanonicznego E.164 (#145).
 *
 * Źródłem prawdy o numeracji jest `libphonenumber-js` (pełne metadane `max`, port Google
 * libphonenumber) — NIE utrzymujemy własnej listy prefiksów. Przyjmujemy numer krajowy razem
 * z jawnie wybranym krajem albo pełny numer międzynarodowy (`+…` / `00…`); w tym drugim
 * przypadku wybrany kraj jest ignorowany, więc wklejony pełny numer nie dostaje drugiego
 * kodu kierunkowego. Warianty ze spacjami, nawiasami, kropkami i łącznikami dają ten sam wynik.
 *
 * Polityka aktualizacji metadanych: wersja zależności jest przypięta dokładnie w `package.json`
 * (zmiana metadanych = świadomy commit). Podbijamy ją przy przeglądzie zależności
 * (`npm outdated`) co najmniej raz na kwartał oraz przy wydaniu zmieniającym plany numeracyjne
 * krajów, na które kierujemy ofertę (BE, NL, LU, FR, DE, PL); `tests/unit/phone.test.ts`
 * pilnuje reprezentatywnych przykładów po każdym podbiciu.
 *
 * Moduł jest serwerowy i czysty: nie loguje numeru. Ta sama funkcja posłuży jednorazowej
 * aplikacji (#98).
 */

/** Kraje dostępne w selektorze kierunkowego formularza aplikacji. */
export const PHONE_COUNTRIES = ['PL', 'BE', 'NL', 'FR', 'DE', 'LU'] as const;
export type PhoneCountry = (typeof PHONE_COUNTRIES)[number];

/** Dozwolone znaki wpisu: cyfry, `+`, spacje i typowe separatory. Litery nie są numerem. */
const ALLOWED_INPUT = /^[+0-9\s().\-/]+$/;
const MAX_INPUT_LENGTH = 32;

/** Zwraca numer w E.164 albo `null`, gdy wpis nie jest poprawnym numerem. */
export function normalizePhone(raw: string, country?: PhoneCountry): string | null {
  const value = raw.trim();
  if (!value || value.length > MAX_INPUT_LENGTH || !ALLOWED_INPUT.test(value)) return null;

  const parsed = parsePhoneNumberFromString(value, country);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}
