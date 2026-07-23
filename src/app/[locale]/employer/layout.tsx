import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { EmployerShell } from '@/components/employer/EmployerShell';

/**
 * Layout panelu pracodawcy (grupa tras `/employer/*`).
 *
 * Owija strony w chrome panelu (DashboardShell: granatowy sidebar z przełącznikiem firmy
 * + topbar) poprzez kliencki `EmployerShell`. Layout pozostaje serwerowy, aby wyeksportować
 * NOINDEX dla całego poddrzewa panelu (Invariant #9) — metadata dziedziczy się do stron.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function EmployerLayout({ children }: { children: ReactNode }) {
  return <EmployerShell>{children}</EmployerShell>;
}
