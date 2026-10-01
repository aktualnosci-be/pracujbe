import { IntlMessageFormat } from 'intl-messageformat';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appealSubjectLabels,
  emailCopy,
  guestOfferSentLabel,
  interpolate,
  layoutCopy,
  type EmailType,
} from '@/emails/copy';
import { newsletterPreferencesPath, renderNewsletterEmail, type NewsletterJob } from '@/emails/newsletter';
import { renderEmail } from '@/emails/templates';
import { routing, type Locale } from '@/i18n/routing';
import { processEmailQueue, RECIPIENT_JOB_TITLE_TEMPLATES } from '@/lib/email/outbox';
import { fakeDb, resetFakeDb } from '../helpers/fake-db';
import { warmUpEmailRender } from '../helpers/email-render-warmup';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * #1093 / #1117 / #1118 — spójność treści e-maili: język odbiorcy (tytuł oferty), stopka gościa,
 * CTA e-maili firmowych, numer sprawy vs numer decyzji w odwołaniach, forma gramatyczna PL,
 * liczba pojedyncza digestu, link ustawień newslettera, terminologia propozycji, status gościa.
 * Każda reguła ma kontrolę ujemną.
 */

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const LOCALES = routing.locales as readonly Locale[];
const URL = 'https://pracuj.be/x';

beforeAll(warmUpEmailRender);

async function render(type: EmailType, locale: Locale, data: Record<string, unknown>) {
  return renderEmail(type, locale, { actionUrl: URL, ...data } as never);
}

describe('#1118 digest jobMatch: liczba pojedyncza przy jednej ofercie', () => {
  const jobs = [{ title: 'Magazynier', url: `${URL}/1` }];
  const plural: Record<Locale, string> = {
    pl: 'Pojawiły się nowe oferty',
    nl: 'Er zijn nieuwe vacatures',
    fr: 'De nouvelles offres correspondent',
    en: 'New jobs match',
  };

  it.each(LOCALES)('%s: count = 1 → wariant pojedynczy (temat i treść)', async (locale) => {
    const single = emailCopy.jobMatch[locale].single!;
    const out = await render('jobMatch', locale, { searchName: 'Gent', count: 1, jobs });
    expect(out.subject).toBe(interpolate(single.subject!, { searchName: 'Gent' }));
    expect(out.text).toContain(interpolate(single.body!, { searchName: 'Gent' }));
    expect(out.text).not.toContain(plural[locale]);
  });

  it.each(LOCALES)('%s: kontrola ujemna — count = 3 zostaje przy liczbie mnogiej', async (locale) => {
    const out = await render('jobMatch', locale, { searchName: 'Gent', count: 3, jobs });
    expect(out.subject).toBe(interpolate(emailCopy.jobMatch[locale].subject, { searchName: 'Gent' }));
    expect(out.text).toContain(plural[locale]);
  });
});

describe('#1117 odwołania: numer sprawy zgłaszającego nie jest „numerem decyzji”', () => {
  const reporterCta: Record<Locale, string> = {
    pl: 'Sprawdź status sprawy',
    nl: 'Status van je dossier bekijken',
    fr: 'Voir le statut du dossier',
    en: 'Check case status',
  };
  const types = ['appealReceived', 'appealUpheld', 'appealReversed'] as const;

  it.each(LOCALES)('%s: zgłaszający widzi numer sprawy i CTA strony sprawy', async (locale) => {
    for (const type of types) {
      const out = await render(type, locale, {
        appealReference: 'APL-1', caseNumber: 'DSA-AAAA-BBBB', appellantRole: 'reporter', reasoning: 'x',
      });
      const labels = appealSubjectLabels[locale];
      expect(out.text, type).toContain(interpolate(labels.case, { ref: 'DSA-AAAA-BBBB' }));
      expect(out.text, type).not.toContain(interpolate(labels.decision, { ref: 'DSA-AAAA-BBBB' }));
      expect(out.html, type).toContain(reporterCta[locale]);
    }
  });

  it.each(LOCALES)('%s: kontrola ujemna — autor widzi numer decyzji i CTA danych firmy', async (locale) => {
    for (const type of types) {
      const out = await render(type, locale, {
        appealReference: 'APL-1', decisionReference: 'DEC-1', appellantRole: 'author', reasoning: 'x',
      });
      expect(out.text, type).toContain(interpolate(appealSubjectLabels[locale].decision, { ref: 'DEC-1' }));
      expect(out.html, type).toContain(emailCopy.companyVerified[locale].cta);
      expect(out.html, type).not.toContain(reporterCta[locale]);
    }
  });

  it('bez roli: sam numer sprawy = zgłaszający', async () => {
    const out = await render('appealReceived', 'pl', { appealReference: 'APL-1', caseNumber: 'DSA-X' });
    expect(out.text).toContain('numer sprawy: DSA-X');
    expect(out.html).toContain('Sprawdź status sprawy');
  });
});

