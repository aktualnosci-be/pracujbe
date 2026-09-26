import * as React from 'react';
import { readFileSync } from 'node:fs';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/actions/company', () => ({
  createCompany: vi.fn(),
  createAdditionalCompany: vi.fn(),
  updateCompany: vi.fn(),
}));
vi.mock('@/lib/actions/team', () => ({ respondToCompanyInvitation: vi.fn() }));

import { CompanyOnboarding } from '@/components/employer/CompanyOnboarding';
import {
  companyNameFromMetadata,
  readSignupCompanyName,
  type SignupNameAuth,
} from '@/lib/auth/signup-company-name';
import pl from '@/messages/pl.json';

/**
 * Nazwa firmy z rejestracji jako podpowiedź formularza zakładania firmy, gdy automatyczny
 * bootstrap po potwierdzeniu e-maila się nie udał (CLAUDE.md, Etap 3 „Otwarte”).
 */

function fakeAuth(findUserById: (id: string) => Promise<unknown>): () => Promise<SignupNameAuth> {
  return async () => ({ $context: Promise.resolve({ internalAdapter: { findUserById } }) });
}

describe('companyNameFromMetadata', () => {
  it('bierze nazwę z raw_user_meta_data (przycięta)', () => {
    expect(companyNameFromMetadata({ raw_user_meta_data: { company_name: '  Bouw BV  ' } })).toBe('Bouw BV');
  });

  it.each([
    ['brak użytkownika', null],
    ['brak metadanych', { id: 'x' }],
    ['brak nazwy (konto z zaproszenia)', { raw_user_meta_data: { role: 'employer' } }],
    ['nie-tekst', { raw_user_meta_data: { company_name: 42 } }],
    ['za krótka', { raw_user_meta_data: { company_name: ' A ' } }],
    ['za długa', { raw_user_meta_data: { company_name: 'x'.repeat(121) } }],
  ])('%s → null', (_label, user) => {
    expect(companyNameFromMetadata(user)).toBeNull();
  });
});

describe('readSignupCompanyName', () => {
  it('czyta konto po UUID z sesji i zwraca nazwę', async () => {
    const findUserById = vi.fn(async () => ({ raw_user_meta_data: { company_name: 'Bouw BV' } }));
    await expect(readSignupCompanyName('user-1', fakeAuth(findUserById))).resolves.toBe('Bouw BV');
    expect(findUserById).toHaveBeenCalledWith('user-1');
  });

  it('awaria adaptera albo brak konta = pusta podpowiedź (formularz działa dalej)', async () => {
    await expect(
      readSignupCompanyName('user-1', fakeAuth(async () => { throw new Error('db down'); })),
    ).resolves.toBe('');
    await expect(readSignupCompanyName('user-1', fakeAuth(async () => null))).resolves.toBe('');
    await expect(
      readSignupCompanyName('user-1', async () => { throw new Error('runtime'); }),
    ).resolves.toBe('');
  });
});

describe('formularz zakładania firmy', () => {
  it('pokazuje nazwę z rejestracji w polu nazwy', () => {
    render(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <CompanyOnboarding defaultName="Bouw BV" />
      </NextIntlClientProvider>,
    );
    expect(document.getElementById('company-name')).toHaveValue('Bouw BV');
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
  });

  it('layout panelu podaje nazwę z rejestracji, nie pusty tekst (kontrola ujemna na starym kodzie)', () => {
    const layout = readFileSync('src/app/[locale]/employer/layout.tsx', 'utf8');
    expect(layout).toContain('readSignupCompanyName(identity.id)');
    expect(layout).toContain('defaultName={signupCompanyName}');
    expect(layout).not.toMatch(/defaultName=""/);
    // Bootstrap po potwierdzeniu e-maila korzysta z tej samej reguły odczytu nazwy.
    const actions = readFileSync('src/lib/actions/auth.ts', 'utf8');
    expect(actions).toContain("from '@/lib/auth/signup-company-name'");
    expect(actions).not.toMatch(/function companyNameFromMetadata/);
  });
});
