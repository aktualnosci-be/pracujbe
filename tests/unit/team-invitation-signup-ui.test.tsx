import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmployerSignupEntry } from '@/components/auth/EmployerSignupEntry';
import { TeamInvite } from '@/components/employer/team/TeamInvite';
import { inviteTeamMember } from '@/lib/actions/team';
import { previewTeamInvitationSignup } from '@/lib/actions/team-invite-signup';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';

/**
 * 0109 — UI zaproszenia dla adresu bez konta: wybór języka zaproszenia (domyślnie język
 * strony zapraszającego) i rejestracja z linku (`#token=`) bez nazwy firmy, z adresem
 * zaproszenia. Token usuwany z paska adresu, nie trafia do URL-a żądania.
 */

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/actions/team', () => ({ inviteTeamMember: vi.fn(), revokeTeamInvitation: vi.fn() }));
vi.mock('@/lib/actions/team-invite-signup', () => ({ previewTeamInvitationSignup: vi.fn() }));
vi.mock('@/lib/actions/auth', () => ({
  registerCandidate: vi.fn(),
  registerEmployer: vi.fn(),
  registerInvitedEmployer: vi.fn(),
  requestPasswordReset: vi.fn(),
  signIn: vi.fn(),
}));

const TOKEN = 'b'.repeat(43);

// jsdom nie ma ResizeObserver (używa go Radix Checkbox w formularzu rejestracji).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function withIntl(node: React.ReactNode, locale: 'pl' | 'nl' = 'pl') {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'pl' ? pl : nl}>
      {node}
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(inviteTeamMember).mockResolvedValue({ ok: true });
  window.history.replaceState(null, '', '/pl/rejestracja-pracodawca');
});
afterEach(cleanup);

describe('TeamInvite — język zaproszenia', () => {
  it('domyślnie język strony (nl), 4 języki, wybrany język idzie do akcji', async () => {
    render(withIntl(<TeamInvite actorRole="owner" invitations={[]} />, 'nl'));
    const select = screen.getByRole('combobox', { name: nl.team.localeLabel }) as HTMLSelectElement;
    expect(select.value).toBe('nl');
    expect([...select.options].map((o) => o.value)).toEqual(['pl', 'nl', 'fr', 'en']);
    expect(select).toHaveAccessibleDescription(nl.team.inviteLinkHint);

    fireEvent.change(screen.getByLabelText(nl.team.emailLabel), { target: { value: 'nowy@firma.be' } });
    fireEvent.change(select, { target: { value: 'fr' } });
    fireEvent.click(screen.getByRole('button', { name: nl.team.inviteSubmit }));
    await waitFor(() => expect(inviteTeamMember).toHaveBeenCalledTimes(1));
    expect(vi.mocked(inviteTeamMember).mock.calls[0]![0]).toMatchObject({ email: 'nowy@firma.be', locale: 'fr' });
    expect(await screen.findByText(nl.team.invitedSent)).toBeVisible();
  });
});

describe('EmployerSignupEntry — link z zaproszenia', () => {
  it('bez tokenu: zwykła rejestracja z nazwą firmy, bez podglądu', () => {
    render(withIntl(<EmployerSignupEntry />));
    expect(screen.getByLabelText(pl.auth.companyName)).toBeInTheDocument();
    expect(previewTeamInvitationSignup).not.toHaveBeenCalled();
  });

  it('ważny token: podgląd firmy i roli, formularz BEZ nazwy firmy, adres z zaproszenia tylko do odczytu', async () => {
    vi.mocked(previewTeamInvitationSignup).mockResolvedValue({
      status: 'valid', companyName: 'Acme BV', role: 'recruiter', email: 'nowy@firma.be', expiresAt: '2026-10-09T00:00:00.000Z',
    });
    window.history.replaceState(null, '', `/pl/rejestracja-pracodawca#token=${TOKEN}`);
    render(withIntl(<EmployerSignupEntry />));
    expect(
      await screen.findByText(pl.team.signup.intro.replace('{company}', 'Acme BV').replace('{role}', pl.team.roleRecruiter)),
    ).toBeVisible();
    expect(previewTeamInvitationSignup).toHaveBeenCalledWith(TOKEN);
    // Token usunięty z paska adresu (#505).
    expect(window.location.hash).toBe('');
    expect(screen.queryByLabelText(pl.auth.companyName)).toBeNull();
    const email = screen.getByLabelText(pl.auth.email) as HTMLInputElement;
    expect(email.value).toBe('nowy@firma.be');
    expect(email.readOnly).toBe(true);
  });

  it.each([
    ['used', pl.team.signup.used],
    ['invalid', pl.team.signup.invalid],
  ] as const)('KONTROLA UJEMNA: token %s → komunikat i zwykła rejestracja z nazwą firmy', async (status, text) => {
    vi.mocked(previewTeamInvitationSignup).mockResolvedValue({ status });
    window.history.replaceState(null, '', `/pl/rejestracja-pracodawca#token=${TOKEN}`);
    render(withIntl(<EmployerSignupEntry />));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByLabelText(pl.auth.companyName)).toBeInTheDocument();
  });
});
