import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LocaleError from '@/app/[locale]/error';
import { CandidateListError } from '@/components/candidate/CandidateListError';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

const calls: string[] = [];
const refresh = vi.fn(() => calls.push('refresh'));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

beforeEach(() => {
  calls.length = 0;
  refresh.mockClear();
});
afterEach(cleanup);

const locales = [['pl', pl], ['nl', nl], ['fr', fr], ['en', en]] as const;

describe('ponowienie w granicach błędów pobiera świeże dane serwera', () => {
  it.each(locales)('[locale]/error.tsx (%s): refresh + reset', (locale, messages) => {
    const reset = vi.fn(() => calls.push('reset'));
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <LocaleError error={new Error('boom')} reset={reset} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: messages.common.retry }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
    expect(calls).toEqual(['refresh', 'reset']);
  });

  it.each(locales)('CandidateListError (%s): refresh + reset', (locale, messages) => {
    const reset = vi.fn(() => calls.push('reset'));
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <CandidateListError error={new Error('boom')} reset={reset} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: messages.dashboard.candidateListRetry }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
    expect(calls).toEqual(['refresh', 'reset']);
  });
});
