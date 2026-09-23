import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmployerStatsError } from '@/components/employer/EmployerStatsError';
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

describe('employer statistics read error', () => {
  it('keeps Polish diacritics in the user-facing messages', () => {
    expect(pl.dashboard.employerOverviewLoadError).toBe('Nie udało się wczytać statystyk. Spróbuj ponownie.');
    expect(pl.dashboard.employerFunnelLoadError).toBe('Nie udało się wczytać lejka rekrutacyjnego. Spróbuj ponownie.');
  });

  for (const [locale, messages] of [
    ['pl', pl], ['nl', nl], ['fr', fr], ['en', en],
  ] as const) {
    it(`shows a localized funnel error with retry in ${locale}`, () => {
      render(<EmployerStatsError
        title={messages.dashboard.funnelTitle}
        message={messages.dashboard.employerFunnelLoadError}
        retryLabel={messages.common.retry}
      />);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(messages.dashboard.employerFunnelLoadError);
      expect(screen.getByRole('heading', { level: 2, name: messages.dashboard.funnelTitle })).toBeVisible();
      expect(alert).not.toHaveTextContent(messages.dashboard.emptyState);
      fireEvent.click(screen.getByRole('button', { name: messages.common.retry }));
      expect(refresh).toHaveBeenCalledOnce();
    });

    it(`shows a localized overview error in ${locale}`, () => {
      render(<EmployerStatsError message={messages.dashboard.employerOverviewLoadError} retryLabel={messages.common.retry} />);
      expect(screen.getByRole('alert')).toHaveTextContent(messages.dashboard.employerOverviewLoadError);
      expect(screen.queryByRole('heading')).toBeNull();
    });
  }
});
