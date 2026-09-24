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

export function roleDescKey(role: string): string {
  return DESC[role] ?? 'roleMemberDesc';
}
