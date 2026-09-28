import type { ReactNode } from 'react';

import { notFoundUnlessRecruitment } from '@/lib/portal-mode';

/**
 * Profil kandydata (`/candidate/profil` z podstronami, w tym `import-cv`).
 *
 * Decyzja produktowa: portal ogłoszeniowy (#1128) — profil służył dopasowaniom i przeglądaniu
 * przez firmy, w trybie ogłoszeniowym nie ma odbiorcy, więc cały segment daje 404.
 */
export default function CandidateProfileLayout({ children }: { children: ReactNode }) {
  notFoundUnlessRecruitment('candidateProfile');
  return children;
}
