import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SortMenu } from '@/components/public/FilterSidebar';

/**
 * #233 — menu sortowania: Escape (także przy fokusie poza menu) i kliknięcie poza je zamykają,
 * wybór opcji zamyka menu (nawigacja kliencka nie odmontowuje `<details>`), bieżąca opcja ma
 * `aria-current`, a cele mają min. 44 px (`min-h-11`).
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Omit<React.ComponentProps<'a'>, 'href'> & { href: string }) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        props.onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));

afterEach(cleanup);

function renderMenu() {
  render(
    <>
      <SortMenu
        sortByLabel="Sort by"
        current="salary"
        options={[
          { value: 'newest', label: 'Newest', href: '/en/oferty-pracy' },
          { value: 'salary', label: 'Highest salary', href: '/en/oferty-pracy?sort=salary' },
        ]}
      />
      <button type="button">outside</button>
    </>,
  );
  const details = document.querySelector('details[data-sort-menu]') as HTMLDetailsElement;
  details.open = true;
  return details;
}

describe('SortMenu', () => {
  it('bieżąca opcja ma aria-current, pozostałe nie; cele ≥ 44 px', () => {
    renderMenu();
    expect(screen.getByRole('link', { name: 'Highest salary' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: 'Newest' })).not.toHaveAttribute('aria-current');
    expect(document.querySelector('summary')).toHaveClass('min-h-11');
    for (const link of screen.getAllByRole('link')) expect(link).toHaveClass('min-h-11');
  });

  it('Escape przy fokusie poza menu zamyka je i oddaje fokus przyciskowi', () => {
    const details = renderMenu();
    screen.getByRole('button', { name: 'outside' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(document.querySelector('summary'));
  });

  it('kliknięcie poza menu je zamyka, kliknięcie wewnątrz nie', () => {
    const details = renderMenu();
    fireEvent.pointerDown(document.querySelector('summary')!);
    expect(details.open).toBe(true);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(details.open).toBe(false);
  });

  it('wybór opcji zamyka menu', () => {
    const details = renderMenu();
    fireEvent.click(screen.getByRole('link', { name: 'Newest' }));
    expect(details.open).toBe(false);
  });
});
