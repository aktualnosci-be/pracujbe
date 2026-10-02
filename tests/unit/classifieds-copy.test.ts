import { describe, expect, it, vi } from 'vitest';

import { routing, type Locale } from '@/i18n/routing';
import { emailCopy, layoutCopy, type EmailCopy, type EmailType } from '@/emails/copy';
import { renderEmail } from '@/emails/templates';
import { RECRUITMENT_EMAIL_TEMPLATES } from '@/lib/email/recruitment-templates';
import { PORTAL_LEGAL_MODE_ENV } from '@/lib/portal-mode';
import { getAllGuideSlugs, getGuideBySlug } from '@/lib/guides/guides';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * Strażnik tekstów publicznych portalu ogłoszeń (#1149, #1151; epik #1128 — decyzja produktowa:
 * portal ogłoszeniowy). Publiczne teksty w 4 językach nie obiecują dopasowania, polecania,
 * aplikowania przez portal (profilem, bez CV), widoczności profilu dla firm ani propozycji pracy.
 *
 * Zakres = WYŁĄCZNIE teksty publiczne: całe przestrzenie `PUBLIC_NAMESPACES`, wybrane klucze
 * `PUBLIC_KEYS` (odznaka weryfikacji, banery statusu firmy, rejestracja), treść poradników oraz
 * wspólna stopka i powitanie e-mail. Klucze paneli i funkcji rekrutacyjnych (`job.match*`,
 * `apply.*`, `dashboard.*`, …) wyłączają osobne PR-y epiku — nie są tu sprawdzane.
 */

type Messages = { [key: string]: string | Messages };
const MESSAGES: Record<Locale, Messages> = { pl, nl, fr, en } as unknown as Record<Locale, Messages>;

const PUBLIC_NAMESPACES = ['home', 'metadata', 'landing', 'footer', 'employers', 'help', 'guides', 'companyProfile'] as const;

const PUBLIC_KEYS = [
  'jobs.subtitle',
  'job.verified',
  'job.verifiedHelp',
  'auth.registerAsEmployer',
  'auth.ageBandMinorHint',
  'company.verificationNote',
  'company.bannerPendingDesc',
  'company.bannerVerifiedDesc',
  'company.bannerSuspendedDesc',
  'company.bannerUnverifiedDesc',
  'company.editVerifiedHint',
] as const;

/**
 * Zakazane frazy per język. Celowo wąskie (frazy o funkcjach rekrutacyjnych portalu), żeby nie
 * łapać ogólnych zdań poradników (np. FR „secteurs qui recrutent”).
 */
const FORBIDDEN: Record<Locale, RegExp[]> = {
  pl: [
    /dopasow/i,
    /dopasuj/i,
    /bez (pisania )?CV/i,
    /zamiast CV/i,
    /profilem/i,
    /profil(u|em)? (zawodow|kandydat)/i,
    /(Twój|Twoje|Twojego|swój) profil/i,
    /polecan/i,
    /propozycj/i,
    /rekrut/i,
    /top kandyd/i,
    /znajdziemy/i,
    /wyszukiwar\w* kandydat/i,
    /napisz\w* do Ciebie/i,
    /\d\s?%/,
  ],
  nl: [
    /\bmatch/i,
    /zonder (een )?cv/i,
    /in plaats van (een )?cv/i,
    /(kandidaat|beroeps)profiel/i,
    /\b(je|jouw) profiel/i,
    /aanbevol/i,
    /voorstel/i,
    /rekrute/i,
    /werving/i,
    /top ?kandida/i,
    /kandidatenzoek/i,
    /bij je pas(t|sen)|passende vacatures/i,
    /\d\s?%/,
  ],
  fr: [
    /compatibilit/i,
    /qui vous correspond/i,
    /sans CV/i,
    /au lieu d[’']un CV/i,
    /profil (professionnel|de candidat|candidat)/i,
    /votre profil/i,
    /offres recommandées|recommandations/i,
    /proposition/i,
    /recrutez|recrutement/i,
    /top candidats/i,
    /recherche de candidats/i,
    /\d\s?%/,
  ],
  en: [
    /\bmatch/i,
    /without (a |writing a )?CV/i,
    /\bno CV\b/i,
    /instead of a CV/i,
    /(candidate|professional) profile/i,
    /\byour profile/i,
    /recommended jobs|recommendations/i,
    // „job offer” w EN = ogłoszenie; zakazana jest WYSYŁKA propozycji kandydatowi.
    /\bsend\w* (the |a )?candidates? (an? )?(job )?offers?|\bsend\w* (an? )?(job )?offers? to/i,
    /\brecruit/i,
    /\bhiring\?/i,
    /top candidates/i,
    /candidate search/i,
    /\d\s?%/,
  ],
};

function flatten(obj: Messages | string, prefix: string, out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof obj === 'string') out.push([prefix, obj]);
  else for (const [key, value] of Object.entries(obj)) flatten(value, `${prefix}.${key}`, out);
  return out;
}

