import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobCompanyBlockControl } from '@/components/public/JobCompanyBlockControl';
import { getJobCompanyBlockAction, setCompanyBlockAction } from '@/lib/actions/company-blocks';
import pl from '@/messages/pl.json';

vi.mock('@/lib/actions/company-blocks', () => ({
  getJobCompanyBlockAction: vi.fn(),
  setCompanyBlockAction: vi.fn(),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const t = pl.companyBlocks;

function renderControl() {
  return render(
    <NextIntlClientProvider locale="pl" messages={pl}>
      <JobCompanyBlockControl jobId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('JobCompanyBlockControl (#97)', () => {
  it('gość / pracodawca / błąd odczytu → nic nie renderuje', async () => {
    for (const load of [{ status: 'none' }, { status: 'error' }] as const) {
      vi.mocked(getJobCompanyBlockAction).mockResolvedValueOnce(load);
      const { container, unmount } = renderControl();
      await waitFor(() => expect(getJobCompanyBlockAction).toHaveBeenCalled());
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('kandydat blokuje, potem odblokowuje firmę; każde kliknięcie = jedno żądanie', async () => {
    vi.mocked(getJobCompanyBlockAction).mockResolvedValue({
      status: 'ready', companyId: COMPANY, companyName: 'Firma X', blocked: false,
    });
    vi.mocked(setCompanyBlockAction)
      .mockResolvedValueOnce({ ok: true, blocked: true })
      .mockResolvedValueOnce({ ok: true, blocked: false });
    renderControl();

    fireEvent.click(await screen.findByRole('button', { name: t.block }));
    expect(await screen.findByRole('status')).toHaveTextContent('Firma Firma X została zablokowana.');
    expect(setCompanyBlockAction).toHaveBeenLastCalledWith(COMPANY, true);

    fireEvent.click(screen.getByRole('button', { name: t.unblock }));
    expect(await screen.findByRole('button', { name: t.block })).toBeEnabled();
    expect(setCompanyBlockAction).toHaveBeenLastCalledWith(COMPANY, false);
    expect(setCompanyBlockAction).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('link', { name: t.manage })).toHaveAttribute('href', '/candidate/ustawienia#company-blocks-title');
  });

  it('błąd zapisu: komunikat bez technikaliów, stan bez zmian', async () => {
    vi.mocked(getJobCompanyBlockAction).mockResolvedValue({
      status: 'ready', companyId: COMPANY, companyName: 'Firma X', blocked: true,
    });
    vi.mocked(setCompanyBlockAction).mockResolvedValue({ ok: false, error: 'INTERNAL' });
    renderControl();

    fireEvent.click(await screen.findByRole('button', { name: t.unblock }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.saveError);
    expect(screen.getByRole('button', { name: t.unblock })).toBeEnabled();
  });
});
