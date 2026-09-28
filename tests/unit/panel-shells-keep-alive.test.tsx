import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Panele kandydata/pracodawcy/admina dołączają `SessionKeepAlive` (#864) TYLKO gdy layout
 * potwierdził prawdziwą sesję Better Auth (`keepSessionAlive`) — w trybie DEMO (bez konta) nie
 * ma sensu odświeżać nieistniejącej sesji, więc prop musi zostawać `false`/`undefined` i
 * komponent się nie montuje. Test podmienia `SessionKeepAlive` na znacznik, żeby sprawdzić
 * WYŁĄCZNIE przekazanie propa przez trzy Shell-e (zachowanie samego komponentu — w
 * `session-keep-alive.test.tsx`).
 */

vi.mock('@/components/auth/SessionKeepAlive', () => ({
  SessionKeepAlive: () => <span data-testid="keep-alive-mounted" />,
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/panel',
  useRouter: () => ({ refresh: vi.fn() }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/dashboard/DashboardShell', () => ({
  DashboardShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/employer/CompanySwitcher', () => ({
  CompanySwitcher: () => <span data-testid="switcher" />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CandidateShell — SessionKeepAlive tylko przy prawdziwej sesji (#864)', () => {
  it('bez keepSessionAlive (demo) → nie dołącza SessionKeepAlive', async () => {
    const { CandidateShell } = await import('@/components/candidate/CandidateShell');
    render(
      <CandidateShell>
        <main>panel</main>
      </CandidateShell>,
    );
    expect(screen.queryByTestId('keep-alive-mounted')).not.toBeInTheDocument();
  });

  it('keepSessionAlive (sesja realna) → dołącza SessionKeepAlive', async () => {
    const { CandidateShell } = await import('@/components/candidate/CandidateShell');
    render(
      <CandidateShell keepSessionAlive>
        <main>panel</main>
      </CandidateShell>,
    );
    expect(screen.getByTestId('keep-alive-mounted')).toBeInTheDocument();
  });
});

describe('EmployerShell — SessionKeepAlive tylko przy prawdziwej sesji (#864)', () => {
  it('bez keepSessionAlive (demo) → nie dołącza SessionKeepAlive', async () => {
    const { EmployerShell } = await import('@/components/employer/EmployerShell');
    render(
      <EmployerShell>
        <main>panel</main>
      </EmployerShell>,
    );
    expect(screen.queryByTestId('keep-alive-mounted')).not.toBeInTheDocument();
  });

  it('keepSessionAlive (sesja realna) → dołącza SessionKeepAlive, także w trybie error', async () => {
    const { EmployerShell } = await import('@/components/employer/EmployerShell');
    render(
      <EmployerShell mode="error" keepSessionAlive>
        {null}
      </EmployerShell>,
    );
    expect(screen.getByTestId('keep-alive-mounted')).toBeInTheDocument();
  });
});

describe('AdminShell — SessionKeepAlive tylko przy prawdziwej sesji (#864)', () => {
  it('bez keepSessionAlive (demo) → nie dołącza SessionKeepAlive', async () => {
    const { AdminShell } = await import('@/components/admin/AdminShell');
    render(
      <AdminShell>
        <main>panel</main>
      </AdminShell>,
    );
    expect(screen.queryByTestId('keep-alive-mounted')).not.toBeInTheDocument();
  });

  it('keepSessionAlive (sesja realna) → dołącza SessionKeepAlive', async () => {
    const { AdminShell } = await import('@/components/admin/AdminShell');
    render(
      <AdminShell keepSessionAlive>
        <main>panel</main>
      </AdminShell>,
    );
    expect(screen.getByTestId('keep-alive-mounted')).toBeInTheDocument();
  });
});
