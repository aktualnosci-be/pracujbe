import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CompanySwitcher } from '@/components/employer/CompanySwitcher';

const { refresh, setActiveCompany } = vi.hoisted(() => ({
  refresh: vi.fn(),
  setActiveCompany: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/actions/company', () => ({ setActiveCompany }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const companies = [
  { id: 'first', name: 'Firma Pierwsza', role: 'owner' },
  { id: 'second', name: 'Firma Druga', role: 'owner' },
];

describe('CompanySwitcher na jasnym sidebarze', () => {
  it.each([1, 2])('zachowuje czytelne oznaczenie firmy przy liczbie firm: %s', (count) => {
    const { container } = render(
      <CompanySwitcher companies={companies.slice(0, count)} activeId="first" activeName="Firma Pierwsza" />,
    );
    const label = container.querySelector('summary') ?? container.firstElementChild;
    expect(label).not.toBeNull();
    const content = within(label as HTMLElement);

    // Obie gałęzie muszą używać tekstu dla jasnej powierzchni sidebara.
    expect(content.getByText('Firma Pierwsza')).toHaveClass('text-foreground');
    expect(content.getByText('FP')).toHaveClass('text-foreground', 'bg-soft');
    expect(content.getByText('employerRole')).toHaveClass('text-muted-foreground');
    if (count > 1) {
      expect(label?.querySelector('svg')).toHaveClass('text-muted-foreground');
    }
  });

  it('po zmianie firmy zapisuje wybór, zamyka listę i odświeża panel', async () => {
    const { container } = render(
      <CompanySwitcher companies={companies} activeId="first" activeName="Firma Pierwsza" />,
    );
    const details = container.querySelector('details')!;
    details.open = true;
    fireEvent.click(screen.getByRole('button', { name: 'Firma Druga' }));

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(setActiveCompany).toHaveBeenCalledExactlyOnceWith('second');
    expect(details.open).toBe(false);
  });
});
