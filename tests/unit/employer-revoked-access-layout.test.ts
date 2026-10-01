// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #1210 (decyzja właściciela 29.09.2026): layout panelu pracodawcy rozróżnia konto BEZ
 * członkostw (formularz pierwszej firmy, `create_first_company`) od konta z WYŁĄCZNIE
 * odebranym dostępem (komunikat + własna firma przez `create_additional_company`). Nazwy firm
 * czyta osobna funkcja (service_role) tylko dla identyfikatora z sesji i tylko w stanie „odebrany”.
 */

const m = vi.hoisted(() => ({
  identity: { id: '00000000-0000-4000-8000-0000000000e1', role: 'employer' as const },
  row: { member: false, revoked: false } as { member: boolean; revoked?: boolean },
  revokedNames: vi.fn(async (_id: string) => ['Acme BV']),
  signupName: vi.fn(async () => 'Z rejestracji'),
}));

vi.mock('@/i18n/navigation', () => ({
  redirect: () => {
    throw new Error('NEXT_REDIRECT');
  },
  Link: () => null,
}));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
vi.mock('@/lib/auth/current', () => ({ getCurrentIdentity: async () => m.identity }));
vi.mock('@/lib/auth/signup-company-name', () => ({ readSignupCompanyName: m.signupName }));
vi.mock('@/lib/data/notifications', () => ({ getNotifications: async () => ({ status: 'ready', items: [], unread: 0 }) }));
vi.mock('@/lib/data/messages', () => ({ getUnreadConversationsCount: async () => 0 }));
vi.mock('@/lib/data/employer', () => ({ getEmployerShellData: async () => ({ status: 'error' }) }));
vi.mock('@/lib/data/team', () => ({ getMyTeamInvitations: async () => ({ status: 'ok', invitations: [] }) }));
vi.mock('@/lib/data/revoked-company-access', () => ({ getRevokedCompanyNames: m.revokedNames }));
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: async () => ({}) }));
vi.mock('@/lib/db/transaction', () => ({
  withUserTransaction: async (_pool: unknown, _id: string, action: (tx: unknown) => unknown) =>
    action({ query: async () => ({ rows: [m.row] }) }),
}));

import EmployerLayout from '@/app/[locale]/employer/layout';
import { CompanyOnboarding } from '@/components/employer/CompanyOnboarding';
import { RevokedCompanyAccess } from '@/components/employer/RevokedCompanyAccess';

type Element = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

async function content(): Promise<Element> {
  const shell = (await EmployerLayout({ children: null, params: Promise.resolve({ locale: 'pl' }) })) as Element;
  return shell.props.children as Element;
}

function stubProduction() {
  vi.stubEnv('APP_MODE', 'production');
  vi.stubEnv('DATABASE_APP_URL', 'postgresql://web:pw@db.internal:5432/app');
  vi.stubEnv('DATABASE_AUTH_URL', 'postgresql://auth:pw@db.internal:5432/app');
  vi.stubEnv('BETTER_AUTH_URL', 'https://pracuj.be');
  vi.stubEnv('BETTER_AUTH_SECRET', 's'.repeat(40));
}

beforeEach(() => {
  vi.clearAllMocks();
  stubProduction();
});
afterEach(() => vi.unstubAllEnvs());

describe('layout /employer — odebrany dostęp (#1210)', () => {
  it('tylko nieaktywne członkostwa → RevokedCompanyAccess z nazwami firm z sesji', async () => {
    m.row = { member: false, revoked: true };
    const el = await content();
    expect(el.type).toBe(RevokedCompanyAccess);
    expect(el.props.companyNames).toEqual(['Acme BV']);
    expect(m.revokedNames).toHaveBeenCalledWith(m.identity.id);
    expect(m.signupName).not.toHaveBeenCalled();
  });

  it('kontrola ujemna: brak członkostw → CompanyOnboarding (pierwsza firma), bez odczytu nazw', async () => {
    m.row = { member: false, revoked: false };
    const el = await content();
    expect(el.type).toBe(CompanyOnboarding);
    expect(el.props.defaultName).toBe('Z rejestracji');
    expect(m.revokedNames).not.toHaveBeenCalled();
  });

  it('kontrola ujemna: aktywne członkostwo (nawet obok odebranego) → zwykły panel', async () => {
    m.row = { member: true, revoked: true };
    const el = await content();
    expect(el).toBeNull();
    expect(m.revokedNames).not.toHaveBeenCalled();
  });
});
