// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SUCCESS_TOAST_MS, Toast, ToastRegion, type ToastRegionState } from '@/components/ui/toast';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

/**
 * #1054 (A11Y-04) — toasty wpisują treść do STAŁEGO regionu na żywo (polite dla sukcesu,
 * assertive dla błędu). Błąd nie znika sam, sukces znika po dłuższym czasie z pauzą przy
 * najechaniu/fokusie.
 */

function Harness({ initial = null }: { initial?: ToastRegionState | null }): React.JSX.Element {
  const [toast, setToast] = React.useState<ToastRegionState | null>(initial);
  return (
    <>
      <button type="button" onClick={() => setToast({ tone: 'success', message: 'Zapisano' })}>
        ok
      </button>
      <button type="button" onClick={() => setToast({ tone: 'error', message: 'Błąd zapisu' })}>
        fail
      </button>
      <ToastRegion toast={toast} onClose={() => setToast(null)} />
    </>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ToastRegion (#1054): współdzielony region w body', () => {
  it('wiele instancji (np. przyciski zapisu na liście kart) = jedna para regionów poza treścią', () => {
    render(
      <main>
        <ul>
          {[1, 2, 3, 4, 5].map((n) => (
            <li key={n}>
              <ToastRegion toast={null} onClose={() => undefined} />
            </li>
          ))}
        </ul>
      </main>,
    );
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    const main = screen.getByRole('main');
    expect(main).not.toContainElement(screen.getByRole('status'));
    expect(main).not.toContainElement(screen.getByRole('alert'));
  });

  it('po odmontowaniu ostatniej instancji regionów nie ma (strony bez toastów nie mają pustych live regions)', () => {
    const { unmount } = render(<ToastRegion toast={null} onClose={() => undefined} />);
    expect(screen.queryByRole('status')).not.toBeNull();
    unmount();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('kontrola ujemna: strona bez ToastRegion nie ma żadnego status/alert', () => {
    render(<p>treść</p>);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ToastRegion (#1054)', () => {
  it('regiony na żywo istnieją w DOM zanim pojawi się treść', () => {
    render(<Harness />);
    const status = screen.getByRole('status');
    const alert = screen.getByRole('alert');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(status).toBeEmptyDOMElement();
    expect(alert).toBeEmptyDOMElement();
  });

  it('to samo węzły regionu przyjmują treść (nie są montowane razem z nią)', () => {
    render(<Harness />);
    const status = screen.getByRole('status');
    const alert = screen.getByRole('alert');
    fireEvent.click(screen.getByText('ok'));
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('Zapisano');
    fireEvent.click(screen.getByText('fail'));
    expect(screen.getByRole('alert')).toBe(alert);
    expect(alert).toHaveTextContent('Błąd zapisu');
    expect(status).toBeEmptyDOMElement();
  });

  it('karta w regionie nie dokłada własnej roli (jedno ogłoszenie)', () => {
    render(<Harness initial={{ tone: 'error', message: 'X' }} />);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('błąd nie znika sam, znika po zamknięciu', () => {
    render(<Harness initial={{ tone: 'error', message: 'Błąd zapisu' }} />);
    act(() => void vi.advanceTimersByTime(10 * 60 * 1000));
    expect(screen.getByRole('alert')).toHaveTextContent('Błąd zapisu');
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('sukces znika dopiero po SUCCESS_TOAST_MS (dłużej niż dawne 4 s)', () => {
    expect(SUCCESS_TOAST_MS).toBeGreaterThan(4000);
    render(<Harness initial={{ tone: 'success', message: 'Zapisano' }} />);
    act(() => void vi.advanceTimersByTime(SUCCESS_TOAST_MS - 1));
    expect(screen.getByRole('status')).toHaveTextContent('Zapisano');
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('najechanie i fokus wstrzymują znikanie sukcesu', () => {
    render(<Harness initial={{ tone: 'success', message: 'Zapisano' }} />);
    const card = screen.getByText('Zapisano').parentElement!;
    fireEvent.mouseEnter(card);
    act(() => void vi.advanceTimersByTime(SUCCESS_TOAST_MS * 3));
    expect(screen.getByRole('status')).toHaveTextContent('Zapisano');
    fireEvent.mouseLeave(card);
    act(() => void vi.advanceTimersByTime(SUCCESS_TOAST_MS));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    fireEvent.click(screen.getByText('ok'));
    const card2 = screen.getByText('Zapisano').parentElement!;
    fireEvent.focus(card2);
    act(() => void vi.advanceTimersByTime(SUCCESS_TOAST_MS * 3));
    expect(screen.getByRole('status')).toHaveTextContent('Zapisano');
    fireEvent.blur(card2);
    act(() => void vi.advanceTimersByTime(SUCCESS_TOAST_MS));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('kontrola ujemna: samodzielny Toast (bez regionu) montuje własny role=status razem z treścią', () => {
    render(<Toast message="Zapisano" tone="success" />);
    expect(screen.getByRole('status')).toHaveTextContent('Zapisano');
  });

  it('kontrola ujemna: samodzielny błąd nie znika sam i nie ma auto-zamknięcia bez autoDismissMs', () => {
    const onClose = vi.fn();
    render(<Toast message="Błąd" tone="error" onClose={onClose} autoDismissMs={1000} />);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(onClose).not.toHaveBeenCalled();
  });
});
