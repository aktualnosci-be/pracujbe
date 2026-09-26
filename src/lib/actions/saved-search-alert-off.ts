'use server';

import { applyAlertOff, inspectAlertOffToken, type AlertOffOutcome } from '@/lib/email/saved-search-alert-off';

/** Tylko sprawdzenie podpisu linku; GET strony ani ta akcja nie zmienia alertu. */
export async function inspectAlertOffLink(token: string) {
  return inspectAlertOffToken(token);
}

/**
 * Akcja strony `/wypisz-alert` (#100): świadome kliknięcie „Wyłącz ten alert". Upoważnieniem
 * jest wyłącznie podpisany token z formularza (bez sesji). Idempotentna.
 */
export async function turnOffSavedSearchAlert(
  _previous: AlertOffOutcome | null,
  formData: FormData,
): Promise<AlertOffOutcome> {
  return applyAlertOff(formData.get('t'));
}
