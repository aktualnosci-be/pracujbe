import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobMatchCard } from '@/components/public/JobMatchCard';
import { getMyJobMatchAction } from '@/lib/actions/matching';
import { scoreMatch } from '@/lib/matching/score';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/** #197: błąd odczytu dopasowania → komunikat z ponowieniem, nigdy procent. */

vi.mock('@/lib/actions/matching', () => ({ getMyJobMatchAction: vi.fn() }));

const result = scoreMatch(
  { occupations: ['forklift'], categories: ['warehouse'], skills: [], languages: [], certificates: [], hasDrivingLicense: false, hasCar: false, preferredContractTypes: [] },
  { occupation: 'forklift', category: 'warehouse', skills: [], mandatorySkills: [], requiredLanguages: [], requiredCertificates: [], requiresDrivingLicense: false, startImmediately: false, remote: false },
);

beforeEach(() => {
  vi.mocked(getMyJobMatchAction).mockReset();
});
afterEach(cleanup);

for (const [locale, messages] of Object.entries({ pl, nl, fr, en })) {
  const view = () => render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <JobMatchCard jobId="job-1" />
    </NextIntlClientProvider>,
  );

  describe(`JobMatchCard (${locale})`, () => {
    it('błąd odczytu: alert z ponowieniem, bez procentu', async () => {
      vi.mocked(getMyJobMatchAction).mockResolvedValue({ status: 'error' });
      view();
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(messages.match.loadError);
      expect(alert.textContent).not.toMatch(/\d+\s?%/);
      expect(screen.queryByText(messages.match.summary.low)).toBeNull();
    });

    it('odrzucone wywołanie akcji też daje stan błędu', async () => {
      vi.mocked(getMyJobMatchAction).mockRejectedValue(new Error('network'));
      view();
      expect((await screen.findByRole('alert')).textContent).toContain(messages.match.loadError);
    });

    it('ponowienie odpytuje ponownie i pokazuje wynik po sukcesie', async () => {
      vi.mocked(getMyJobMatchAction)
        .mockResolvedValueOnce({ status: 'error' })
        .mockResolvedValueOnce({ status: 'ok', result });
      view();
      fireEvent.click(await screen.findByRole('button', { name: messages.common.retry }));
      await waitFor(() => expect(screen.getByText(`${result.score}%`)).toBeTruthy());
      expect(screen.queryByRole('alert')).toBeNull();
      expect(getMyJobMatchAction).toHaveBeenCalledTimes(2);
    });

    it('none (anonim/brak profilu): nic nie renderuje', async () => {
      vi.mocked(getMyJobMatchAction).mockResolvedValue({ status: 'none' });
      const { container } = view();
      await waitFor(() => expect(getMyJobMatchAction).toHaveBeenCalled());
      expect(container.textContent).toBe('');
    });
  });
}