function lookup(messages: Messages, path: string): string {
  const value = path.split('.').reduce<Messages | string | undefined>(
    (node, key) => (node && typeof node === 'object' ? node[key] : undefined),
    messages,
  );
  if (typeof value !== 'string') throw new Error(`brak klucza ${path}`);
  return value;
}

/** Wszystkie teksty publiczne danego języka jako pary [źródło, tekst]. */
function publicTexts(locale: Locale, messages: Messages = MESSAGES[locale]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const ns of PUBLIC_NAMESPACES) flatten(messages[ns]!, ns, out);
  for (const key of PUBLIC_KEYS) out.push([key, lookup(messages, key)]);
  for (const slug of getAllGuideSlugs()) {
    const guide = getGuideBySlug(slug, locale)!;
    out.push([`guide:${slug}.title`, guide.title], [`guide:${slug}.excerpt`, guide.excerpt]);
    guide.body.forEach((block, i) => {
      const texts = block.type === 'list' ? block.items : [block.text];
      texts.forEach((text, j) => out.push([`guide:${slug}.body[${i}][${j}]`, text]));
    });
  }
  out.push([`email:layout.tagline`, layoutCopy[locale].tagline]);
  for (const [field, text] of Object.entries(emailCopy.welcome[locale])) {
    if (typeof text === 'string') out.push([`email:welcome.${field}`, text]);
  }
  return out;
}

/** Naruszenia: źródło tekstu + wzorzec, który go złapał. */
function violations(locale: Locale, texts: Array<[string, string]>): string[] {
  return texts.flatMap(([where, text]) =>
    FORBIDDEN[locale].filter((re) => re.test(text)).map((re) => `${locale} ${where}: ${re} ← „${text}”`),
  );
}

function clone(messages: Messages): Messages {
  return JSON.parse(JSON.stringify(messages)) as Messages;
}

