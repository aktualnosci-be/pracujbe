/**
 * Rola konta w panelu administratora — wspólne dla listy `/admin/uzytkownicy` i szczegółu konta.
 */

/** Etykieta roli (klucz i18n w namespace `admin`); brak w mapie → surowa wartość. */
export const USER_ROLE_LABEL: Record<string, string> = {
  candidate: 'roleCandidate',
  employer: 'roleEmployer',
  admin: 'roleAdmin',
  moderator: 'roleModerator',
};

/** Ton wizualny roli (kolory tokenami; tekst na tincie → warianty `-text`, WCAG AA — #316). */
export const USER_ROLE_TONE: Record<string, string> = {
  candidate: 'bg-accent/10 text-accent-dark',
  employer: 'bg-primary/10 text-primary-dark',
  admin: 'bg-warning/10 text-warning-text',
  moderator: 'bg-success/10 text-success-text',
};

/** Inicjały z nazwy (maks. 2 znaki). */
export function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '•';
}
