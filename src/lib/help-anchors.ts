/**
 * Stałe kotwice pytań na stronie Pomocy (`/pomoc`), do których linkuje reszta serwisu.
 * Jedno źródło dla strony Pomocy i linków (np. odznaka weryfikacji firmy na szczególe oferty, #1151).
 */
export const HELP_PATH = '/pomoc';

/** Pytanie „Co oznacza weryfikacja firmy?” (`help.faq.verification`). */
export const HELP_VERIFICATION_ANCHOR = 'weryfikacja';

/** Kotwica per klucz pytania `help.faq.<id>`; brak wpisu = pytanie bez kotwicy. */
export const HELP_ITEM_ANCHORS: Partial<Record<string, string>> = {
  verification: HELP_VERIFICATION_ANCHOR,
};

export const HELP_VERIFICATION_HREF = `${HELP_PATH}#${HELP_VERIFICATION_ANCHOR}`;
