import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RevokedCompanyAccess } from '@/components/employer/RevokedCompanyAccess';
import { CompanyOnboarding } from '@/components/employer/CompanyOnboarding';
import { createAdditionalCompany, createCompany } from '@/lib/actions/company';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';

/**
 * #1210 (decyzja właściciela 29.09.2026): konto z odebranym dostępem widzi komunikat
 * „Twój dostęp do firmy X został odebrany” i zakłada własną firmę przez
 * `createAdditionalCompany` (`create_additional_company`), NIE przez `createCompany`
 * (`create_first_company` kończy się dla niego PERMISSION_DENIED).
 * Kontrola ujemna: zwykły formularz zakładania pierwszej firmy nadal woła `createCompany`.
 */

Element.prototype.scrollIntoView = vi.fn();

const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/lib/actions/company', () => ({
  updateCompany: vi.fn(),
  createCompany: vi.fn(async () => ({ ok: true, id: 'x' })),
  createAdditionalCompany: vi.fn(async () => ({ ok: true, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })),
}));
vi.mock('@/lib/actions/team', () => ({ respondToTeamInvitation: vi.fn() }));

function intl(node: React.ReactNode, messages: Record<string, unknown> = pl, locale = 'pl') {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

async function submitName(name: string) {
  fireEvent.change(screen.getByLabelText(pl.company.name), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: pl.company.submitCreate }));
}

describe('RevokedCompanyAccess (#1210)', () => {
  it('nazwa firmy w komunikacie, bez szczegółów; nagłówek o odebranym dostępie', () => {
    intl(<RevokedCompanyAccess companyNames={['Acme BV']} />);
    expect(screen.getByRole('heading', { level: 1, name: pl.company.accessRevokedTitle })).toBeTruthy();
    expect(screen.getByText(pl.company.accessRevokedNamed.replace('{name}', 'Acme BV'))).toBeTruthy();
    expect(screen.queryByText(pl.company.accessRevokedGeneric)).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: pl.company.accessRevokedCreateTitle })).toBeTruthy();
  });

  it('bez nazw (odczyt się nie udał) — komunikat ogólny', () => {
    intl(<RevokedCompanyAccess companyNames={[]} />, en, 'en');
    expect(screen.getByText(en.company.accessRevokedGeneric)).toBeTruthy();
  });

  it('formularz zakłada firmę przez createAdditionalCompany, nie createCompany', async () => {
    intl(<RevokedCompanyAccess companyNames={['Acme BV']} />);
    await submitName('Moja firma');
    await waitFor(() => expect(createAdditionalCompany).toHaveBeenCalledOnce());
    expect(createCompany).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/employer/firma'));
  });

  it('kontrola ujemna: CompanyOnboarding (konto bez członkostw) woła createCompany', async () => {
    intl(<CompanyOnboarding defaultName="" />);
    await submitName('Moja firma');
    await waitFor(() => expect(createCompany).toHaveBeenCalledOnce());
    expect(createAdditionalCompany).not.toHaveBeenCalled();
  });
});
