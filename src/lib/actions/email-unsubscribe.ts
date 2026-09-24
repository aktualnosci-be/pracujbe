'use server';

import { applyUnsubscribe, inspectUnsubscribeToken, type UnsubscribeOutcome } from '@/lib/email/unsubscribe';

/** Tylko sprawdzenie podpisu linku; GET strony ani ta akcja nie zmienia preferencji. */
export async function inspectUnsubscribeLink(token: string) {
  return inspectUnsubscribeToken(token);
}

/**
 * Akcja strony `/wypisz` (#45): świadome kliknięcie „Wypisz mnie" (kategoria z tokenu) albo
 * „Wypisz mnie ze wszystkich" (`scope=all`). Upoważnieniem jest wyłącznie podpisany token
 * z formularza (bez sesji). Idempotentna — ponowne wysłanie formularza daje ten sam wynik.
 * Język strony trafia do dowodu wycofania zgody (0101).
 */
export async function unsubscribeFromEmail(
  _previous: UnsubscribeOutcome | null,
  formData: FormData,
): Promise<UnsubscribeOutcome> {
  const locale = formData.get('l');
  return applyUnsubscribe(formData.get('t'), {
    source: 'unsubscribe_page',
    locale: typeof locale === 'string' ? locale : null,
    scope: formData.get('scope') === 'all' ? 'all' : 'category',
  });
}
