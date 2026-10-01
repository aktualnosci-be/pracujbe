/** Klucze i18n (`team.*`) etykiet i opisów ról członka firmy. Nieznana rola → „członek”. */
const LABEL: Record<string, string> = {
  owner: 'roleOwner',
  admin: 'roleAdmin',
  recruiter: 'roleRecruiter',
  member: 'roleMember',
};
const DESC: Record<string, string> = {
  owner: 'roleOwnerDesc',
  admin: 'roleAdminDesc',
  recruiter: 'roleRecruiterDesc',
  member: 'roleMemberDesc',
};

export function roleLabelKey(role: string): string {
  return LABEL[role] ?? 'roleMember';
}

/**
 * Opis roli. Tryb ogłoszeniowy (domyślny, #1225): wariant `*Listing` bez zgłoszeń, wiadomości,
 * propozycji i rekrutacji; tryb rekrutacyjny = dotychczasowe opisy.
 */
export function roleDescKey(role: string, recruitmentEnabled = false): string {
  const key = DESC[role] ?? 'roleMemberDesc';
  return recruitmentEnabled ? key : `${key}Listing`;
}
