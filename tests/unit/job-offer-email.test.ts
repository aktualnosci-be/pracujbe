import { describe, expect, it } from 'vitest';

import type { Locale } from '@/i18n/routing';
import { renderEmail } from '@/emails/templates';

const cases: ReadonlyArray<{
  locale: Locale;
  passportTitle: string;
  jobLabel: string;
  companyLabel: string;
  salaryLabel: string;
  cta: string;
  subject: string;
}> = [
  {
    locale: 'pl',
    passportTitle: 'Paszport pracy',
    jobLabel: 'Stanowisko',
    companyLabel: 'Firma',
    salaryLabel: 'Wynagrodzenie',
    cta: 'Zobacz ofertę',
    subject: 'Oferta pracy od Acme Logistics',
  },
  {
    locale: 'nl',
    passportTitle: 'Werkpaspoort',
    jobLabel: 'Functie',
    companyLabel: 'Bedrijf',
    salaryLabel: 'Loon',
    cta: 'Aanbod bekijken',
    subject: 'Jobaanbod van Acme Logistics',
  },
  {
    locale: 'fr',
    passportTitle: 'Passeport emploi',
    jobLabel: 'Poste',
    companyLabel: 'Entreprise',
    salaryLabel: 'Rémunération',
    cta: 'Voir l’offre',
    subject: 'Offre d’emploi de Acme Logistics',
  },
  {
    locale: 'en',
    passportTitle: 'Job passport',
    jobLabel: 'Position',
    companyLabel: 'Company',
    salaryLabel: 'Salary',
    cta: 'View offer',
    subject: 'Job offer from Acme Logistics',
  },
];

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('wiadomość z propozycją pracy', () => {
  it.each(cases)(
    'renderuje markowy paszport z wynagrodzeniem w języku $locale',
    async ({ locale, passportTitle, jobLabel, companyLabel, salaryLabel, cta, subject }) => {
      const offerUrl = `https://pracuj.be/${locale}/candidate/propozycje/offer-1`;
      const rendered = await renderEmail('jobOffer', locale, {
        companyName: 'Acme Logistics',
        jobTitle: 'Operator CNC',
        salary: '€3,200 brutto / miesiąc',
        offerUrl,
      });
      const document = parse(rendered.html);
      const passport = document.querySelector('[data-email-component="job-offer-passport"]');

      expect(rendered.subject).toBe(subject);
      expect(document.documentElement.lang).toBe(locale);
      expect(passport?.textContent).toContain(passportTitle);
      expect(passport?.textContent).toContain(jobLabel);
      expect(passport?.textContent).toContain('Operator CNC');
      expect(passport?.textContent).toContain(companyLabel);
      expect(passport?.textContent).toContain('Acme Logistics');
      expect(passport?.textContent).toContain(salaryLabel);
      expect(passport?.textContent).toContain('€3,200 brutto / miesiąc');
      expect(document.querySelector(`a[href="${offerUrl}"]`)?.textContent).toContain(cta);
      expect(rendered.html).not.toMatch(/undefined|null|\{\w+\}/i);

      const labels = passport?.querySelectorAll('[data-passport-field] p:first-child') ?? [];
      expect(labels).toHaveLength(3);
      for (const label of labels) expect(label.textContent?.trim()).not.toBe('');
    },
  );

  it.each(cases)(
    'pomija cały wiersz wynagrodzenia, gdy stawki nie ma ($locale)',
    async ({ locale, salaryLabel }) => {
      const { html } = await renderEmail('jobOffer', locale, {
        companyName: 'Acme Logistics',
        jobTitle: 'Operator CNC',
        offerUrl: `https://pracuj.be/${locale}/candidate/propozycje/offer-1`,
      });
      const document = parse(html);
      const passport = document.querySelector('[data-email-component="job-offer-passport"]');

      expect(passport?.querySelector('[data-passport-field="salary"]')).toBeNull();
      expect(passport?.textContent).not.toContain(salaryLabel);
      expect(passport?.querySelectorAll('[data-passport-field]')).toHaveLength(2);
      expect(html).not.toMatch(/undefined|null|\{\w+\}/i);
    },
  );
});