describe('#1117 CTA e-maili firmowych spójne z rodziną company*', () => {
  it.each(LOCALES)('%s: moderacja i odwołanie autora = CTA danych firmy', (locale) => {
    const companyCta = emailCopy.companyVerified[locale].cta;
    for (const type of ['moderationJobRemoved', 'moderationCompanySuspended', 'moderationRestored', 'appealReceived'] as const) {
      expect(emailCopy[type][locale].cta, type).toBe(companyCta);
    }
  });

  it('kontrola ujemna: dawne CTA NL „Naar de bedrijfsgegevens” nie wraca', () => {
    const all = JSON.stringify(emailCopy);
    expect(all).not.toContain('Naar de bedrijfsgegevens');
    expect(all).toContain('Naar bedrijfsgegevens');
  });
});

describe('#1117 stopka e-maili gościa bez „masz konto”', () => {
  it.each(LOCALES)('%s: potwierdzenie i wysłanie aplikacji gościa', async (locale) => {
    for (const type of ['guestApplicationConfirm', 'guestApplicationSent'] as const) {
      const out = await render(type, locale, { jobTitle: 'Magazynier', companyName: 'Acme' });
      expect(out.text, type).not.toContain(layoutCopy[locale].footerNote);
      expect(out.text, type).toContain(emailCopy[type][locale].footerNote!);
    }
  });

  it('kontrola ujemna: e-mail do konta nadal ma notę „masz konto”', async () => {
    const out = await render('jobPublished', 'pl', { jobTitle: 'Magazynier' });
    expect(out.text).toContain(layoutCopy.pl.footerNote);
  });
});

describe('#1117 potwierdzenie kontaktu nie prosi o odpowiedź na list no-reply', () => {
  it('PL: bez „W odpowiedzi na tę wiadomość”', () => {
    expect(emailCopy.supportContact.pl.body).not.toMatch(/odpowiedzi na tę wiadomość/i);
    expect(emailCopy.supportContact.pl.body).toContain('Podaj ten numer');
  });
});

