import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LightDialogContent, LightDialogRoot } from '@/components/ui/light-dialog';

afterEach(cleanup);

function Harness({ open }: { open: boolean }) {
  return (
    <LightDialogRoot open={open}>
      <LightDialogContent open={open} aria-describedby={undefined}>
        <Dialog.Title>Tytuł</Dialog.Title>
        <button type="button">Akcja</button>
      </LightDialogContent>
    </LightDialogRoot>
  );
}

const rootOverflow = () => document.documentElement.style.overflow;

describe('LightDialog (#393)', () => {
  it('zamknięty dialog nie blokuje przewijania ani nie ukrywa strony', () => {
    render(<Harness open={false} />);
    expect(rootOverflow()).toBe('');
    expect(document.querySelector('[data-aria-hidden]')).toBeNull();
  });

  it('otwarty blokuje przewijanie na <html>, bez mutacji <body> i <head>; zamknięcie przywraca stan', () => {
    const headStyles = document.head.querySelectorAll('style').length;
    const { rerender } = render(<Harness open />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(rootOverflow()).toBe('hidden');
    expect(document.body.style.pointerEvents).toBe('');
    expect(document.head.querySelectorAll('style')).toHaveLength(headStyles);
    act(() => rerender(<Harness open={false} />));
    expect(rootOverflow()).toBe('');
  });

  it('dwa otwarte dialogi zwalniają blokadę dopiero po zamknięciu ostatniego', () => {
    const first = render(<Harness open />);
    const second = render(<Harness open />);
    expect(rootOverflow()).toBe('hidden');
    act(() => first.unmount());
    expect(rootOverflow()).toBe('hidden');
    act(() => second.unmount());
    expect(rootOverflow()).toBe('');
  });
});
