import { describe, expect, it } from 'vitest';

import { routing, type Locale } from '@/i18n/routing';
import { emailCopy, layoutCopy } from '@/emails/copy';
import { getAllGuideSlugs, getGuideBySlug } from '@/lib/guides/guides';
import { getNavigatorRegionGuide, NAVIGATOR_REGIONS } from '@/lib/guides/start-navigator';
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
  // Nawigator „Jak zacząć pracę w Belgii?” (#907) — treść regionów i potrzeb.
  for (const region of NAVIGATOR_REGIONS) {
    const guide = getNavigatorRegionGuide(region, locale)!;
    out.push([`navigator:${region}.name`, guide.name], [`navigator:${region}.summary`, guide.summary]);
    for (const need of guide.needs) {
      [need.title, need.summary, ...need.steps, ...need.regionFacts].forEach((text, i) =>
        out.push([`navigator:${region}.${need.key}[${i}]`, text]),
      );
    }
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
    expect(texts.some(([k]) => k.startsWith('navigator:'))).toBe(true);
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
