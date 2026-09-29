import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TeamInvite, type TeamInvitationView } from '@/components/employer/team/TeamInvite';
import { renewTeamInvitation, revokeTeamInvitation } from '@/lib/actions/team';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';

/**
 * Oczekujące zaproszenia w `/employer/zespol` (0187): język zaproszenia, kto i kiedy
 * zaprosił, „Odnów” bez potwierdzenia (niczego nie odbiera) i „Cofnij” dopiero po
 * potwierdzeniu w dialogu. Przyciski tylko dla ról, którymi zapraszający zarządza.
 */

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@/lib/actions/team', () => ({
  inviteTeamMember: vi.fn(),
  renewTeamInvitation: vi.fn(),
  revokeTeamInvitation: vi.fn(),
}));

const messages = { pl, nl, fr, en } as const;
const t = pl.team;

const INVITATIONS: TeamInvitationView[] = [
  {
    id: 'inv-rec',
    email: 'rita@firma.be',
    role: 'recruiter',
    expiresLabel: 'Ważne do 1 paź 2026',
    createdLabel: '17 wrz 2026',
    locale: 'fr',
    inviterName: 'Olga Owner',
  },
  {
    id: 'inv-admin',
    email: 'adam@firma.be',
    role: 'admin',
    expiresLabel: '',
    createdLabel: '18 wrz 2026',
    locale: null,
    inviterName: '',
  },
];

function renderInvite(actorRole: string, locale: keyof typeof messages = 'pl') {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <TeamInvite companyId="c-1" actorRole={actorRole} invitations={INVITATIONS} />
    </NextIntlClientProvider>,
  );
}

const rowOf = (email: string) => screen.getByText(email).closest('li') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(renewTeamInvitation).mockResolvedValue({ ok: true });
  vi.mocked(revokeTeamInvitation).mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('oczekujące zaproszenia (0187)', () => {
  it('pokazuje język, autora i datę; brak języka i autora = neutralne etykiety', () => {
    renderInvite('owner');
    const rec = rowOf('rita@firma.be');
    expect(within(rec).getByText(/Język zaproszenia: Français/)).toBeVisible();
    expect(within(rec).getByText(/Zaprosił\(a\): Olga Owner, 17 wrz 2026/)).toBeVisible();
    const admin = rowOf('adam@firma.be');
    expect(within(admin).getByText(new RegExp(t.invitationLanguageUnknown))).toBeVisible();
    expect(within(admin).getByText(/Wysłane 18 wrz 2026/)).toBeVisible();
  });

  it('„Odnów” woła akcję z samym id i ogłasza sukces z fokusem na komunikacie', async () => {
    renderInvite('owner');
    fireEvent.click(
      within(rowOf('rita@firma.be')).getByRole('button', {
        name: t.renewLabel.replace('{email}', 'rita@firma.be'),
      }),
    );
    await waitFor(() => expect(renewTeamInvitation).toHaveBeenCalledExactlyOnceWith('inv-rec', 'c-1'));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(t.renewed);
    await waitFor(() => expect(status).toHaveFocus());
    expect(refresh).toHaveBeenCalled();
    expect(revokeTeamInvitation).not.toHaveBeenCalled();
  });

  it('KONTROLA UJEMNA: „Cofnij” bez potwierdzenia nie woła akcji; potwierdzenie — tak', async () => {
    renderInvite('owner');
    const open = () =>
      fireEvent.click(
        within(rowOf('rita@firma.be')).getByRole('button', {
          name: t.revokeLabel.replace('{email}', 'rita@firma.be'),
        }),
      );
    open();
    const dialog = screen.getByRole('alertdialog', {
      name: t.revokeTitle.replace('{email}', 'rita@firma.be'),
    });
    expect(dialog).toHaveTextContent(t.revokeDesc);
    fireEvent.click(within(dialog).getByRole('button', { name: pl.common.cancel }));
    expect(revokeTeamInvitation).not.toHaveBeenCalled();

    open();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: t.revokeConfirm }));
    await waitFor(() => expect(revokeTeamInvitation).toHaveBeenCalledExactlyOnceWith('inv-rec'));
    expect(await screen.findByRole('status')).toHaveTextContent(t.revoked);
  });

  it('błąd odnowienia = komunikat role="alert", bez odświeżenia', async () => {
    vi.mocked(renewTeamInvitation).mockResolvedValue({ ok: false, error: 'MEMBER_ALREADY_EXISTS' });
    renderInvite('owner');
    fireEvent.click(
      within(rowOf('rita@firma.be')).getByRole('button', {
        name: t.renewLabel.replace('{email}', 'rita@firma.be'),
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(t.error.alreadyMember);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('admin firmy nie odnawia ani nie cofa zaproszenia na rolę admin (hierarchia 0086)', () => {
    renderInvite('admin');
    expect(within(rowOf('adam@firma.be')).queryByRole('button')).toBeNull();
    expect(
      within(rowOf('rita@firma.be')).getByRole('button', {
        name: t.renewLabel.replace('{email}', 'rita@firma.be'),
      }),
    ).toBeEnabled();
  });

  it.each(['pl', 'nl', 'fr', 'en'] as const)(
    'dialog cofnięcia: potwierdzenie różni się od „Anuluj” (%s — fr: „Annuler” ≠ „Annuler l’invitation”)',
    (locale) => {
      const m = messages[locale];
      expect(m.team.revokeConfirm).not.toBe(m.common.cancel);
    },
  );

  it.each(['nl', 'fr', 'en'] as const)('etykiety w języku strony: %s', (locale) => {
    renderInvite('owner', locale);
    const tl = messages[locale].team;
    expect(
      within(rowOf('rita@firma.be')).getByRole('button', {
        name: tl.renewLabel.replace('{email}', 'rita@firma.be'),
      }),
    ).toBeVisible();
    expect(within(rowOf('adam@firma.be')).getByText(new RegExp(tl.invitationLanguageUnknown))).toBeVisible();
  });
});
