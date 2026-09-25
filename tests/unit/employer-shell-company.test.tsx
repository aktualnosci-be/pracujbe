import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/employer',
  useRouter: () => ({ refresh }),
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/employer/CompanySwitcher', () => ({
  CompanySwitcher: ({ activeName }: { activeName: string }) => <span data-testid="switcher">{activeName}</span>,
}));
vi.mock('@/components/dashboard/DashboardShell', () => ({
  DashboardShell: ({
    brand,
    user,
    notifItems,
    children,
  }: {
    brand: ReactNode;
    user: { subtitle: string };
    notifItems?: unknown[];
    children: ReactNode;
  }) => (
    <>
      {brand}
      <span data-testid="subtitle">{user.subtitle}</span>
      <span data-testid="notif">{notifItems === undefined ? 'demo' : String(notifItems.length)}</span>
      {children}
    </>
  ),
}));

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/company-context', () => ({ getActiveCompany: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

import { EmployerShell } from '@/components/employer/EmployerShell';
import { CompanyStatusBanner } from '@/components/employer/CompanyStatusBanner';
import { getEmployerShellData } from '@/lib/data/employer';
import { getActiveCompany } from '@/lib/company-context';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

const USER = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EmployerShell — nazwa firmy (#401)', () => {
  it('przy błędzie odczytu nie pokazuje firmy demonstracyjnej i daje ponowienie', () => {
    render(
      <EmployerShell mode="error">
        <main>panel</main>
      </EmployerShell>,
    );
    expect(screen.queryByText(/AGO Jobs/)).not.toBeInTheDocument();
    expect(screen.getByTestId('switcher')).toHaveTextContent('companyFallback');
    expect(screen.getByTestId('subtitle')).toHaveTextContent('companyFallback');
    expect(screen.getByRole('alert')).toHaveTextContent('employerShellLoadError');
    screen.getByRole('button', { name: 'retry' }).click();
    expect(refresh).toHaveBeenCalledOnce();
    // Poza demo nigdy nie podstawiamy przykładowych powiadomień.
    expect(screen.getByTestId('notif')).toHaveTextContent('0');
  });

  it('pusta nazwa firmy z sesji daje neutralną etykietę', () => {
    render(
      <EmployerShell mode="ok" companies={[{ id: 'c1', name: '', role: 'owner' }]} activeCompanyId="c1" activeCompanyName="">
        <main>panel</main>
      </EmployerShell>,
    );
    expect(screen.queryByText(/AGO Jobs/)).not.toBeInTheDocument();
    expect(screen.getByTestId('switcher')).toHaveTextContent('companyFallback');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('tryb demo bez zmian', () => {
    render(
      <EmployerShell>
        <main>panel</main>
      </EmployerShell>,
    );
    expect(screen.getByTestId('switcher')).toHaveTextContent('AGO Jobs & HR');
    expect(screen.getByTestId('notif')).toHaveTextContent('demo');
  });
});

describe('getEmployerShellData — jawny wynik (#401)', () => {
  beforeEach(() => {
    resetFakeDb({ id: USER, role: 'employer' });
  });

  it('bez env zwraca demo', async () => {
    fakeSession.configured = false;
    expect(await getEmployerShellData()).toEqual({ status: 'demo' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('błąd odczytu członkostw daje error, nie null/demo', async () => {
    vi.mocked(getActiveCompany).mockRejectedValue(new Error('company_members unavailable'));
    expect(await getEmployerShellData()).toEqual({ status: 'error' });
  });

  it('brak sesji daje error (layout i tak przekierowuje), bez odczytu bazy', async () => {
    fakeSession.identity = null;
    expect(await getEmployerShellData()).toEqual({ status: 'error' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  const context = {
    activeId: 'c1', activeStatus: 'pending', activeName: 'Firma A', activeRole: 'owner',
    companies: [{ id: 'c1', name: 'Firma A', role: 'owner', status: 'pending' }],
  };

  it('realna firma i imię użytkownika z profilu własnej sesji', async () => {
    vi.mocked(getActiveCompany).mockResolvedValue(context);
    fakeDb.rows('employer.shell-profile', [{ first_name: ' Ada ', last_name: 'Nowak' }]);
    expect(await getEmployerShellData()).toEqual({
      status: 'ok', companies: [{ id: 'c1', name: 'Firma A', role: 'owner' }], activeId: 'c1',
      activeName: 'Firma A', activeRole: 'owner', activeStatus: 'pending', userName: 'Ada Nowak',
    });
    expect(vi.mocked(getActiveCompany).mock.calls[0]?.[1]).toBe(USER);
    expect(fakeDb.callsTo('employer.shell-profile')[0]).toMatchObject({ values: [USER], as: USER });
  });

  it('błąd odczytu imienia nie jest błędem panelu (neutralna etykieta)', async () => {
    vi.mocked(getActiveCompany).mockResolvedValue(context);
    fakeDb.rows('employer.shell-profile', () => { throw pgError('XX000', 'profiles unavailable'); });
    expect(await getEmployerShellData()).toMatchObject({ status: 'ok', activeName: 'Firma A', userName: '' });
  });
});

describe('CompanyStatusBanner — pulpit i kreator (#399)', () => {
  it.each(['unverified', 'pending', 'rejected', 'suspended'])(
    'status %s: baner na pulpicie z linkiem do danych firmy',
    (status) => {
      render(<CompanyStatusBanner status={status} variant="dashboard" />);
      expect(screen.getByRole('status')).toHaveAttribute('data-company-status', status);
      expect(screen.getByRole('link', { name: /bannerLink/ })).toHaveAttribute('href', '/employer/firma');
    },
  );

  it('niezweryfikowana firma widzi checklistę pierwszych kroków', () => {
    render(<CompanyStatusBanner status="unverified" variant="dashboard" />);
    expect(screen.getByText('stepsTitle')).toBeInTheDocument();
    expect(screen.getByText('stepVat')).toBeInTheDocument();
    expect(screen.getByText('stepDraft')).toBeInTheDocument();
  });

  it('kreator mówi o szkicu i publikacji po weryfikacji', () => {
    render(<CompanyStatusBanner status="pending" variant="wizard" />);
    expect(screen.getByText('wizardNotice')).toBeInTheDocument();
  });

  it.each(['dashboard', 'wizard'] as const)('firma zweryfikowana: brak baneru (%s)', (variant) => {
    const { container } = render(<CompanyStatusBanner status="verified" variant={variant} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('strona firmy nadal pokazuje stan zweryfikowany', () => {
    render(<CompanyStatusBanner status="verified" />);
    expect(screen.getByText('bannerVerifiedTitle')).toBeInTheDocument();
  });
});