describe('#1118 forma gramatyczna PL i terminologia propozycji', () => {
  it('PL: firma bez form osobowych „(a)” w e-mailach do kandydata', () => {
    for (const type of ['jobOffer', 'applicationViewed', 'newMessage'] as const) {
      expect(JSON.stringify(emailCopy[type].pl), type).not.toMatch(/ł\(a\)/);
    }
  });

  it('kontrola ujemna: osoba (kandydat) nadal ma formę rodzajową', () => {
    expect(emailCopy.newApplication.pl.body).toMatch(/zgłosił\(a\)/);
  });

  const forbidden: Record<Locale, RegExp> = {
    pl: /ofert[aęy] pracy|Twoją ofertę|Zobacz ofertę/i,
    nl: /aanbod/i,
    fr: /offre d’emploi|votre offre|l’offre/i,
    en: /job offer|your offer|View offer/i,
  };
  const term: Record<Locale, RegExp> = {
    pl: /propozycj/i,
    nl: /voorstel/i,
    fr: /proposition/i,
    en: /proposal/i,
  };

  it.each(LOCALES)('%s: propozycja = termin panelu (jobOffer, offerAccepted, offerDeclined)', (locale) => {
    for (const type of ['jobOffer', 'offerAccepted', 'offerDeclined'] as const) {
      const copy = JSON.stringify(emailCopy[type][locale]);
      expect(copy, type).not.toMatch(forbidden[locale]);
      expect(copy, type).toMatch(term[locale]);
    }
  });

  it('kontrola ujemna: wzorzec łapie dawne brzmienie', () => {
    expect('Oferta pracy od Acme').toMatch(forbidden.pl);
    expect('Jobaanbod van Acme').toMatch(forbidden.nl);
    expect('Job offer from Acme').toMatch(forbidden.en);
  });
});

describe('#1118 status gościa: bez „Propozycja wysłana”', () => {
  const statusLabels: Record<Locale, Record<string, string>> = {
    pl: pl.status, nl: nl.status, fr: fr.status, en: en.status,
  };

  it.each(LOCALES)('%s: offer_sent → zapowiedź kontaktu pracodawcy', async (locale) => {
    const out = await render('guestStatusChanged', locale, {
      jobTitle: 'Magazynier', companyName: 'Acme', status: 'offer_sent',
    });
    expect(out.text).toContain(guestOfferSentLabel[locale]);
    expect(out.text).not.toContain(statusLabels[locale]!.offerSent!);
  });

  it('offer_accepted u gościa → neutralny wariant bez etykiety', async () => {
    const out = await render('guestStatusChanged', 'pl', {
      jobTitle: 'Magazynier', companyName: 'Acme', status: 'offer_accepted',
    });
    expect(out.text).not.toContain(pl.status.offerAccepted);
    expect(out.html).toContain(emailCopy.guestStatusChanged.pl.anonymous!.preview!);
  });

  it('kontrola ujemna: kandydat z kontem nadal widzi etykietę panelu', async () => {
    const out = await render('statusChanged', 'pl', {
      jobTitle: 'Magazynier', companyName: 'Acme', status: 'offer_sent',
    });
    expect(out.text).toContain(pl.status.offerSent);
  });
});

describe('#1118 newsletter: link ustawień powiadomień wg roli', () => {
  const jobs: NewsletterJob[] = [
    { locale: 'nl', slug: 'magazijnier-gent', title: 'Magazijnier', city: 'Gent', isDemo: false },
  ];

  it('pracodawca → /employer/ustawienia (HTML i text)', async () => {
    const out = await renderNewsletterEmail('nl', jobs, undefined, 'employer');
    expect(out.html).toContain('/nl/employer/ustawienia');
    expect(out.text).toContain('/nl/employer/ustawienia');
    expect(out.html).not.toContain('/candidate/ustawienia');
  });

  it('kontrola ujemna: kandydat i nieznana rola → /candidate/ustawienia', async () => {
    expect(newsletterPreferencesPath('candidate')).toBe('/candidate/ustawienia');
    expect(newsletterPreferencesPath(undefined)).toBe('/candidate/ustawienia');
    const out = await renderNewsletterEmail('nl', jobs);
    expect(out.html).toContain('/nl/candidate/ustawienia');
  });
});

