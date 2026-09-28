import type { ReactNode } from 'react';

import { notFoundUnlessRecruitment } from '@/lib/portal-mode';

/**
 * #1134 — decyzja produktowa: portal ogłoszeniowy. Rozmowy kandydat ↔ pracodawca są wyłączone:
 * w trybie ogłoszeniowym segment `wiadomosci` = 404, zanim wyrenderuje się szkielet
 * (`loading.tsx`) i zanim strona zapyta bazę.
 */
export default function MessagesLayout({ children }: { children: ReactNode }) {
  notFoundUnlessRecruitment('messaging');
  return children;
}
