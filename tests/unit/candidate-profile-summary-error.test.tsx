import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileSummaryError } from '@/components/candidate/ProfileSummaryError';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

const refresh = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
afterEach(cleanup);

describe('błąd podsumowania profilu', () => {
  it.each([['pl', pl], ['nl', nl], ['fr', fr], ['en', en]] as const)(
    'pokazuje komunikat i ponowienie w %s', (_, messages) => {
      refresh.mockClear();
      render(<ProfileSummaryError message={messages.candidatePassport.loadError} retry={messages.common.retry} />);
      expect(screen.getByRole('alert')).toHaveTextContent(messages.candidatePassport.loadError);
      const retry = screen.getByRole('button', { name: messages.common.retry });
      retry.focus();
      expect(retry).toHaveFocus();
      fireEvent.click(retry);
      expect(refresh).toHaveBeenCalledOnce();
      expect(screen.queryByText('0%')).not.toBeInTheDocument();
    },
  );
});