describe('teksty publiczne = portal ogłoszeń (#1149, #1151)', () => {
  it.each(routing.locales)('%s: brak fraz rekrutacyjnych w tekstach publicznych', (locale) => {
    expect(violations(locale, publicTexts(locale))).toEqual([]);
  });

  it.each(routing.locales)('%s: strażnik sprawdza realny zakres (nie pusty)', (locale) => {
    const texts = publicTexts(locale);
    expect(texts.some(([k]) => k.startsWith('home.'))).toBe(true);
    expect(texts.some(([k]) => k.startsWith('employers.'))).toBe(true);
    expect(texts.some(([k]) => k.startsWith('help.'))).toBe(true);
    expect(texts.some(([k]) => k.startsWith('guide:'))).toBe(true);
    expect(texts.some(([k]) => k === 'job.verified')).toBe(true);
  });

  describe('kontrole ujemne', () => {
    const injected: Record<Locale, string> = {
      pl: 'Twoje dopasowanie 87%',
      nl: '87% match met jouw profiel',
      fr: 'compatibilité 87 %',
      en: '87% match for you',
    };

    it.each(routing.locales)('%s: „dopasowanie 87%%” w home.* = czerwony', (locale) => {
      const mutated = clone(MESSAGES[locale]);
      (mutated.home as Messages).heroSubtitle = injected[locale];
      expect(violations(locale, publicTexts(locale, mutated)).some((v) => v.includes('home.heroSubtitle'))).toBe(true);
    });

    // Dawne brzmienia sprzed decyzji (#1151): przywrócenie = czerwony.
    const OLD: Record<Locale, Record<string, string>> = {
      pl: {
        'employers.contactProposalsDesc': 'Możesz wysłać kandydatowi propozycję pracy, którą on akceptuje albo odrzuca.',
        'footer.tagline': 'Praca w Belgii bez CV — w Twoim języku.',
        'help.metaDescription': 'Jak działa Pracuj.be: profil bez CV, aplikowanie, dopasowanie ofert, konto pracodawcy.',
        'company.bannerVerifiedDesc': 'Możesz publikować oferty i wysyłać propozycje kandydatom.',
      },
      nl: {
        'employers.contactProposalsDesc': 'Je kunt de kandidaat een jobvoorstel sturen dat de kandidaat aanvaardt of weigert.',
        'footer.tagline': 'Werken in België zonder cv — in jouw taal.',
        'help.metaDescription': 'Hoe Pracuj.be werkt: profiel zonder cv, solliciteren, vacaturematching.',
        'company.bannerVerifiedDesc': 'Je kunt vacatures plaatsen en voorstellen naar kandidaten sturen.',
      },
      fr: {
        'employers.contactProposalsDesc': 'Vous pouvez envoyer au candidat une proposition d’emploi qu’il accepte ou refuse.',
        'footer.tagline': 'Travailler en Belgique sans CV — dans votre langue.',
        'help.metaDescription': 'Comment fonctionne Pracuj.be : profil sans CV, candidature, compatibilité des offres.',
        'company.bannerVerifiedDesc': 'Vous pouvez publier des offres et envoyer des propositions aux candidats.',
      },
      en: {
        'employers.contactProposalsDesc': 'You can send the candidate a job offer, which they accept or decline.',
        'footer.tagline': 'Work in Belgium without a CV — in your language.',
        'help.metaDescription': 'How Pracuj.be works: profile without a CV, applying, job matching.',
        'company.bannerVerifiedDesc': 'You can post jobs and send offers to candidates.',
      },
    };

    it.each(routing.locales)('%s: dawne teksty (employers.contactProposalsDesc i in.) = czerwony', (locale) => {
      for (const [key, text] of Object.entries(OLD[locale])) {
        const mutated = clone(MESSAGES[locale]);
        const [ns, ...rest] = key.split('.');
        (mutated[ns!] as Messages)[rest.join('.')] = text;
        expect(violations(locale, publicTexts(locale, mutated)).some((v) => v.includes(key)), key).toBe(true);
      }
    });
  });
});

describe('odznaka weryfikacji = zweryfikowana tożsamość firmy (#1151)', () => {
  const IDENTITY: Record<Locale, RegExp> = {
    pl: /tożsamość firmy/i,
    nl: /identiteit/i,
    fr: /identité/i,
    en: /identity/i,
  };

  it.each(routing.locales)('%s: job.verified mówi o tożsamości firmy, a Pomoc wyjaśnia weryfikację', (locale) => {
    expect(lookup(MESSAGES[locale], 'job.verified')).toMatch(IDENTITY[locale]);
    expect(lookup(MESSAGES[locale], 'job.verifiedHelp')).toBeTruthy();
    expect(lookup(MESSAGES[locale], 'help.faq.verification.a').length).toBeGreaterThan(0);
  });

  it('kontrola ujemna: dawne „Zweryfikowana firma” nie mówi o tożsamości', () => {
    expect('Zweryfikowana firma').not.toMatch(IDENTITY.pl);
    expect('Verified company').not.toMatch(IDENTITY.en);
  });
});

/**
 * E-maile i ekrany kont w trybie ogłoszeniowym (#1212, #1213, #1225). Szablony spoza
 * `RECRUITMENT_EMAIL_TEMPLATES` wychodzą w trybie ogłoszeniowym, więc ich treść bazowa (także
 * wariant `anonymous`) nie obiecuje zgłoszeń przez portal, odpowiadania kandydatom, propozycji
 * ani wiadomości. Dawne brzmienia zostają tylko w wariancie `recruitment` (tryb RECRUITMENT).
 * Ekrany kandydata/pracodawcy: w trybie ogłoszeniowym komponenty biorą klucze `*Listing`
 * (plus klucze bez wariantu wymienione niżej) — te teksty sprawdzamy tymi samymi wzorcami.
 */
