import { useTranslations } from 'next-intl';

import type { JobAvailability } from '@/lib/data/candidate';
import { TAG } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * JobAvailabilityNote — etykieta stanu oferty w historii kandydata (0206). Oferta zamknięta,
 * wygasła albo niedostępna nie ma strony publicznej, więc zamiast linku „Zobacz ofertę”
 * (404) karta pokazuje stan. Oferta publiczna i stan nieznany = nic.
 */
const KEY: Record<Exclude<JobAvailability, 'available'>, string> = {
  expired: 'jobAvailabilityExpired',
  closed: 'jobAvailabilityClosed',
  unavailable: 'jobAvailabilityUnavailable',
};

export function JobAvailabilityNote({
  availability,
  className,
}: {
  availability: JobAvailability | null | undefined;
  className?: string;
}): React.JSX.Element | null {
  const t = useTranslations('dashboard');
  if (!availability || availability === 'available') return null;
  return <span className={cn(TAG, className)}>{t(KEY[availability])}</span>;
}
