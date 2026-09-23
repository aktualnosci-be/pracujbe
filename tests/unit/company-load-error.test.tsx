import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompanyLoadError } from '@/components/employer/CompanyLoadError';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';

const refresh = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => {
  cleanup();
  refresh.mockClear();
});

describe('company read error', () => {
  for (const [locale, messages] of [
    ['pl', pl],
    ['nl', nl],
    ['fr', fr],
    ['en', en],
  ] as const) {
    it(`offers an accessible retry in ${locale} without a creation form`, () => {
      render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <CompanyLoadError />
        </NextIntlClientProvider>,
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        messages.company.loadError,
      );
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      const retry = screen.getByRole('button', { name: messages.common.retry });
      retry.focus();
      expect(retry).toHaveFocus();
      fireEvent.click(retry);
      expect(refresh).toHaveBeenCalledOnce();
    });
  }
});