const PROCESS_FORBIDDEN: Record<Locale, RegExp[]> = {
  pl: [/pierwsze zgłoszenia/i, /zgłoszeni(a|ami|ach)\b(?! treści)/i, /odpowiada\S* kandydatom/i, /propozycj/i, /dopasowa/i, /wiadomościami/i, /aplikować/i, /profil\w* (nie jest )?widoczn/i, /widzi\w* Twój profil/i],
  nl: [/sollicitaties/i, /solliciteren/i, /kandidaten (te )?antwoord/i, /voorstel/i, /\bmatch/i, /profiel (dat )?zichtbaar/i, /je profiel (niet )?(ziet|zien)/i, /berichten/i],
  fr: [/candidatures/i, /postuler/i, /répondre aux candidats/i, /proposition/i, /compatibilit/i, /profil (n’est pas )?visible/i, /voie votre profil|voit pas votre profil/i, /vos messages|et messages|aux messages/i],
  en: [/applications/i, /\bapply\b/i, /reply to candidates/i, /job offers?\b/i, /\bmatch results/i, /profile visible/i, /see your profile/i, /\bmessages\b/i],
};

function processViolations(locale: Locale, texts: Array<[string, string]>): string[] {
  const patterns = [...FORBIDDEN[locale], ...PROCESS_FORBIDDEN[locale]];
  return texts.flatMap(([where, text]) =>
    patterns.filter((re) => re.test(text)).map((re) => `${locale} ${where}: ${re} ← „${text}”`),
  );
}

type AnyCopy = EmailCopy & Record<string, unknown>;
const LISTING_EMAIL_TYPES = (Object.keys(emailCopy) as EmailType[]).filter(
  (type) => !(RECRUITMENT_EMAIL_TEMPLATES as readonly string[]).includes(type),
);
/** Pola e-maila widoczne dla odbiorcy (bez noty stopki: „zignoruj tę wiadomość” itp. = ten e-mail). */
const EMAIL_FIELDS = ['subject', 'preview', 'heading', 'body', 'cta', 'highlight', 'outro'] as const;
/** Szablony, których bazowa treść mówi o zgłoszeniach DSA/kontakcie (słowo „zgłoszenie” = sprawa). */
const EMAIL_EXEMPT = new Set<string>(['reportReceived', 'reportDecisionActioned', 'reportDecisionNoAction', 'reportRestored',
  'moderationJobRemoved', 'moderationCompanySuspended', 'appealReceived', 'appealUpheld', 'appealReversed',
  'supportContact', 'contactMessageAdmin', 'passwordReset', 'accountConfirmation', 'magicLink', 'emailChange', 'invite',
  'teamInvitation', 'teamInvitationSignup', 'inactiveCvWarning', 'breachNotice', 'jobMatch']);

function emailTexts(locale: Locale, copyOf: (type: EmailType) => AnyCopy): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const type of LISTING_EMAIL_TYPES) {
    if (EMAIL_EXEMPT.has(type)) continue;
    const copy = copyOf(type);
    const variants: Array<[string, Record<string, unknown>]> = [['', copy]];
    if (copy.anonymous) variants.push(['anonymous.', copy.anonymous]);
    for (const [prefix, source] of variants) {
      for (const field of EMAIL_FIELDS) {
        const text = source[field];
        if (typeof text === 'string') out.push([`email:${type}.${prefix}${field}`, text]);
      }
    }
  }
  return out;
}

