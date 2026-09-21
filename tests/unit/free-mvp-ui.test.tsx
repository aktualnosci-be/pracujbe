import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/i18n/navigation', () => ({
  redirect,
  usePathname: () => '/employer',
}));

vi.mock('@/components/employer/CompanySwitcher', () => ({
  CompanySwitcher: () => <span>company</span>,
}));

vi.mock('@/components/dashboard/DashboardShell', () => ({
  DashboardShell: ({
    nav,
    children,
  }: {
    nav: Array<{ href: string; label: string }>;
    children: ReactNode;
  }) => (
    <>
      <nav>
        {nav.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
      </nav>
      {children}
    </>
  ),
}));

import EmployerBillingPage from '@/app/[locale]/employer/platnosci/page';
import { EmployerShell } from '@/components/employer/EmployerShell';

describe('powierzchnie bezpłatnego MVP', () => {
  it('nie pokazuje płatności w nawigacji panelu pracodawcy', () => {
    render(
      <EmployerShell>
        <main>panel</main>
      </EmployerShell>,
    );

    expect(screen.queryByRole('link', { name: 'navPayments' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /pakiet|payment|paiement|betaling/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'navOffers' })).toHaveAttribute('href', '/employer/oferty');
  });

  it.each(['pl', 'nl', 'fr', 'en'] as const)(
    'przekierowuje dawny adres płatności dla locale %s',
    async (locale) => {
      redirect.mockClear();

      await EmployerBillingPage({ params: Promise.resolve({ locale }) });

      expect(redirect).toHaveBeenCalledOnce();
      expect(redirect).toHaveBeenCalledWith({ href: '/employer', locale });
    },
  );
});
