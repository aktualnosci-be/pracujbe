import { describe, expect, it } from 'vitest';

import type { Locale } from '@/i18n/routing';
import { renderEmail } from '@/emails/templates';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * #288 — status aplikacji w e-mailu = przetłumaczona etykieta w języku odbiorcy (nie enum).
 * #294 — brak nazwy nadawcy/kandydata (`—` z RPC) → neutralne zdanie; powitanie z imieniem.
 */

const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];
const messages = { pl, nl, fr, en } as const;

const STATUSES = {
  submitted: 'submitted',
  viewed: 'viewed',
  shortlisted: 'shortlisted',
  interview: 'interview',
  offer_sent: 'offerSent',
  offer_accepted: 'offerAccepted',
  offer_declined: 'offerDeclined',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
  hired: 'hired',
} as const;

function text(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}

/** Preheader (ukryty podgląd) = pierwszy element w body e-maila. */
function preheader(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.querySelector('div')?.textContent ?? '';
}

describe('#288: e-mail o zmianie statusu', () => {
  const cases = LOCALES.flatMap((locale) =>
    Object.entries(STATUSES).map(([status, key]) => ({ locale, status, key })),
  );

  it.each(cases)('$locale / $status → etykieta z messages, bez surowego enuma', async ({ locale, status, key }) => {
    const label = messages[locale].status[key];
    const { subject, html } = await renderEmail('statusChanged', locale, {
      companyName: 'Acme',
      jobTitle: 'Magazynier',
      status,
      applicationUrl: 'https://pracuj.be/x',
    });
    const body = text(html);

    expect(body).toContain(label);
    expect(preheader(html)).toContain(label);
    // Surowa wartość enuma (dokładnie, z wielkością liter) nie pojawia się nigdzie w treści.
    expect(body).not.toMatch(new RegExp(`\\b${status}\\b`));
    expect(subject).not.toMatch(new RegExp(`\\b${status}\\b`));
  });

  it.each(LOCALES)('%s: nieznany status → neutralna treść bez tokena i bez pustego boksu', async (locale) => {
    const { html } = await renderEmail('statusChanged', locale, {
      companyName: 'Acme',
      jobTitle: 'Magazynier',
      status: 'weird_internal_code',
      applicationUrl: 'https://pracuj.be/x',
    });
    const body = text(html);
    expect(body).not.toContain('weird_internal_code');
    expect(body).not.toMatch(/:\s*\./); // „…to teraz: .”
  });
});

const NAMELESS = {
  newApplication: {
    data: { candidateName: '—', jobTitle: 'Magazynier', applicationUrl: 'https://pracuj.be/x' },
    expected: {
      pl: 'Nowy kandydat zgłosił się',
      nl: 'Een nieuwe kandidaat heeft gesolliciteerd',
      fr: 'Un nouveau candidat a postulé',
      en: 'A new candidate applied',
    },
  },
  offerAccepted: {
    data: { candidateName: '—', jobTitle: 'Magazynier', actionUrl: 'https://pracuj.be/x' },
    expected: {
      pl: 'Twoja oferta została przyjęta',
      nl: 'Je aanbod is aanvaard',
      fr: 'Votre offre a été acceptée',
      en: 'Your offer was accepted',
    },
  },
  offerDeclined: {
    data: { candidateName: null, jobTitle: 'Magazynier', actionUrl: 'https://pracuj.be/x' },
    expected: {
      pl: 'Twoja oferta została odrzucona',
      nl: 'Je aanbod is afgewezen',
      fr: 'Votre offre a été déclinée',
      en: 'Your offer was declined',
    },
  },
  newMessage: {
    data: { senderName: '—', messageUrl: 'https://pracuj.be/x' },
    expected: {
      pl: 'Masz nową wiadomość',
      nl: 'Je hebt een nieuw bericht',
      fr: 'Vous avez un nouveau message',
      en: 'You have a new message',
    },
  },
} as const;

describe('#294: brak nazwy nadawcy → neutralny wariant', () => {
  const cases = LOCALES.flatMap((locale) =>
    (Object.keys(NAMELESS) as Array<keyof typeof NAMELESS>).map((type) => ({ locale, type })),
  );

  it.each(cases)('$type / $locale', async ({ locale, type }) => {
    const { data, expected } = NAMELESS[type];
    const { subject, html } = await renderEmail(type, locale, data as never);
    const body = text(html);
    const all = `${subject}\n${body}`;

    expect(all).toContain(expected[locale]);
    // Myślnik nie jest podmiotem zdania ani „imieniem” w temacie/treści.
    expect(subject.trim().startsWith('—')).toBe(false);
    expect(body).not.toMatch(/(^|[\s,.„“‘«])—\s+\p{L}/u);
  });

  it.each(LOCALES)('%s: podana nazwa kandydata nadal trafia do treści', async (locale) => {
    const { subject } = await renderEmail('offerAccepted', locale, {
      candidateName: 'Jan Kowalski',
      jobTitle: 'Magazynier',
      actionUrl: 'https://pracuj.be/x',
    });
    expect(subject).toContain('Jan Kowalski');
  });
});

describe('#294: powitanie z imieniem odbiorcy', () => {
  const greetings = { pl: 'Cześć Anna,', nl: 'Hallo Anna,', fr: 'Bonjour Anna,', en: 'Hi Anna,' };
  it.each(LOCALES)('%s', async (locale) => {
    const { html } = await renderEmail('statusChanged', locale, {
      firstName: 'Anna',
      companyName: 'Acme',
      jobTitle: 'Magazynier',
      status: 'interview',
      applicationUrl: 'https://pracuj.be/x',
    });
    expect(text(html)).toContain(greetings[locale]);
  });
});
