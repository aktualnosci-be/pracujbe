import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecentApplicationsError } from '@/components/employer/RecentApplicationsError';
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

describe('recent applications read error', () => {
  it('keeps Polish and French diacritics in the user-facing message', () => {
    expect(pl.dashboard.recentApplicationsError).toBe('Nie udało się wczytać najnowszych aplikacji. Spróbuj ponownie.');
    expect(fr.dashboard.recentApplicationsError).toBe('Impossible de charger les candidatures récentes. Réessayez.');
  });

  for (const [locale, messages] of [
    ['pl', pl], ['nl', nl], ['fr', fr], ['en', en],
  ] as const) {
    it(`shows a localized error and refreshes on retry in ${locale}`, () => {
      render(<RecentApplicationsError
        message={messages.dashboard.recentApplicationsError}
        retryLabel={messages.common.retry}
      />);
      expect(screen.getByRole('alert')).toHaveTextContent(messages.dashboard.recentApplicationsError);
      expect(screen.getByRole('alert')).not.toHaveTextContent(messages.dashboard.emptyState);
      const retry = screen.getByRole('button', { name: messages.common.retry });
      retry.focus();
      expect(retry).toHaveFocus();
      fireEvent.click(retry);
      expect(refresh).toHaveBeenCalledOnce();
    });
  }
});
