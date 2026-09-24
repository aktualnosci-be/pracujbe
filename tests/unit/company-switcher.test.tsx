import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanySwitcher } from '@/components/employer/CompanySwitcher';

const { refresh, setActiveCompany } = vi.hoisted(() => ({
  refresh: vi.fn(),
  setActiveCompany: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/actions/company', () => ({ setActiveCompany }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  setActiveCompany.mockResolvedValue({ ok: true });
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

  it('nazwa dostępna zawiera widoczną nazwę aktywnej firmy, a aktywna pozycja ma aria-current (#322)', () => {
    const { container } = render(
      <CompanySwitcher companies={companies} activeId="first" activeName="Firma Pierwsza" />,
    );
    const summary = container.querySelector('summary')!;
    expect(summary).not.toHaveAttribute('aria-label');
    expect(summary).toHaveTextContent('switchCompany');
    expect(summary).toHaveTextContent('Firma Pierwsza');
    expect(screen.getByRole('button', { name: 'Firma Pierwsza' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Firma Druga' })).not.toHaveAttribute('aria-current');
  });

  it('odrzucona zmiana pokazuje komunikat, nie odświeża panelu i oddaje fokus przełącznikowi (#322)', async () => {
    setActiveCompany.mockResolvedValue({ ok: false });
    const { container } = render(
      <CompanySwitcher companies={companies} activeId="first" activeName="Firma Pierwsza" />,
    );
    const details = container.querySelector('details')!;
    details.open = true;
    fireEvent.click(screen.getByRole('button', { name: 'Firma Druga' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('switchCompanyError');
    expect(refresh).not.toHaveBeenCalled();
    expect(details.open).toBe(false);
    expect(container.querySelector('summary')).toHaveFocus();
  });

  it('wyjątek akcji traktuje jak nieudaną zmianę', async () => {
    setActiveCompany.mockRejectedValue(new Error('network'));
    const { container } = render(
      <CompanySwitcher companies={companies} activeId="first" activeName="Firma Pierwsza" />,
    );
    container.querySelector('details')!.open = true;
    fireEvent.click(screen.getByRole('button', { name: 'Firma Druga' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('switchCompanyError');
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([1, 2])('link „Dodaj kolejną firmę” jest osiągalny przy liczbie firm: %s (#403)', (count) => {
    const { container } = render(
      <CompanySwitcher companies={companies.slice(0, count)} activeId="first" activeName="Firma Pierwsza" />,
    );
    if (count > 1) container.querySelector('details')!.open = true;
    expect(screen.getByRole('link', { name: 'addCompany' })).toHaveAttribute('href', '/employer/firma/nowa');
  });
});