describe('e-maile spoza procesu rekrutacyjnego = portal ogłoszeń (#1212, #1225)', () => {
  it.each(routing.locales)('%s: treść bazowa bez zgłoszeń, odpowiadania kandydatom i propozycji', (locale) => {
    expect(processViolations(locale, emailTexts(locale, (type) => emailCopy[type][locale] as AnyCopy))).toEqual([]);
  });

  it('strażnik obejmuje jobPublished, companyVerified i inactiveAccountWarning', () => {
    const where = emailTexts('pl', (type) => emailCopy[type].pl as AnyCopy).map(([w]) => w);
    for (const key of ['email:jobPublished.body', 'email:companyVerified.body', 'email:inactiveAccountWarning.body']) {
      expect(where).toContain(key);
    }
  });

  it.each(routing.locales)('%s: kontrola ujemna — wariant `recruitment` (dawne brzmienie) w treści bazowej = czerwony', (locale) => {
    const withRecruitment = (type: EmailType): AnyCopy => {
      const base = emailCopy[type][locale] as AnyCopy;
      return (base.recruitment ? { ...base, ...base.recruitment } : base) as AnyCopy;
    };
    const found = processViolations(locale, emailTexts(locale, withRecruitment));
    for (const type of ['jobPublished', 'companyVerified', 'inactiveAccountWarning']) {
      expect(found.some((v) => v.includes(`email:${type}.body`)), `${locale} ${type}`).toBe(true);
    }
  });

  it('wybór wariantu w renderze: tryb ogłoszeniowy = treść bazowa, RECRUITMENT = wariant `recruitment`', async () => {
    const data = { jobTitle: 'Magazynier', jobUrl: 'https://pracuj.be/pl/oferty-pracy/magazynier' };
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, '');
    const listing = await renderEmail('jobPublished', 'pl', data);
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, 'RECRUITMENT');
    const recruitment = await renderEmail('jobPublished', 'pl', data);
    vi.unstubAllEnvs();
    expect(listing.text).toContain('kanałem podanym w ogłoszeniu');
    expect(listing.text).not.toMatch(/zgłoszenia/);
    expect(recruitment.text).toMatch(/pierwsze zgłoszenia/);
  });
});

/** Klucze wyświetlane w trybie ogłoszeniowym na ekranach konta (#1213, #1225). */
const LISTING_PANEL_KEYS = [
  'ageAttestation.sectionDescriptionListing',
  'ageAttestation.stateMinorListing',
  'ageAttestation.stateMissingListing',
  'ageAttestation.stateAdult',
  'companyBlocks.sectionDescriptionListing',
  'companyBlocks.emptyListing',
  'companyBlocks.jobTitleListing',
  'companyBlocks.jobDescriptionListing',
  'companyBlocks.jobBlockedDescriptionListing',
  'accountData.sectionDescription',
  'accountData.exportDescriptionListing',
  'accountData.deleteDescriptionListing',
  'accountData.exportDescriptionEmployerListing',
  'accountData.deleteDescriptionEmployerListing',
  'team.roleOwnerDescListing',
  'team.roleAdminDescListing',
  'team.roleRecruiterDescListing',
  'team.roleMemberDescListing',
  'team.deactivateDescListing',
  'team.recruitOnlyDescListing',
  'jobWizard.editSubtitleActiveListing',
  'jobWizard.editSubtitlePausedListing',
] as const;

/** Nazwa roli „rekruter” (etykieta roli w zespole, nie obietnica funkcji) nie jest naruszeniem. */
const ROLE_NAME = /rekruter\w*|recruiters?|recruteurs?/gi;

function panelViolations(locale: Locale, messages: Messages = MESSAGES[locale]): string[] {
  const texts = LISTING_PANEL_KEYS.map((key): [string, string] => [key, lookup(messages, key).replace(ROLE_NAME, 'ROLE')]);
  return processViolations(locale, texts);
}

describe('ekrany konta w trybie ogłoszeniowym (#1213, #1225)', () => {
  it.each(routing.locales)('%s: teksty *Listing bez obietnic funkcji rekrutacyjnych', (locale) => {
    expect(panelViolations(locale)).toEqual([]);
  });

  it.each(routing.locales)('%s: kontrola ujemna — dawne brzmienia (klucze bez *Listing) = czerwony', (locale) => {
    const mutated = clone(MESSAGES[locale]);
    for (const key of LISTING_PANEL_KEYS) {
      if (!key.endsWith('Listing')) continue;
      const [ns, k] = key.split('.') as [string, string];
      (mutated[ns] as Messages)[k] = lookup(MESSAGES[locale], `${ns}.${k.replace(/Listing$/, '')}`);
    }
    const found = panelViolations(locale, mutated);
    for (const key of ['ageAttestation.stateMinorListing', 'companyBlocks.sectionDescriptionListing', 'accountData.deleteDescriptionListing', 'team.roleRecruiterDescListing']) {
      expect(found.some((v) => v.includes(`${locale} ${key}:`)), `${locale} ${key}`).toBe(true);
    }
  });
});
