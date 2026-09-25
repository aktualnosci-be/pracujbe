import * as React from 'react';

import { Link } from '@/i18n/navigation';

/**
 * Link do dokumentu prawnego w etykiecie pola zgody (#229, #493) — jak `TermsLink` w
 * `AuthForm`. Nowa karta nie gubi wpisanych danych; klik nie przełącza checkboxa.
 */
export function LegalDocLink({
  href,
  newTabHint,
  children,
}: {
  href: '/regulamin' | '/polityka-prywatnosci';
  newTabHint: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
    >
      {children}
      <span className="sr-only"> {newTabHint}</span>
    </Link>
  );
}
