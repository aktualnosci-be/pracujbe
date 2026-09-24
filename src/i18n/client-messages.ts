/**
 * Przestrzenie nazw tłumaczeń potrzebne komponentom klienckim. Tylko one trafiają do
 * NextIntlClientProvider (payload RSC każdej strony); reszta (np. billing, landing,
 * legal, metadata) zostaje na serwerze. Translator bez przestrzeni (`useTranslations()`)
 * w komponentach klienckich tłumaczy `errors.*` i klucze walidacji `<ns>.error.<key>`,
 * więc te przestrzenie też muszą tu być.
 *
 * Listę pilnuje tests/unit/i18n-client-messages.test.ts: nowa przestrzeń użyta po stronie
 * klienta bez wpisu tutaj (albo wpis, którego klient nie używa) psuje test.
 */
export const CLIENT_MESSAGE_NAMESPACES = [
  'admin',
  'application',
  'apply',
  'auth',
  'candidate',
  'categories',
  'common',
  'company',
  'companyBlocks',
  'contractTypes',
  'cookies',
  'dashboard',
  'errors',
  'files',
  'filters',
  'footer',
  'guestApply',
  'home',
  'job',
  'jobImport',
  'jobWizard',
  'jobs',
  'match',
  'messages',
  'nav',
  'notifications',
  'offer',
  'offerStatus',
  'onboarding',
  'savedSearches',
  'settings',
  'status',
  'team',
] as const;

export function pickClientMessages<T extends Record<string, unknown>>(messages: T): Partial<T> {
  const picked: Partial<T> = {};
  for (const ns of CLIENT_MESSAGE_NAMESPACES) {
    if (ns in messages) picked[ns as keyof T] = messages[ns as keyof T];
  }
  return picked;
}
