import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileVisibilitySettings } from '@/components/settings/ProfileVisibilitySettings';
import { setProfileVisibilityAction } from '@/lib/actions/profile-visibility';
import { loadProfileVisibility } from '@/lib/data/profile-visibility';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';
import pl from '@/messages/pl.json';

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const t = pl.profileVisibility;
const CHANGED = '2026-09-24T10:00:00.000Z';

/** Klient Supabase: RPC + odczyt własnego wiersza candidate_profiles. */
function supabaseWith(opts: {
  rpc?: { data: unknown; error: unknown };
  row?: { data: unknown; error: unknown };
  user?: object | null;
}) {
  const maybeSingle = vi.fn(async () => opts.row ?? { data: null, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: opts.user === undefined ? { id: 'cand-1' } : opts.user } })) },
    rpc: vi.fn(async () => opts.rpc ?? { data: true, error: null }),
    from: vi.fn(() => ({ select })),
  };
  vi.mocked(createServerClient).mockResolvedValue(client as never);
  return { client, eq };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});
afterEach(cleanup);

describe('setProfileVisibilityAction (#494)', () => {
  it('woła set_candidate_searchable pod sesją i zwraca stan ponownie odczytany z bazy', async () => {
    const { client, eq } = supabaseWith({
      rpc: { data: true, error: null },
      row: { data: { is_searchable: true, profile_completed: true, searchable_changed_at: CHANGED }, error: null },
    });
    expect(await setProfileVisibilityAction(true)).toEqual({ ok: true, searchable: true, changedAt: CHANGED });
    expect(client.rpc).toHaveBeenCalledWith('set_candidate_searchable', { p_searchable: true });
    // Właściciel z sesji, nie od klienta.
    expect(eq).toHaveBeenCalledWith('profile_id', 'cand-1');
  });

  it.each([['napis', 'true'], ['liczba', 1], ['obiekt', { searchable: true }], ['brak', undefined]])(
    'odrzuca %s, zanim zapyta bazę',
    async (_reason, value) => {
      const { client } = supabaseWith({});
      expect(await setProfileVisibilityAction(value)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it('niekompletny profil → ONBOARDING_INCOMPLETE; inne błędy bez technikaliów', async () => {
    supabaseWith({ rpc: { data: null, error: { message: 'VALIDATION_FAILED: profil musi być kompletny' } } });
    expect(await setProfileVisibilityAction(true)).toEqual({ ok: false, error: 'ONBOARDING_INCOMPLETE' });
    supabaseWith({ rpc: { data: null, error: { message: 'PERMISSION_DENIED: profil kandydata tylko dla konta kandydata' } } });
    expect(await setProfileVisibilityAction(false)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    supabaseWith({ rpc: { data: null, error: { message: 'relation "x" does not exist' } } });
    expect(await setProfileVisibilityAction(false)).toEqual({ ok: false, error: 'INTERNAL' });
  });

  it('tryb demo: bez zapisu', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    const result = await setProfileVisibilityAction(false);
    expect(result).toMatchObject({ ok: true, searchable: false, demo: true });
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

describe('loadProfileVisibility (#494)', () => {
  it('brak wiersza profilu = ukryty, nieukończony; błąd ≠ „ukryty”', async () => {
    supabaseWith({ row: { data: null, error: null } });
    expect(await loadProfileVisibility()).toEqual({
      status: 'ready', demo: false, searchable: false, completed: false, changedAt: null,
    });
    supabaseWith({ row: { data: null, error: { message: 'boom' } } });
    expect(await loadProfileVisibility()).toEqual({ status: 'error' });
    supabaseWith({ user: null });
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
