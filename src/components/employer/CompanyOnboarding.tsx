import * as React from 'react';
import { useTranslations } from 'next-intl';

import { CompanyForm } from '@/components/employer/CompanyForm';
import { DEMO_NOTE, EYEBROW, H1, INTRO, PAPER } from '@/components/dashboard/panel-styles';
import {
  MyTeamInvitations,
  type MyTeamInvitationView,
} from '@/components/employer/team/MyTeamInvitations';

/**
 * Zakładanie firmy przez ZALOGOWANEGO pracodawcę bez członkostwa (#365) — np. gdy bootstrap
 * po potwierdzeniu e-maila się nie udał. Renderowane przez layout panelu zamiast strony
 * (każda podstrona `/employer/*`) oraz przez `/employer/firma`. Nazwa z rejestracji
 * (`user_metadata.company_name`) wypełnia formularz; zapis jest idempotentny
 * (`create_first_company`), więc ponowne kliknięcie nie tworzy drugiej firmy.
 * #403: nad formularzem zaproszenia do istniejących zespołów — zamiast zakładać własną firmę
 * można dołączyć do firmy, która zaprosiła ten adres.
 */
export function CompanyOnboarding({
  defaultName,
  invitations = [],
}: {
  defaultName?: string;
  invitations?: MyTeamInvitationView[];
}): React.JSX.Element {
  const t = useTranslations('company');

  return (
    <div className="min-w-0 max-w-4xl space-y-[22px]">
      <header className="min-w-0">
        <p className={EYEBROW}>{t('onboardingEyebrow')}</p>
        <h1 className={H1}>{t('createTitle')}</h1>
        <p className={INTRO}>{t('createSubtitle')}</p>
      </header>

      <MyTeamInvitations invitations={invitations} />

      <section className={PAPER}>
        <p className={DEMO_NOTE}>{t('verificationNote')}</p>
        <CompanyForm mode="create" defaultValues={{ name: defaultName ?? '' }} />
      </section>
    </div>
  );
}
