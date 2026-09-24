// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BannerPngButton } from '@/components/employer/BannerPngButton';

const LABELS = { download: 'Pobierz PNG', pending: 'Przygotowywanie PNG…', error: 'Nie udało się', name: '300 × 250 px' };

afterEach(() => {
  cleanup();
  delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
});

describe('BannerPngButton (#175)', () => {
  it('ma nazwę z formatem, blokuje się podczas pracy i pokazuje błąd przy nieudanym obrazie', async () => {
    let reject: (error: Error) => void = () => {};
    // jsdom nie ma `decode` — podstawiamy obraz, którego dekodowanie kontrolujemy.
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: () => new Promise<void>((_, r) => (reject = r)),
    });
    render(<BannerPngButton src="/api/x" filename="a.png" width={300} height={250} labels={LABELS} />);
    const button = screen.getByRole('button', { name: 'Pobierz PNG — 300 × 250 px' });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute('aria-busy', 'true');
    reject(new Error('decode'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nie udało się');
    expect(button).not.toBeDisabled();
  });
});
