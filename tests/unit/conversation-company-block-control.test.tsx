import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationCompanyBlockControl } from '@/components/messaging/ConversationCompanyBlockControl';
import { setCompanyBlockAction } from '@/lib/actions/company-blocks';
import pl from '@/messages/pl.json';

vi.mock('@/lib/actions/company-blocks', () => ({
  setCompanyBlockAction: vi.fn(),
}));

const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const t = pl.companyBlocks;

function renderControl(initialBlocked: boolean) {
  return render(
    <NextIntlClientProvider locale="pl" messages={pl}>
      <ConversationCompanyBlockControl companyId={COMPANY} companyName="Firma X" initialBlocked={initialBlocked} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('ConversationCompanyBlockControl (#832)', () => {
  it('renderuje stan początkowy z serwera bez dodatkowego odczytu (nieblokowana)', () => {
    renderControl(false);
    expect(screen.getByRole('button', { name: t.block })).toBeEnabled();
    expect(screen.getByText(t.conversationDescription.replace('{company}', 'Firma X'))).toBeVisible();
  });

  it('renderuje stan początkowy z serwera bez dodatkowego odczytu (już zablokowana)', () => {
    renderControl(true);
    expect(screen.getByRole('button', { name: t.unblock })).toBeEnabled();
    expect(screen.getByText(t.conversationBlockedDescription.replace('{company}', 'Firma X'))).toBeVisible();
  });

  it('blokuje firmę z wątku; każde kliknięcie = jedno żądanie', async () => {
    vi.mocked(setCompanyBlockAction).mockResolvedValueOnce({ ok: true, blocked: true });
    renderControl(false);

    fireEvent.click(screen.getByRole('button', { name: t.block }));
    expect(await screen.findByRole('status')).toHaveTextContent('Firma Firma X została zablokowana.');
    expect(setCompanyBlockAction).toHaveBeenCalledExactlyOnceWith(COMPANY, true);
    expect(await screen.findByRole('button', { name: t.unblock })).toBeEnabled();
  });

  it('odblokowuje firmę z wątku', async () => {
    vi.mocked(setCompanyBlockAction).mockResolvedValueOnce({ ok: true, blocked: false });
    renderControl(true);

    fireEvent.click(screen.getByRole('button', { name: t.unblock }));
    expect(await screen.findByRole('status')).toHaveTextContent('Firma Firma X została odblokowana.');
    expect(setCompanyBlockAction).toHaveBeenCalledExactlyOnceWith(COMPANY, false);
    expect(await screen.findByRole('button', { name: t.block })).toBeEnabled();
  });

  it('błąd zapisu: komunikat bez technikaliów, stan bez zmian', async () => {
    vi.mocked(setCompanyBlockAction).mockResolvedValue({ ok: false, error: 'INTERNAL' });
    renderControl(false);

    fireEvent.click(screen.getByRole('button', { name: t.block }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.saveError);
    expect(screen.getByRole('button', { name: t.block })).toBeEnabled();
  });
});
