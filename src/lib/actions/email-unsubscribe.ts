'use server';

import { applyUnsubscribe, type UnsubscribeOutcome } from '@/lib/email/unsubscribe';

/**
 * Akcja strony `/wypisz` (#45): świadome kliknięcie „Wypisz mnie". Upoważnieniem jest
 * wyłącznie podpisany token z formularza (bez sesji). Idempotentna — ponowne wysłanie
 * formularza daje ten sam wynik.
 */
export async function unsubscribeFromEmail(
  _previous: UnsubscribeOutcome | null,
  formData: FormData,
): Promise<UnsubscribeOutcome> {
  return applyUnsubscribe(formData.get('t'));
}
