import * as React from 'react';
import { useTranslations } from 'next-intl';

import { CompanyForm } from '@/components/employer/CompanyForm';

/**
 * Zakładanie firmy przez ZALOGOWANEGO pracodawcę bez członkostwa (#365) — np. gdy bootstrap
 * po potwierdzeniu e-maila się nie udał. Renderowane przez layout panelu zamiast strony
 * (każda podstrona `/employer/*`) oraz przez `/employer/firma`. Nazwa z rejestracji
 * (`user_metadata.company_name`) wypełnia formularz; zapis jest idempotentny
 * (`create_first_company`), więc ponowne kliknięcie nie tworzy drugiej firmy.
 */
export function CompanyOnboarding({ defaultName }: { defaultName?: string }): React.JSX.Element {
  const t = useTranslations('company');

  return (
    <div className="max-w-4xl space-y-6">
      <header className="overflow-hidden rounded-3xl bg-foreground px-5 py-7 text-background sm:px-8 sm:py-9">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-background/70">
          {t('onboardingEyebrow')}
        </p>
        <h1 className="mt-4 break-words text-2xl font-bold tracking-tight sm:text-3xl">
          {t('createTitle')}
        </h1>
        <p className="mt-1 text-sm text-background/80">{t('createSubtitle')}</p>
      </header>

      <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
        <p className="text-sm text-muted-foreground">{t('verificationNote')}</p>
        <div className="mt-4">
          <CompanyForm mode="create" defaultValues={{ name: defaultName ?? '' }} />
        </div>
      </section>
    </div>
  );
}
