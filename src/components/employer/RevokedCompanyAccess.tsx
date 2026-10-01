import * as React from 'react';
import { useTranslations } from 'next-intl';

import { CompanyForm } from '@/components/employer/CompanyForm';
import { DEMO_NOTE, EYEBROW, H1, INTRO, PANEL_H2, PAPER } from '@/components/dashboard/panel-styles';
import {
  MyTeamInvitations,
  type MyTeamInvitationView,
} from '@/components/employer/team/MyTeamInvitations';

/**
 * Konto pracodawcy, któremu odebrano dostęp do firmy (tylko nieaktywne członkostwa) — #1210,
 * decyzja właściciela 29.09.2026. Zamiast formularza `create_first_company` (który w tym stanie
 * zawsze kończy się PERMISSION_DENIED) panel pokazuje jasny komunikat „Twój dostęp do firmy X
 * został odebrany” — bez szczegółów (kto, kiedy, dlaczego) — zaproszenia do innych zespołów
 * i formularz własnej firmy przez `create_additional_company` (`CompanyForm mode="add"`:
 * owner, `unverified`, limit i audyt w bazie; po sukcesie panel przełącza się na nową firmę).
 */
export function RevokedCompanyAccess({
  companyNames,
  invitations = [],
}: {
  companyNames: string[];
  invitations?: MyTeamInvitationView[];
}): React.JSX.Element {
  const t = useTranslations('company');

  return (
    <div className="min-w-0 max-w-4xl space-y-[22px]" data-revoked-company-access>
      <header className="min-w-0">
        <p className={EYEBROW}>{t('onboardingEyebrow')}</p>
        <h1 className={H1}>{t('accessRevokedTitle')}</h1>
        {companyNames.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {companyNames.map((name) => (
              <li key={name} className={INTRO}>
                {t('accessRevokedNamed', { name })}
              </li>
            ))}
          </ul>
        ) : (
          <p className={INTRO}>{t('accessRevokedGeneric')}</p>
        )}
        <p className={INTRO}>{t('accessRevokedNext')}</p>
      </header>

      <MyTeamInvitations invitations={invitations} />

      <section className={PAPER} aria-labelledby="revoked-create-company">
        <h2 id="revoked-create-company" className={PANEL_H2}>
          {t('accessRevokedCreateTitle')}
        </h2>
        <p className={DEMO_NOTE}>{t('verificationNote')}</p>
        <CompanyForm mode="add" />
      </section>
    </div>
  );
}
