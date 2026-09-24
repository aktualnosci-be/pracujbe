import { isLocale, type Locale } from '@/i18n/routing';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';
import type { SalaryLabels } from '@/lib/salary';

// Osobny moduł, żeby komponenty z `formatSalaryRange` nie wciągały wszystkich plików tłumaczeń.
type PassportMessages = typeof pl.jobs.passport;

const PASSPORT: Record<Locale, PassportMessages> = {
  pl: pl.jobs.passport,
  nl: nl.jobs.passport,
  fr: fr.jobs.passport,
  en: en.jobs.passport,
};

/**
 * Etykiety „od/do/okres” z `src/messages` dla kodu bez next-intl (worker e-maili). Te same
 * klucze `jobs.passport.*` co w UI — jedno źródło tekstów. Nieobsługiwany locale → 'en'.
 */
export function salaryLabelsFor(locale: string): SalaryLabels {
  const m = PASSPORT[isLocale(locale) ? locale : 'en'];
  return {
    from: (value) => m.salaryFrom.replace('{value}', value),
    to: (value) => m.salaryTo.replace('{value}', value),
    period: (period) => m.salaryPeriods[period],
  };
}
