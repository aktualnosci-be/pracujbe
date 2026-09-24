import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import { CompanyStatusBanner } from '@/components/employer/CompanyStatusBanner';

/** #310 — pracodawca widzi uzasadnienie odrzucenia/zawieszenia na stronie firmy. */
afterEach(cleanup);

describe('CompanyStatusBanner — uzasadnienie decyzji admina (#310)', () => {
  it.each(['rejected', 'suspended'])('%s: pokazuje uzasadnienie', (status) => {
    render(<CompanyStatusBanner status={status} reason="VAT nie zgadza się z KBO" />);
    expect(screen.getByRole('status')).toHaveTextContent('bannerReasonLabel');
    expect(screen.getByRole('status')).toHaveTextContent('VAT nie zgadza się z KBO');
  });

  it('kontrola ujemna: inny status albo inny wariant — bez uzasadnienia', () => {
    render(<CompanyStatusBanner status="pending" reason="stare" />);
    expect(screen.getByRole('status')).not.toHaveTextContent('stare');
    cleanup();
    render(<CompanyStatusBanner status="rejected" variant="dashboard" reason="stare" />);
    expect(screen.getByRole('status')).not.toHaveTextContent('stare');
  });
});
