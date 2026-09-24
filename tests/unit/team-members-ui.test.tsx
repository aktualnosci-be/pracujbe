import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TeamMembers, type TeamMemberView } from '@/components/employer/team/TeamMembers';
import { MyTeamInvitations } from '@/components/employer/team/MyTeamInvitations';
import { setTeamMemberActive, setTeamMemberRole, respondToTeamInvitation } from '@/lib/actions/team';
import { renderEmail } from '@/emails/templates';
import { emailTargetPath } from '@/lib/email/delivery-data';
import { resolveHref } from '@/lib/data/notifications';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';

const { refresh, push } = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh, push }) }));
vi.mock('@/lib/actions/team', () => ({
  setTeamMemberActive: vi.fn(),
  setTeamMemberRole: vi.fn(),
  respondToTeamInvitation: vi.fn(),
}));
vi.mock('@/lib/data/notifications', async (orig) => orig());
vi.mock('server-only', () => ({}));

const messages = { pl, nl, fr, en } as const;
const t = pl.team;

const MEMBERS: TeamMemberView[] = [
  { id: 'm-owner', name: 'Olga Owner', email: 'olga@x.be', role: 'owner', isActive: true, isSelf: false, sinceLabel: '' },
  { id: 'm-admin', name: 'Adam Admin', email: 'adam@x.be', role: 'admin', isActive: true, isSelf: true, sinceLabel: '' },
  { id: 'm-rec', name: 'Rita Rek', email: 'rita@x.be', role: 'recruiter', isActive: true, isSelf: false, sinceLabel: '' },
  { id: 'm-old', name: 'Olaf Old', email: 'olaf@x.be', role: 'member', isActive: false, isSelf: false, sinceLabel: '' },
];

function renderMembers(actorRole: string, locale: keyof typeof messages = 'pl') {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <TeamMembers members={MEMBERS} actorRole={actorRole} />
    </NextIntlClientProvider>,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setTeamMemberActive).mockResolvedValue({ ok: true });
  vi.mocked(setTeamMemberRole).mockResolvedValue({ ok: true });
  vi.mocked(respondToTeamInvitation).mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('lista zespołu — kontrolki wg hierarchii ról (#403)', () => {
  it('admin: bez kontrolek dla ownera i siebie, z kontrolkami dla rekrutera', () => {
    renderMembers('admin');
    expect(within(rowOf('Olga Owner')).queryByRole('button')).toBeNull();
    expect(within(rowOf('Olga Owner')).getByText(t.higherNote)).toBeVisible();
    expect(within(rowOf('Adam Admin')).queryByRole('button')).toBeNull();
    expect(within(rowOf('Adam Admin')).getByText(t.selfNote)).toBeVisible();
    const select = within(rowOf('Rita Rek')).getByRole('combobox', {
      name: t.roleSelectLabel.replace('{name}', 'Rita Rek'),
    });
    // Admin nie nadaje roli admin/owner.
    expect(within(select).getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(['recruiter', 'member']);
  });

  it('zmiana roli wymaga wyboru i przycisku „Zapisz rolę”', async () => {
    renderMembers('owner');
    const row = rowOf('Rita Rek');
    const save = within(row).getByRole('button', { name: t.saveRoleLabel.replace('{name}', 'Rita Rek') });
    expect(save).toBeDisabled();
    fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'admin' } });
    fireEvent.click(save);
    await waitFor(() => expect(setTeamMemberRole).toHaveBeenCalledExactlyOnceWith('m-rec', 'admin'));
    expect(await screen.findByRole('status')).toHaveTextContent(t.roleSaved);
  });

  it('odebranie dostępu: anulowanie nie woła akcji, potwierdzenie — tak', async () => {
    renderMembers('owner');
    const open = () =>
      fireEvent.click(screen.getByRole('button', { name: t.deactivateLabel.replace('{name}', 'Rita Rek') }));
    open();
    const dialog = screen.getByRole('alertdialog', { name: t.deactivateTitle.replace('{name}', 'Rita Rek') });
    fireEvent.click(within(dialog).getByRole('button', { name: pl.common.cancel }));
    expect(setTeamMemberActive).not.toHaveBeenCalled();
    open();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: t.deactivate }));
    await waitFor(() => expect(setTeamMemberActive).toHaveBeenCalledExactlyOnceWith('m-rec', false));
  });

  it('błąd bazy to komunikat role="alert" (ostatni owner)', async () => {
    vi.mocked(setTeamMemberActive).mockResolvedValue({ ok: false, error: 'LAST_OWNER' });
    renderMembers('owner');
    fireEvent.click(screen.getByRole('button', { name: t.reactivateLabel.replace('{name}', 'Olaf Old') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.error.lastOwner);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(['nl', 'fr', 'en'] as const)('etykiety ról i akcji w języku strony: %s', (locale) => {
    renderMembers('owner', locale);
    expect(screen.getAllByText(messages[locale].team.roleRecruiter).length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: messages[locale].team.reactivateLabel.replace('{name}', 'Olaf Old') }),
    ).toBeVisible();
  });
});

describe('zaproszenia dla zalogowanego (#403)', () => {
  it('„Dołącz” przyjmuje zaproszenie i przechodzi do panelu nowej firmy', async () => {
    render(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <MyTeamInvitations
          invitations={[{ id: 'inv-1', companyName: 'Firma A', role: 'recruiter', inviterName: 'Olga Owner', expiresLabel: '' }]}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/Olga Owner zaprasza Cię do firmy Firma A/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: t.acceptLabel.replace('{company}', 'Firma A') }));
    await waitFor(() => expect(respondToTeamInvitation).toHaveBeenCalledExactlyOnceWith('inv-1', true));
    expect(push).toHaveBeenCalledWith('/employer');
  });

  it('brak zaproszeń — sekcja się nie renderuje', () => {
    const { container } = render(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <MyTeamInvitations invitations={[]} />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('e-mail i powiadomienie zaproszenia (#403)', () => {
  it('CTA e-maila i powiadomienia prowadzi do strony zespołu', () => {
    expect(emailTargetPath('teamInvitation', { panel: 'employer' })).toBe('/employer/zespol');
    expect(resolveHref('company_invitation', 'employer')).toBe('/employer/zespol');
  });

  it.each([
    ['pl', 'Zaproszenie do zespołu firmy Firma A'],
    ['nl', 'Uitnodiging voor het team van Firma A'],
    ['fr', 'Invitation à rejoindre l’équipe de Firma A'],
    ['en', 'Invitation to join the Firma A team'],
  ] as const)('temat w języku odbiorcy: %s', async (locale, subject) => {
    const mail = await renderEmail('teamInvitation', locale, {
      companyName: 'Firma A',
      inviterName: 'Olga Owner',
      actionUrl: `https://pracuj.be/${locale}/employer/zespol`,
    });
    expect(mail.subject).toBe(subject);
    expect(mail.html).toContain('Olga Owner');
  });

  it('brak nazwy zapraszającego → neutralna treść bez pustego podmiotu', async () => {
    const mail = await renderEmail('teamInvitation', 'pl', {
      companyName: 'Firma A',
      inviterName: '',
      actionUrl: 'https://pracuj.be/pl/employer/zespol',
    });
    expect(mail.html).toContain('Masz zaproszenie do zespołu firmy Firma A');
    expect(mail.html).not.toContain(' zaprasza Cię');
  });
});
