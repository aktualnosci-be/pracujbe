import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GlobalError, { GlobalErrorContent } from '@/app/global-error';
import { captureError } from '@/lib/error-report';

vi.mock('@/lib/error-report', () => ({ captureError: vi.fn(), setErrorReporter: vi.fn() }));

beforeEach(() => vi.mocked(captureError).mockClear());

const OLD_NAVY = 'rgb(15, 42, 71)';

function expectApprovedPalette(button: HTMLButtonElement, tile: HTMLElement): void {
  expect(tile).toHaveStyle({ backgroundColor: '#D92932', color: '#FFFFFF' });
  expect(tile.style.backgroundColor).not.toBe(OLD_NAVY);
  expect(button).toHaveStyle({ backgroundColor: '#D92932' });
  expect(button.style.backgroundColor).not.toBe(OLD_NAVY);
}

function expectApprovedTarget(button: HTMLButtonElement): void {
  expect(button).toHaveStyle({ minHeight: '48px' });
  expect(Number.parseFloat(button.style.minHeight)).toBeGreaterThanOrEqual(48);
}

describe('globalny ekran błędu w fundamencie marki', () => {
  it('samodzielny dokument używa białego tła i czarnego tekstu bez arkusza globalnego', () => {
    const html = renderToStaticMarkup(<GlobalError error={new Error('test')} reset={vi.fn()} />);
    expect(html).toContain('background:#FFFFFF');
    expect(html).toContain('color:#151515');
    expect(html).not.toContain('#0F2A47');
    expect(html).not.toContain('#172033');
  });

  it('zachowuje języki, zatwierdzony znak, monitoring, reset i widoczny fokus CTA', async () => {
    const reset = vi.fn();
    const error = Object.assign(new Error('awaria testowa'), { digest: 'digest-1' });
    render(<GlobalErrorContent error={error} reset={reset} />);

    const logo = screen.getByRole('img', { name: 'Pracuj.be' });
    const tile = logo.querySelector('span:last-child') as HTMLElement;
    const button = screen.getByRole('button', { name: /Spróbuj ponownie/ }) as HTMLButtonElement;

    expect(logo).toHaveTextContent('pracuj.be');
    expectApprovedPalette(button, tile);
    expectApprovedTarget(button);
    for (const lang of ['pl', 'nl', 'fr', 'en']) {
      expect(document.querySelectorAll(`[lang="${lang}"]`).length).toBeGreaterThanOrEqual(3);
      expect(button.querySelector(`[lang="${lang}"]`)).not.toBeNull();
    }
    await waitFor(() => expect(captureError).toHaveBeenCalledWith(error, {
      area: 'global-error', digest: 'digest-1',
    }));
    expect(captureError).toHaveBeenCalledTimes(1);

    fireEvent.focus(button);
    expect(button.style.outlineColor).toBe('rgb(21, 21, 21)');
    fireEvent.blur(button);
    expect(button.style.outlineColor).toBe('transparent');
    fireEvent.click(button);
    expect(reset).toHaveBeenCalledOnce();
  });

  it('kontrola ujemna odrzuca sam stary granat', () => {
    const { container } = render(<GlobalErrorContent error={new Error('test')} reset={vi.fn()} />);
    const tile = screen.getByRole('img', { name: 'Pracuj.be' }).querySelector('span:last-child') as HTMLElement;
    const button = container.querySelector('button') as HTMLButtonElement;

    button.style.backgroundColor = '#0F2A47';
    expectApprovedTarget(button);
    expect(() => expectApprovedPalette(button, tile)).toThrow();
  });

  it('kontrola ujemna odrzuca sam cel niższy niż 48 px', () => {
    const { container } = render(<GlobalErrorContent error={new Error('test')} reset={vi.fn()} />);
    const tile = screen.getByRole('img', { name: 'Pracuj.be' }).querySelector('span:last-child') as HTMLElement;
    const button = container.querySelector('button') as HTMLButtonElement;

    button.style.minHeight = '47px';
    expectApprovedPalette(button, tile);
    expect(() => expectApprovedTarget(button)).toThrow();
  });
});
