import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileVisibilitySettings } from '@/components/settings/ProfileVisibilitySettings';
import { setProfileVisibilityAction } from '@/lib/actions/profile-visibility';
import { loadProfileVisibility } from '@/lib/data/profile-visibility';
import type { PortalIdentity } from '@/lib/auth/session';
import pl from '@/messages/pl.json';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const t = pl.profileVisibility;
const CHANGED = '2026-09-24T10:00:00.000Z';

const USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

type Reply = { data: unknown } | { fail: string };

/** Baza: RPC set_candidate_searchable + odczyt własnego wiersza candidate_profiles. */
function dbWith(opts: { rpc?: Reply; row?: Reply; user?: PortalIdentity | null }) {
  resetFakeDb(opts.user === undefined ? ({ id: USER, role: 'candidate' } as PortalIdentity) : opts.user);
  const answer = (reply: Reply | undefined, fallback: unknown) => () => {
    if (reply && 'fail' in reply) throw pgError('P0001', reply.fail);
    return reply ? reply.data : fallback;
  };
  fakeDb
    .rpc('set_candidate_searchable', answer(opts.rpc, true))
    .rows('profile-visibility.own', answer(opts.row, []));
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('setProfileVisibilityAction (#494)', () => {
  it('woła set_candidate_searchable pod sesją i zwraca stan ponownie odczytany z bazy', async () => {
    dbWith({
      rpc: { data: true },
      row: { data: [{ is_searchable: true, profile_completed: true, searchable_changed_at: CHANGED }] },
    });
    expect(await setProfileVisibilityAction(true)).toEqual({ ok: true, searchable: true, changedAt: CHANGED });
    expect(fakeDb.callsTo('set_candidate_searchable')[0]).toMatchObject({ args: { p_searchable: true }, as: USER });
    // Właściciel z sesji, nie od klienta; odczyt w tej samej transakcji po zapisie.
    expect(fakeDb.callsTo('profile-visibility.own')[0]!.values).toEqual([USER]);
    expect(fakeDb.calls.map((call) => call.name)).toEqual(['set_candidate_searchable', 'profile-visibility.own']);
  });

  it('zapis przeszedł, ponowny odczyt nie → stan z RPC (zapis nie jest cofany)', async () => {
    dbWith({ rpc: { data: false }, row: { fail: 'boom' } });
    expect(await setProfileVisibilityAction(false)).toEqual({ ok: true, searchable: false, changedAt: null });
  });

  it.each([['napis', 'true'], ['liczba', 1], ['obiekt', { searchable: true }], ['brak', undefined]])(
    'odrzuca %s, zanim zapyta bazę',
    async (_reason, value) => {
      dbWith({});
      expect(await setProfileVisibilityAction(value)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
      expect(fakeDb.calls).toHaveLength(0);
    },
  );

  it('niekompletny profil → ONBOARDING_INCOMPLETE; inne błędy bez technikaliów', async () => {
    dbWith({ rpc: { fail: 'VALIDATION_FAILED: profil musi być kompletny' } });
    expect(await setProfileVisibilityAction(true)).toEqual({ ok: false, error: 'ONBOARDING_INCOMPLETE' });
    dbWith({ rpc: { fail: 'PERMISSION_DENIED: profil kandydata tylko dla konta kandydata' } });
    expect(await setProfileVisibilityAction(false)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    dbWith({ rpc: { fail: 'relation "x" does not exist' } });
    expect(await setProfileVisibilityAction(false)).toEqual({ ok: false, error: 'INTERNAL' });
    dbWith({ user: null });
    expect(await setProfileVisibilityAction(false)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('tryb demo: bez zapisu', async () => {
    dbWith({});
    fakeSession.configured = false;
    const result = await setProfileVisibilityAction(false);
    expect(result).toMatchObject({ ok: true, searchable: false, demo: true });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('loadProfileVisibility (#494)', () => {
  it('brak wiersza profilu = ukryty, nieukończony; błąd ≠ „ukryty”', async () => {
    dbWith({ row: { data: [] } });
    expect(await loadProfileVisibility()).toEqual({
      status: 'ready', demo: false, searchable: false, completed: false, changedAt: null,
    });
    dbWith({ row: { fail: 'boom' } });
    expect(await loadProfileVisibility()).toEqual({ status: 'error' });
    dbWith({ user: null });
    expect(await loadProfileVisibility()).toEqual({ status: 'error' });
  });
});

function renderSettings(initial: { searchable: boolean; completed: boolean; changedAt: string | null }) {
  return render(
    <NextIntlClientProvider locale="pl" messages={pl} timeZone="Europe/Brussels">
      <ProfileVisibilitySettings initial={initial} />
    </NextIntlClientProvider>,
  );
}

describe('ProfileVisibilitySettings (#494)', () => {
  it('domyślnie wyłączony; włącza i wyłącza — stan tylko z potwierdzonej odpowiedzi', async () => {
    const action = vi.fn()
      .mockResolvedValueOnce({ ok: true, searchable: true, changedAt: CHANGED })
      .mockResolvedValueOnce({ ok: true, searchable: false, changedAt: CHANGED });
    vi.spyOn(await import('@/lib/actions/profile-visibility'), 'setProfileVisibilityAction').mockImplementation(action);
    renderSettings({ searchable: false, completed: true, changedAt: null });

    const toggle = screen.getByRole('switch', { name: t.toggleLabel });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(t.neverChanged)).toBeInTheDocument();
    expect(screen.getByText(t.notSeenText)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(await screen.findByRole('status')).toHaveTextContent(t.savedOn);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Ostatnia zmiana:/)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(await screen.findByText(t.savedOff)).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(action).toHaveBeenNthCalledWith(1, true);
    expect(action).toHaveBeenNthCalledWith(2, false);
  });

  it('błąd zapisu: przełącznik zostaje w poprzednim stanie, komunikat alert', async () => {
    vi.spyOn(await import('@/lib/actions/profile-visibility'), 'setProfileVisibilityAction')
      .mockResolvedValue({ ok: false, error: 'INTERNAL' });
    renderSettings({ searchable: true, completed: true, changedAt: CHANGED });
    const toggle = screen.getByRole('switch', { name: t.toggleLabel });
    fireEvent.click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent(t.saveError);
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('profile-visibility-state')).toHaveTextContent(t.stateOn);
  });

  it('nieukończony profil: włączenie niedostępne, link do onboardingu', () => {
    renderSettings({ searchable: false, completed: false, changedAt: null });
    expect(screen.getByRole('switch', { name: t.toggleLabel })).toBeDisabled();
    expect(screen.getByRole('link', { name: t.completeProfile })).toHaveAttribute('href', '/candidate/onboarding');
  });
});

describe('konto 16–17: widoczność tylko dla pełnoletnich (#576, LAUNCH-1)', () => {
  // Szpiedzy akcji z poprzednich bloków zostają do końca pliku — tu potrzebna prawdziwa akcja.
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('baza odrzuca włączenie (AGE_ADULT_REQUIRED) → własny kod, nie „profil niekompletny”', async () => {
    dbWith({ rpc: { fail: 'AGE_ADULT_REQUIRED: wyszukiwalność profilu tylko dla osób pełnoletnich' } });
    expect(await setProfileVisibilityAction(true)).toEqual({ ok: false, error: 'AGE_ADULT_REQUIRED' });
  });

  it('adult=false: przełącznik wyłączony z wyjaśnieniem, bez wywołania akcji', async () => {
    const action = vi.fn();
    vi.spyOn(await import('@/lib/actions/profile-visibility'), 'setProfileVisibilityAction').mockImplementation(action);
    render(
      <NextIntlClientProvider locale="pl" messages={pl} timeZone="Europe/Brussels">
        <ProfileVisibilitySettings initial={{ searchable: false, completed: true, changedAt: null }} adult={false} />
      </NextIntlClientProvider>,
    );
    const toggle = screen.getByRole('switch', { name: t.toggleLabel });
    expect(toggle).toBeDisabled();
    expect(screen.getByTestId('profile-visibility-adult-only')).toHaveTextContent(t.requiresAdult);
    fireEvent.click(toggle);
    expect(action).not.toHaveBeenCalled();
  });

  it('kontrola ujemna: adult=true (18+) z kompletnym profilem — przełącznik aktywny, bez wyjaśnienia', () => {
    render(
      <NextIntlClientProvider locale="pl" messages={pl} timeZone="Europe/Brussels">
        <ProfileVisibilitySettings initial={{ searchable: false, completed: true, changedAt: null }} adult />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('switch', { name: t.toggleLabel })).toBeEnabled();
    expect(screen.queryByTestId('profile-visibility-adult-only')).toBeNull();
  });

  it('odmowa bazy mimo UI (stan nieznany): komunikat „tylko pełnoletni” przy przełączniku', async () => {
    vi.spyOn(await import('@/lib/actions/profile-visibility'), 'setProfileVisibilityAction')
      .mockResolvedValue({ ok: false, error: 'AGE_ADULT_REQUIRED' });
    renderSettings({ searchable: false, completed: true, changedAt: null });
    fireEvent.click(screen.getByRole('switch', { name: t.toggleLabel }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(t.requiresAdult));
    expect(screen.getByRole('switch', { name: t.toggleLabel })).toHaveAttribute('aria-checked', 'false');
  });
});