describe('#1093 liczba mnoga ICU: ukryte profile po zmianie progu wieku', () => {
  const messages: Record<Locale, string> = {
    pl: pl.admin.agePolicySuccessHidden,
    nl: nl.admin.agePolicySuccessHidden,
    fr: fr.admin.agePolicySuccessHidden,
    en: en.admin.agePolicySuccessHidden,
  };
  const one: Record<Locale, string> = {
    pl: 'Ukryto 1 profil ',
    nl: '1 profiel is verborgen',
    fr: '1 profil a été masqué',
    en: '1 profile was hidden',
  };
  const many: Record<Locale, string> = {
    pl: 'Ukryto 5 profili',
    nl: '5 profielen zijn verborgen',
    fr: '5 profils ont été masqués',
    en: '5 profiles were hidden',
  };

  it.each(LOCALES)('%s: 1 i 5 profili w poprawnej formie', (locale) => {
    const fmt = new IntlMessageFormat(messages[locale], locale);
    expect(fmt.format({ count: 1 })).toContain(one[locale]);
    expect(fmt.format({ count: 5 })).toContain(many[locale]);
  });

  it('PL: 2 profile (few)', () => {
    expect(new IntlMessageFormat(messages.pl, 'pl').format({ count: 2 })).toContain('Ukryto 2 profile ');
  });

  it('kontrola ujemna: dawna treść bez plural daje błędną formę przy 1', () => {
    const old = new IntlMessageFormat('Ukryto {count} profili z wyszukiwania.', 'pl');
    expect(old.format({ count: 1 })).not.toContain(one.pl);
  });
});

describe('#1093 tytuł oferty w języku odbiorcy (worker)', () => {
  const PROFILE = '8f2c1d3e-4b5a-4c6d-8e7f-901234567890';
  const APP = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';

  function row(template: string, entityType: string) {
    return {
      id: 'd1', profile_id: PROFILE, to_email: 'd1@example.test', template, locale: 'fr',
      payload: { companyName: 'Acme', jobTitle: 'Magazynier', status: 'viewed' },
      attempts: 0, lock_token: 'lock-d1', entity_type: entityType, entity_id: APP,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeDb(null)
      .rows('email.outbox.recipient-names', [])
      .exec('email.outbox.mark-sent')
      .exec('email.outbox.mark-failed')
      .exec('email.outbox.defer');
    fakeDb.rpc('email_delivery_send_check', null);
    fakeDb.rpc('take_email_send_budget', [{ granted: true, retry_at: null }]);
    process.env.RESEND_API_KEY = 're_test';
    send.mockResolvedValue({ data: { id: 'provider-1' }, error: null });
  });

  it('statusChanged: tytuł z tłumaczenia w języku odbiorcy zastępuje tytuł oryginału', async () => {
    fakeDb.rpc('claim_email_batch', [row('statusChanged', 'application')]);
    fakeDb.rows('email.outbox.recipient-job-titles', ({ values }) => {
      expect(values[2]).toEqual(['fr']);
      return (values[0] as string[]).includes('d1') ? [{ delivery_id: 'd1', title: 'Magasinier' }] : [];
    });
    expect(await processEmailQueue()).toMatchObject({ sent: 1 });
    const [message] = send.mock.calls[0]!;
    expect(message.subject).toContain('Magasinier');
    expect(message.subject).not.toContain('Magazynier');
  });

  it('kontrola ujemna: błąd odczytu → tytuł z payloadu, e-mail wychodzi', async () => {
    fakeDb.rpc('claim_email_batch', [row('statusChanged', 'application')]);
    fakeDb.rows('email.outbox.recipient-job-titles', () => {
      throw new Error('db down');
    });
    expect(await processEmailQueue()).toMatchObject({ sent: 1 });
    expect(send.mock.calls[0]![0].subject).toContain('Magazynier');
  });

  it('kontrola ujemna: szablon spoza listy nie pyta o tłumaczenie', async () => {
    fakeDb.rpc('claim_email_batch', [row('jobPublished', 'job')]);
    await processEmailQueue();
    expect(fakeDb.calls.some((c) => c.name === 'email.outbox.recipient-job-titles')).toBe(false);
    expect(Object.keys(RECIPIENT_JOB_TITLE_TEMPLATES).sort()).toEqual(
      ['applicationViewed', 'guestStatusChanged', 'jobOffer', 'statusChanged'],
    );
  });
});
