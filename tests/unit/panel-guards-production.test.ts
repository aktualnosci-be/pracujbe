// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #12 — odbiór: anonimowe wejście na `/candidate`, `/employer` i `/admin` w produkcji NIGDY nie
 * renderuje paneli z danymi demonstracyjnymi. Z kompletem konfiguracji guardy layoutów odsyłają
 * gościa do logowania (rola z profilu, nie z cookie); bez konfiguracji middleware zwraca 503,
 * zanim routing dotrze do paneli (`readiness-postgres-only.test.ts`). Demo tylko poza produkcją.
 */

const m = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(public readonly target: string) {
      super('NEXT_REDIRECT');
    }
  }
  class NotFound extends Error {
    constructor() {
      super('NEXT_NOT_FOUND');
    }
  }
  return {
    Redirect,
    NotFound,
    identity: null as null | { id: string; role: 'candidate' | 'employer' | 'admin' },
    requestHeaders: new Headers(),
    getNotifications: vi.fn(async () => ({ status: 'ready', items: [], unread: 0 })),
  };
});

vi.mock('@/i18n/navigation', () => ({
  redirect: (args: { href: string | { pathname: string; query: { next: string } }; locale: string }) => {
    const href =
      typeof args.href === 'string'
        ? args.href
        : `${args.href.pathname}?next=${encodeURIComponent(args.href.query.next)}`;
    throw new m.Redirect(`/${args.locale}${href}`);
  },
  Link: () => null,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new m.NotFound();
  },
}));
vi.mock('next/headers', () => ({ headers: async () => m.requestHeaders }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
vi.mock('@/lib/auth/current', () => ({
  getCurrentIdentity: async () => m.identity,
  readOwnProfileSummary: async () => null,
  displayName: () => undefined,
}));
vi.mock('@/lib/data/notifications', () => ({ getNotifications: m.getNotifications }));
vi.mock('@/lib/data/messages', () => ({ getUnreadConversationsCount: async () => 0 }));
vi.mock('@/lib/data/employer', () => ({ getEmployerShellData: async () => ({ status: 'error' }) }));
vi.mock('@/lib/data/team', () => ({ getMyTeamInvitations: async () => ({ status: 'ok', invitations: [] }) }));
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: async () => ({}) }));
vi.mock('@/lib/db/transaction', () => ({
  withUserTransaction: async (_pool: unknown, _id: string, action: (tx: unknown) => unknown) =>
    action({ query: async () => ({ rows: [{ member: false }] }) }),
}));

import CandidateLayout from '@/app/[locale]/candidate/layout';
import OnboardingLayout from '@/app/[locale]/candidate/onboarding/layout';
import EmployerLayout from '@/app/[locale]/employer/layout';
import AdminLayout from '@/app/[locale]/admin/layout';

const LAYOUTS = {
  candidate: CandidateLayout,
  onboarding: OnboardingLayout,
  employer: EmployerLayout,
  admin: AdminLayout,
} as const;

type Layout = (props: { children: null; params: Promise<{ locale: string }> }) => Promise<unknown>;

async function outcome(layout: Layout, locale = 'pl'): Promise<{ redirect?: string; notFound?: true; rendered?: true }> {
  try {
    await layout({ children: null, params: Promise.resolve({ locale }) });
    return { rendered: true };
  } catch (error) {
    if (error instanceof m.Redirect) return { redirect: error.target };
    if (error instanceof m.NotFound) return { notFound: true };
    throw error;
  }
}

function stubProduction() {
  vi.stubEnv('APP_MODE', 'production');
  vi.stubEnv('DATABASE_APP_URL', 'postgresql://web:pw@db.internal:5432/app');
  vi.stubEnv('DATABASE_AUTH_URL', 'postgresql://auth:pw@db.internal:5432/app');
  vi.stubEnv('BETTER_AUTH_URL', 'https://pracuj.be');
  vi.stubEnv('BETTER_AUTH_SECRET', 's'.repeat(40));
  // Kreator onboardingu istnieje tylko w trybie RECRUITMENT (#1142) — tu sprawdzamy guard sesji.
  vi.stubEnv('PORTAL_LEGAL_MODE', 'RECRUITMENT');
}

