import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

describe('powierzchnie bezpłatnego MVP', () => {
  it('nie pokazuje w panelu nawigacji ani karty prowadzącej do sprzedaży', () => {
    const shell = readFileSync(join(ROOT, 'src/components/employer/EmployerShell.tsx'), 'utf8');
    const dashboard = readFileSync(join(ROOT, 'src/app/[locale]/employer/page.tsx'), 'utf8');

    expect(shell).not.toContain('/employer/platnosci');
    expect(shell).not.toContain("td('navPayments')");
    expect(dashboard).not.toContain('PricingPackageCard');
    expect(existsSync(join(ROOT, 'src/components/employer/PricingPackageCard.tsx'))).toBe(false);
    expect(existsSync(join(ROOT, 'src/components/employer/billing/CheckoutButton.tsx'))).toBe(false);
  });

  it('przekierowuje dawny wielojęzyczny adres płatności do panelu pracodawcy', () => {
    const page = readFileSync(join(ROOT, 'src/app/[locale]/employer/platnosci/page.tsx'), 'utf8');

    expect(page).toContain("redirect({ href: '/employer', locale })");
    expect(page).not.toContain('CheckoutButton');
    expect(page).not.toContain('DiscountForm');
    expect(page).not.toContain('CancelSubscriptionButton');
  });
});
