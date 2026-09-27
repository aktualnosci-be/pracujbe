import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { BTN_SMALL } from '@/components/dashboard/panel-styles';
import {
  APPLICATION_FILTER_LABEL_KEYS,
  APPLICATION_FILTERS,
  applicationFilterHref,
  type ApplicationFilter,
} from '@/lib/candidate-application-filter';
import { cn } from '@/lib/utils';

const ACTIVE = 'border-primary text-primary';
const IDLE = 'border-[color:var(--pp-line-btn)] text-foreground';

/**
 * Filtr etapu „Moich zgłoszeń” (#809) — zwykłe linki (działa bez JavaScriptu), stan w URL,
 * bieżący etap oznaczony `aria-current` jak filtr listy powiadomień. Zmiana etapu = nowa
 * strona z serwera, więc kursor „Pokaż więcej” startuje od początku.
 */
export function CandidateApplicationsFilter({ current }: { current: ApplicationFilter | null }) {
  const t = useTranslations('dashboard');
  const options: Array<{ filter: ApplicationFilter | null; label: string }> = [
    { filter: null, label: t('applicationsFilterAll') },
    ...APPLICATION_FILTERS.map((filter) => ({ filter, label: t(APPLICATION_FILTER_LABEL_KEYS[filter]) })),
  ];

  return (
    <nav aria-label={t('applicationsFilterLabel')} className="mb-5 flex min-w-0 flex-wrap gap-2">
      {options.map(({ filter, label }) => {
        const selected = filter === current;
        return (
          <Link
            key={filter ?? 'all'}
            href={applicationFilterHref(filter)}
            aria-current={selected ? 'page' : undefined}
            className={cn(BTN_SMALL, selected ? ACTIVE : IDLE)}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