beforeEach(() => {
  m.identity = null;
  m.requestHeaders = new Headers();
  m.getNotifications.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('#12: panele w produkcji bez sesji', () => {
  it.each(Object.entries(LAYOUTS))('%s: gość → logowanie, bez odczytu danych demo', async (_name, layout) => {
    stubProduction();
    for (const locale of ['pl', 'nl', 'fr', 'en']) {
      expect(await outcome(layout as Layout, locale)).toEqual({ redirect: `/${locale}/logowanie` });
    }
    // Loader demo (`getNotifications(locale, rola)`) nie może zostać wywołany dla gościa.
    expect(m.getNotifications).not.toHaveBeenCalled();
  });

  it('#1142 tryb ogłoszeniowy: kreator onboardingu → 404 przed odczytem sesji (4 języki)', async () => {
    stubProduction();
    vi.stubEnv('PORTAL_LEGAL_MODE', '');
    for (const locale of ['pl', 'nl', 'fr', 'en']) {
      expect(await outcome(OnboardingLayout as Layout, locale)).toEqual({ notFound: true });
    }
  });

  it('rola z profilu, nie z adresu: pracodawca i admin nie widzą panelu kandydata', async () => {
    stubProduction();
    m.identity = { id: '00000000-0000-4000-8000-000000000001', role: 'employer' };
    expect(await outcome(CandidateLayout as Layout)).toEqual({ redirect: '/pl/employer' });
    m.identity = { id: '00000000-0000-4000-8000-000000000001', role: 'admin' };
    expect(await outcome(CandidateLayout as Layout)).toEqual({ redirect: '/pl/admin' });
  });

  it('panel admina: sesja bez roli admina → 404 (bez ujawniania panelu)', async () => {
    stubProduction();
    for (const role of ['candidate', 'employer'] as const) {
      m.identity = { id: '00000000-0000-4000-8000-000000000001', role };
      expect(await outcome(AdminLayout as Layout)).toEqual({ notFound: true });
    }
  });

  it('panel pracodawcy: konto bez firmy i bez roli pracodawcy → rejestracja pracodawcy', async () => {
    stubProduction();
    m.identity = { id: '00000000-0000-4000-8000-000000000001', role: 'candidate' };
    expect(await outcome(EmployerLayout as Layout)).toEqual({ redirect: '/pl/rejestracja-pracodawca' });
  });

  it('kontrola ujemna: poza produkcją bez konfiguracji panel demo renderuje się (tak ma być tylko tam)', async () => {
    vi.stubEnv('APP_MODE', '');
    for (const name of ['DATABASE_APP_URL', 'DATABASE_AUTH_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']) {
      vi.stubEnv(name, '');
    }
    expect(await outcome(CandidateLayout as Layout)).toEqual({ rendered: true });
    expect(m.getNotifications).toHaveBeenCalledWith('pl', 'candidate');
  });

  it('#1090: gość z linku do obiektu panelu → logowanie z powrotem na tę stronę', async () => {
    stubProduction();
    const cases = [
      [CandidateLayout, '/fr/candidate/aplikacje/0b3c1f7e-7f38-4a55-9d1b-1d6f5b2f0a11'],
      [EmployerLayout, '/nl/employer/aplikacje?oferta=x'],
      [AdminLayout, '/en/admin/zgloszenia'],
    ] as const;
    for (const [layout, path] of cases) {
      m.requestHeaders = new Headers({ 'x-pracujbe-return-path': path });
      const locale = path.slice(1, 3);
      expect(await outcome(layout as Layout, locale)).toEqual({
        redirect: `/${locale}/logowanie?next=${encodeURIComponent(path)}`,
      });
    }
  });

  it.each(['//evil.example/x', 'https://evil.example/pl/candidate', '/candidate/bez-jezyka', '/pl\\\\evil'])(
    '#1090 kontrola ujemna: niebezpieczny powrót %s → zwykłe logowanie',
    async (value) => {
      stubProduction();
      m.requestHeaders = new Headers({ 'x-pracujbe-return-path': value });
      expect(await outcome(CandidateLayout as Layout)).toEqual({ redirect: '/pl/logowanie' });
    },
  );
});
