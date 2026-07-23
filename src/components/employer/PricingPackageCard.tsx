import * as React from 'react';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * PricingPackageCard — karta „Twój pakiet" panelu pracodawcy (makieta 05).
 *
 * Pokazuje aktualny plan (Standard), datę ważności oraz listę cech z zielonymi ptaszkami
 * (limit ofert, widoczność, dostęp do bazy CV) i przycisk „Zmień pakiet" (granatowy).
 * Chrome z i18n `dashboard.*`; wartości (data ważności, wykorzystanie ofert) to dane DEMO
 * przekazywane z ekranu — backend niepodpięty (TODO(data)).
 */

export interface PricingPackageCardProps {
  /** Data ważności pakietu (już sformatowana, np. „24.06.2025"). Dane, nie chrome. */
  activeUntil: string;
  offersUsed: number;
  offersTotal: number;
  className?: string;
}

export function PricingPackageCard({
  activeUntil,
  offersUsed,
  offersTotal,
  className,
}: PricingPackageCardProps): React.JSX.Element {
  const td = useTranslations('dashboard');

  const features = [
    td('featOffers', { used: offersUsed, total: offersTotal }),
    td('featVisibility'),
    td('featCvAccess'),
  ];

  return (
    <section className={cn('rounded-lg border border-border bg-card', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:px-5">
        <h2 className="text-base font-semibold text-foreground">{td('yourPackage')}</h2>
        <Link
          href="/employer/platnosci"
          className="shrink-0 text-sm font-medium text-accent hover:underline"
        >
          {td('managePackage')}
        </Link>
      </div>

      <div className="p-4 sm:p-5">
        <p className="text-lg font-bold text-accent">{td('packageName')}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {td('activeUntil', { date: activeUntil })}
        </p>

        <ul className="mt-4 space-y-2.5">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5 text-sm text-foreground">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        {/* TODO(data): zmiana pakietu — podpiąć przepływ płatności w osobnym etapie. */}
        <Button asChild className="mt-5 w-full">
          <Link href="/employer/platnosci">{td('changePackage')}</Link>
        </Button>
      </div>
    </section>
  );
}
