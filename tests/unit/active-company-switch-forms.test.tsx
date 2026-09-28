import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanyForm } from '@/components/employer/CompanyForm';
import { CompanyLinksForm } from '@/components/employer/CompanyLinksForm';
import { TeamInvite } from '@/components/employer/team/TeamInvite';
import { updateCompany, updateCompanyLinks } from '@/lib/actions/company';
import { inviteTeamMember } from '@/lib/actions/team';
import pl from '@/messages/pl.json';

/**
 * CC25-01: przełączenie aktywnej firmy w pasku bocznym TEJ SAMEJ karty (`router.refresh`) podaje
 * formularzom nowe `companyId` i nowe wartości początkowe. `useForm` czyta `defaultValues` tylko
 * przy montażu, więc bez klucza po firmie pola pokazywałyby dane POPRZEDNIEJ firmy, a zapis szedłby
 * już do nowej (nadpisanie nazwy/VAT i cofnięcie weryfikacji). Formularze kluczują się same firmą.
 *
 * Kontrola ujemna (w każdym teście): odświeżenie dla TEJ SAMEJ firmy nie kasuje wpisanych danych
 * (brak remountu), a usunięcie klucza z komponentu sprawia, że asercje po przełączeniu padają.
 */

Element.prototype.scrollIntoView = vi.fn();

const refresh = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@/lib/actions/company', () => ({
  updateCompany: vi.fn(),
  updateCompanyLinks: vi.fn(),
  createCompany: vi.fn(),
  createAdditionalCompany: vi.fn(),
}));
vi.mock('@/lib/actions/team', () => ({ inviteTeamMember: vi.fn(), revokeTeamInvitation: vi.fn() }));
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={props.alt as string} src={props.src as string} />;
  },
}));

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function intl(node: React.ReactNode): React.JSX.Element {
  return (
    <NextIntlClientProvider locale="pl" messages={pl}>
      {node}
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.mocked(updateCompany).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(updateCompanyLinks).mockReset().mockResolvedValue({ ok: true, outcome: 'applied' } as never);
  vi.mocked(inviteTeamMember).mockReset().mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('CompanyForm — przełączenie aktywnej firmy (CC25-01)', () => {
  function form(companyId: string, name: string, vat: string): React.JSX.Element {
    return intl(<CompanyForm mode="edit" companyId={companyId} defaultValues={{ name, vatNumber: vat }} />);
  }

  it('po przełączeniu pola pokazują NOWĄ firmę, a zapis wysyła jej dane pod jej ID', async () => {
    const { rerender } = render(form(A, 'Firma A', 'BE0111111111'));
    const name = screen.getByLabelText(pl.company.name);
    expect(name).toHaveValue('Firma A');

    // Kontrola ujemna: odświeżenie tej samej firmy zachowuje niezapisaną edycję.
    fireEvent.change(name, { target: { value: 'Firma A (edycja)' } });
    rerender(form(A, 'Firma A', 'BE0111111111'));
    expect(screen.getByLabelText(pl.company.name)).toHaveValue('Firma A (edycja)');

    rerender(form(B, 'Firma B', 'BE0222222222'));
    expect(screen.getByLabelText(pl.company.name)).toHaveValue('Firma B');
    expect(screen.getByLabelText(pl.company.vatNumber)).toHaveValue('BE0222222222');

    fireEvent.click(screen.getByRole('button', { name: pl.company.submitSave }));
    await waitFor(() => expect(updateCompany).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateCompany).mock.calls[0]).toEqual([B, { name: 'Firma B', vatNumber: 'BE0222222222' }]);
  });
});

describe('CompanyLinksForm — przełączenie aktywnej firmy (CC25-01)', () => {
  function form(companyId: string, website: string): React.JSX.Element {
    return intl(
      <CompanyLinksForm
        companyId={companyId}
        defaultValues={{ website, logoUrl: '' }}
        published={{ website: null, logoUrl: null }}
        review={null}
        ownHost="pracuj.be"
      />,
    );
  }

  it('po przełączeniu strona WWW jest adresem nowej firmy i trafia do jej ID', async () => {
    const { rerender } = render(form(A, 'https://firma-a.be'));
    const website = screen.getByLabelText(pl.company.website);
    fireEvent.change(website, { target: { value: 'https://firma-a.be/nowa' } });
    rerender(form(A, 'https://firma-a.be'));
    expect(screen.getByLabelText(pl.company.website)).toHaveValue('https://firma-a.be/nowa');

    rerender(form(B, 'https://firma-b.be'));
    expect(screen.getByLabelText(pl.company.website)).toHaveValue('https://firma-b.be');

    fireEvent.click(screen.getByRole('button', { name: pl.company.linksSubmit }));
    await waitFor(() => expect(updateCompanyLinks).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateCompanyLinks).mock.calls[0]?.[0]).toBe(B);
    expect(vi.mocked(updateCompanyLinks).mock.calls[0]?.[1]).toMatchObject({ website: 'https://firma-b.be' });
  });
});

describe('TeamInvite — przełączenie aktywnej firmy (CC25-01, EMP-02)', () => {
  function invite(companyId: string): React.JSX.Element {
    return intl(<TeamInvite companyId={companyId} actorRole="owner" invitations={[]} />);
  }

  it('wpisany adres nie przechodzi do formularza innej firmy; zaproszenie idzie z ID widoku', async () => {
    const { rerender } = render(invite(A));
    fireEvent.change(screen.getByLabelText(pl.team.emailLabel), { target: { value: 'rita@firma.be' } });
    rerender(invite(A));
    expect(screen.getByLabelText(pl.team.emailLabel)).toHaveValue('rita@firma.be');

    rerender(invite(B));
    expect(screen.getByLabelText(pl.team.emailLabel)).toHaveValue('');

    fireEvent.change(screen.getByLabelText(pl.team.emailLabel), { target: { value: 'nowy@firma.be' } });
    fireEvent.click(screen.getByRole('button', { name: pl.team.inviteSubmit }));
    await waitFor(() => expect(inviteTeamMember).toHaveBeenCalledTimes(1));
    expect(vi.mocked(inviteTeamMember).mock.calls[0]?.[1]).toBe(B);
  });
});
