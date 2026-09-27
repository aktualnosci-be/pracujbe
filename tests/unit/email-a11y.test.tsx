import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';

import { EmailButton, EmailLayout, EmailText, emailPalette } from '@/emails/_components';
import { emailCopy, type EmailType } from '@/emails/copy';
import { renderEmail } from '@/emails/templates';
import { AUTH_EMAIL_TYPES, GUEST_EMAIL_TYPES, QUEUED_EMAIL_TYPES } from '@/emails/wiring';
import { routing, type Locale } from '@/i18n/routing';

/**
 * Dostępność i spójność każdego WYSYŁANEGO e-maila (typy z `src/emails/wiring.ts` × 4 języki):
 * `<html lang>` = język odbiorcy, `dir="ltr"`, `<title>` = temat, ukryty preheader w języku
 * odbiorcy, nazwa dostępna logo, linki/przyciski z czytelną nazwą (bez „kliknij tutaj”),
 * `role="presentation"` na tabelach układu, kontrast tekstu ≥ WCAG AA (kolory `emailPalette`
 * wyliczone z drzewa stylów inline) oraz text/plain z tymi samymi linkami co HTML.
 *
 * Nowy typ dopisany do `wiring.ts` (np. po scaleniu kolejnych szablonów) wchodzi tu sam.
 * Każda reguła ma kontrolę ujemną (zepsuty HTML/tekst → konkretne naruszenie).
 */

const WIRED_TYPES: readonly EmailType[] = [
  ...QUEUED_EMAIL_TYPES,
  ...GUEST_EMAIL_TYPES,
  ...AUTH_EMAIL_TYPES,
];

/** Nadzbiór pól wszystkich typów maili — każdy szablon bierze swoje. */
const SAMPLE: Record<string, unknown> = {
  firstName: 'Anna',
  recipientName: 'Anna',
  name: 'Anna',
  candidateName: 'Jan Nowak',
  senderName: 'Acme Logistics',
  inviterName: 'Piotr',
  companyName: 'Acme Logistics',
  jobTitle: 'Operator CNC',
  salary: '17–20 € brutto / godz.',
  message: 'Zapraszamy na rozmowę.',
  messageExcerpt: 'Zapraszamy na rozmowę.',
  preview: 'Dzień dobry, czy termin jest aktualny?',
  attachmentCount: 2,
  reason: 'Brak numeru VAT',
  status: 'interview',
  expiresAt: '2026-10-01T12:00:00Z',
  deletionDate: '2026-10-30T12:00:00Z',
  searchName: 'Magazyn Antwerpia',
  count: 2,
  jobs: [
    { title: 'Magazynier', companyName: 'Acme Logistics', city: 'Antwerpia', url: 'https://pracuj.be/pl/oferty-pracy/magazynier' },
    { title: 'Kierowca C+E', city: 'Gandawa', url: 'https://pracuj.be/pl/oferty-pracy/kierowca' },
  ],
  subject: 'Pytanie',
  topic: 'account',
  reference: 'KON-0000-0000',
  caseNumber: 'DSA-0000-0000',
  accessCode: 'ABCD-EFGH',
  targetType: 'job',
  decisionReference: 'DEC-0000-0000',
  appealReference: 'APL-0000-0000',
  incidentReference: 'INC-0000',
  groundType: 'terms',
  groundReference: '§ 5 ust. 2',
  facts: 'Oferta zawierała niedozwolone treści.',
  reasoning: 'Decyzja zgodna z regulaminem.',
  automatedDetection: false,
  noticeSubject: 'Informacja o incydencie',
  noticeText: 'Opis incydentu i zalecane działania.',
  confirmationUrl: 'https://pracuj.be/a',
  dashboardUrl: 'https://pracuj.be/b',
  resetUrl: 'https://pracuj.be/c',
  loginUrl: 'https://pracuj.be/d',
  inviteUrl: 'https://pracuj.be/e',
  applicationUrl: 'https://pracuj.be/f',
  actionUrl: 'https://pracuj.be/g',
  messageUrl: 'https://pracuj.be/h',
  offerUrl: 'https://pracuj.be/i',
  jobUrl: 'https://pracuj.be/j',
  renewUrl: 'https://pracuj.be/k',
  downloadUrl: 'https://pracuj.be/l',
};

const RENDER_OPTIONS = {
  unsubscribeUrl: 'https://pracuj.be/pl/wypisz#t=x',
  alertOffUrl: 'https://pracuj.be/pl/wypisz-alert#t=y',
};

/* ----------------------------------------------------------------------------- */
/*  Pomocnicze: style inline i kontrast                                           */
/* ----------------------------------------------------------------------------- */

function styleDeclarations(element: Element): Map<string, string> {
  const map = new Map<string, string>();
  const style = element.getAttribute('style');
  if (!style) return map;
  for (const part of style.split(';')) {
    const index = part.indexOf(':');
    if (index < 0) continue;
    map.set(part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim());
  }
  return map;
}

/** Najbliższa (od elementu w górę) wartość właściwości ze stylu inline. */
function inherited(element: Element, property: string, attribute?: string): string | undefined {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const value = styleDeclarations(node).get(property);
    if (value) return value;
    if (attribute) {
      const attr = node.getAttribute(attribute);
      if (attr) return attr;
    }
  }
  return undefined;
}

function parseHex(value: string): [number, number, number] | null {
  const match = /#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(value);
  if (!match) return null;
  const hex = match[1]!.length === 3 ? match[1]!.replace(/./g, (c) => c + c) : match[1]!;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(foreground: string, background: string): number {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (!fg || !bg) return 0;
  const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function isHidden(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden')) return true;
    if (styleDeclarations(node).get('display') === 'none') return true;
  }
  return false;
}

/** Znaki wypełniacza preheadera (spacje o zerowej szerokości, NBSP itp.). */
const FILLER = /[\s\u00a0\u200b-\u200f\u2028\u2029\u202f\u2060\ufeff\u034f\u00ad]/g;

function visibleText(value: string): string {
  return value.replace(FILLER, '');
}

/** Duży tekst wg WCAG: ≥ 24 px albo ≥ 18,66 px pogrubiony (próg 3:1 zamiast 4,5:1). */
function isLargeText(element: Element): boolean {
  const size = parseFloat(inherited(element, 'font-size') ?? '16');
  const weight = inherited(element, 'font-weight') ?? '400';
  const bold = weight === 'bold' || Number(weight) >= 700 || element.closest('strong, b, h1, h2, h3') !== null;
  return size >= 24 || (bold && size >= 18.66);
}

/* ----------------------------------------------------------------------------- */
/*  Audyt jednego maila                                                            */
/* ----------------------------------------------------------------------------- */

/** Nazwy linków bez znaczenia poza kontekstem (PL/NL/FR/EN). */
const VAGUE_LINK_NAMES = new Set([
  'kliknij', 'kliknij tutaj', 'tutaj', 'tu', 'link', 'więcej',
  'klik hier', 'hier', 'meer',
  'cliquez ici', 'cliquez', 'ici', 'lien', 'plus',
  'click here', 'click', 'here', 'more', 'read more',
]);

function normalizeName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.:!→›»\s]+$/u, '').trim();
}

/** Szablon tekstu z `copy.ts` → wyrażenie dopasowujące tekst po interpolacji. */
function templatePattern(template: string): RegExp {
  const escaped = template
    .split(/\{[a-zA-Z]+\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s\\S]*?');
  return new RegExp(`^${escaped}$`);
}

/** Dopuszczalne wzorce preheadera danego typu w danym języku (także wariant anonimowy). */
function previewPatterns(type: EmailType, locale: Locale): RegExp[] {
  const copy = emailCopy[type][locale];
  const templates = [copy.preview, copy.anonymous?.preview].filter(
    (value): value is string => typeof value === 'string',
  );
  return templates.map(templatePattern);
}

const URL_IN_TEXT = /(?:https?:\/\/|mailto:)[^\s<>"')\]]+/g;

function linksInText(text: string): Set<string> {
  return new Set([...text.matchAll(URL_IN_TEXT)].map((m) => m[0].replace(/[.,;:]+$/, '')));
}

interface Expectation {
  locale: Locale;
  subject: string;
  previewPatterns: readonly RegExp[];
}

function auditEmail(html: string, text: string, expected: Expectation): string[] {
  const violations: string[] = [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.documentElement;

  // 1. Język i kierunek.
  if (root.getAttribute('lang') !== expected.locale) {
    violations.push(`lang="${root.getAttribute('lang') ?? ''}" zamiast "${expected.locale}"`);
  }
  if (root.getAttribute('dir') !== 'ltr') violations.push('brak dir="ltr"');

  // 2. <title> = temat.
  const title = doc.querySelector('head > title')?.textContent?.trim() ?? '';
  if (!title || title !== expected.subject.trim()) {
    violations.push(`<title> "${title}" ≠ temat "${expected.subject}"`);
  }
  if (/\{[a-zA-Z]+\}/.test(`${title}\n${doc.body.textContent ?? ''}`)) {
    violations.push('niewypełniony token {…} w temacie albo treści');
  }

  // 3. Preheader: pierwszy ukryty blok w body, w języku odbiorcy, pominięty w text/plain.
  const preheader = doc.body.firstElementChild;
  const preheaderText = preheader ? (preheader.firstChild?.textContent ?? '').trim() : '';
  if (!preheader || styleDeclarations(preheader).get('display') !== 'none' || preheaderText.length === 0) {
    violations.push('brak ukrytego preheadera na początku body');
  } else {
    if (!expected.previewPatterns.some((pattern) => pattern.test(preheaderText))) {
      violations.push(`preheader „${preheaderText}” nie jest w języku odbiorcy (${expected.locale})`);
    }
    if (preheader.getAttribute('data-skip-in-text') !== 'true') {
      violations.push('preheader bez data-skip-in-text (wypełniacz trafi do text/plain)');
    }
  }

  // 4. Obrazy mają alt; logo ma nazwę dostępną.
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    if (!img.hasAttribute('alt')) violations.push(`<img src="${img.getAttribute('src') ?? ''}"> bez alt`);
  }
  const header = doc.querySelector('a[href]');
  const logoName = header?.getAttribute('aria-label')?.trim() ?? '';
  if (!/pracuj\.be/i.test(logoName)) violations.push('logo bez nazwy dostępnej „Pracuj.be”');

  // 5. Linki i przyciski: href + czytelna nazwa.
  for (const anchor of Array.from(doc.querySelectorAll('a'))) {
    const href = anchor.getAttribute('href')?.trim() ?? '';
    const rawName = anchor.getAttribute('aria-label') || anchor.textContent || '';
    const name = visibleText(rawName).length > 0 ? normalizeName(rawName) : '';
    if (!href) violations.push(`link „${name}” bez href`);
    if (!name) violations.push(`link ${href} bez nazwy dostępnej`);
    else if (VAGUE_LINK_NAMES.has(name)) violations.push(`link o nieczytelnej nazwie „${name}”`);
  }

  // 6. Tabele układu.
  for (const table of Array.from(doc.querySelectorAll('table'))) {
    if (table.getAttribute('role') !== 'presentation') {
      violations.push('tabela układu bez role="presentation"');
      break;
    }
  }

  // 7. Kontrast każdego widocznego fragmentu tekstu.
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  const seen = new Set<string>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || visibleText(node.textContent ?? '').length === 0 || isHidden(parent)) continue;
    const color = inherited(parent, 'color', 'color') ?? emailPalette.foreground;
    const background = inherited(parent, 'background-color', 'bgcolor') ?? emailPalette.background;
    const ratio = contrastRatio(color, background);
    const minimum = isLargeText(parent) ? 3 : 4.5;
    const key = `${color}/${background}`;
    if (ratio < minimum && !seen.has(key)) {
      seen.add(key);
      violations.push(`kontrast ${ratio.toFixed(2)} < ${minimum} (${color} na ${background})`);
    }
  }

  // 8. text/plain: te same linki co HTML, bez wypełniacza preheadera, z nazwami linków.
  const htmlLinks = new Set(
    Array.from(doc.querySelectorAll('a[href]'))
      .map((a) => a.getAttribute('href')!.trim())
      .filter((href) => /^(https?:|mailto:)/.test(href)),
  );
  const textLinks = linksInText(text);
  for (const href of htmlLinks) if (!textLinks.has(href)) violations.push(`text/plain bez linku ${href}`);
  for (const href of textLinks) if (!htmlLinks.has(href)) violations.push(`text/plain z linkiem spoza HTML ${href}`);
  if (/[\u200b-\u200f\ufeff\u034f]/.test(text)) violations.push('text/plain zawiera znaki wypełniacza preheadera');
  const lowerText = text.toLowerCase();
  for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
    const label = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (label && !lowerText.includes(label.toLowerCase())) {
      violations.push(`text/plain bez nazwy linku „${label}”`);
    }
  }

  return violations;
}

/* ----------------------------------------------------------------------------- */
/*  Testy                                                                          */
/* ----------------------------------------------------------------------------- */

async function renderSample(type: EmailType, locale: Locale) {
  return renderEmail(type, locale, SAMPLE as never, RENDER_OPTIONS);
}

describe('e-maile: dostępność i spójność text/plain (typy z wiring.ts × języki)', () => {
  it('obejmuje wszystkie typy wysyłane przez produkt', () => {
    expect(WIRED_TYPES.length).toBeGreaterThan(30);
    expect(new Set(WIRED_TYPES).size).toBe(WIRED_TYPES.length);
  });

  it.each(routing.locales.flatMap((locale) => WIRED_TYPES.map((type) => [type, locale] as const)))(
    '%s (%s) spełnia reguły dostępności',
    async (type, locale) => {
      const { subject, html, text } = await renderSample(type, locale);
      expect(subject.trim().length).toBeGreaterThan(0);
      expect(auditEmail(html, text, { locale, subject, previewPatterns: previewPatterns(type, locale) })).toEqual([]);
    },
  );

  it('paleta: każda para tekst/tło używana w layoucie spełnia AA', () => {
    const pairs: Array<[string, string, number]> = [
      [emailPalette.foreground, emailPalette.background, 4.5],
      [emailPalette.text, emailPalette.background, 4.5],
      [emailPalette.muted, emailPalette.background, 4.5],
      [emailPalette.link, emailPalette.background, 4.5],
      [emailPalette.background, emailPalette.primary, 4.5],
      [emailPalette.foreground, emailPalette.soft, 4.5],
      [emailPalette.footerText, emailPalette.soft, 4.5],
      [emailPalette.footerLink, emailPalette.soft, 4.5],
      [emailPalette.foreground, emailPalette.noteBackground, 4.5],
    ];
    for (const [fg, bg, min] of pairs) expect(contrastRatio(fg, bg), `${fg} na ${bg}`).toBeGreaterThanOrEqual(min);
  });
});

describe('e-maile: kontrole ujemne audytu dostępności', () => {
  const type: EmailType = 'newApplication';
  const locale: Locale = 'nl';

  async function baseline() {
    const rendered = await renderSample(type, locale);
    const expected = { locale, subject: rendered.subject, previewPatterns: previewPatterns(type, locale) };
    expect(auditEmail(rendered.html, rendered.text, expected)).toEqual([]);
    return { ...rendered, expected };
  }

  it('zły lang, brak dir i brak <title> są wykrywane', async () => {
    const { html, text, expected } = await baseline();
    const broken = html.replace('lang="nl"', 'lang="pl"').replace(' dir="ltr"', '').replace(/<title>[^<]*<\/title>/, '');
    const violations = auditEmail(broken, text, expected);
    expect(violations).toContain('lang="pl" zamiast "nl"');
    expect(violations).toContain('brak dir="ltr"');
    expect(violations.some((v) => v.startsWith('<title>'))).toBe(true);
  });

  it('preheader w języku nadawcy (pl zamiast nl) i bez pominięcia w text/plain jest wykrywany', async () => {
    const { html, text, expected } = await baseline();
    const nlPreheader = /data-skip-in-text="true"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(nlPreheader.length).toBeGreaterThan(0);
    const plRendered = await renderSample(type, 'pl');
    const plPreheader = /data-skip-in-text="true"[^>]*>([^<]*)</.exec(plRendered.html)?.[1] ?? '';
    const broken = html.replace(`>${nlPreheader}<`, `>${plPreheader}<`).replace('data-skip-in-text="true"', '');
    const violations = auditEmail(broken, text, expected);
    expect(violations.some((v) => v.includes('nie jest w języku odbiorcy'))).toBe(true);
    expect(violations.some((v) => v.includes('data-skip-in-text'))).toBe(true);
  });

  it('logo bez nazwy, obraz bez alt, link „klik hier” i tabela bez role są wykrywane', async () => {
    const { html, text, expected } = await baseline();
    const broken = html
      .replace('aria-label="Pracuj.be"', '')
      .replace('<tbody>', '<tbody><tr><td><img src="https://pracuj.be/x.png"/></td></tr>')
      .replace(/(<table[^>]*?) role="presentation"/, '$1')
      .replace('</p>', ' <a href="https://pracuj.be/f">klik hier</a></p>');
    const violations = auditEmail(broken, text, expected);
    expect(violations).toContain('logo bez nazwy dostępnej „Pracuj.be”');
    expect(violations.some((v) => v.includes('bez alt'))).toBe(true);
    expect(violations).toContain('link o nieczytelnej nazwie „klik hier”');
    expect(violations).toContain('tabela układu bez role="presentation"');
  });

  it('tekst o za niskim kontraście (#AAAAAA na bieli) jest wykrywany', async () => {
    const { html, text, expected } = await baseline();
    const broken = html.replace('color:#666666', 'color:#AAAAAA');
    expect(auditEmail(broken, text, expected).some((v) => v.startsWith('kontrast'))).toBe(true);
    // Próg dla dużego tekstu: 3:1 (nagłówek 36 px) — #949494 przechodzi, #AAAAAA nie.
    expect(contrastRatio('#949494', '#FFFFFF')).toBeGreaterThan(3);
    expect(contrastRatio('#AAAAAA', '#FFFFFF')).toBeLessThan(3);
  });

  it('text/plain bez linku CTA, z obcym linkiem albo z wypełniaczem preheadera jest wykrywany', async () => {
    const { html, text, expected } = await baseline();
    const withoutCta = text.split('https://pracuj.be/f').join('');
    expect(auditEmail(html, withoutCta, expected)).toContain('text/plain bez linku https://pracuj.be/f');
    const foreign = `${text}\nhttps://evil.example/phish`;
    expect(auditEmail(html, foreign, expected)).toContain('text/plain z linkiem spoza HTML https://evil.example/phish');
    const filler = `\u200b\u200c\u200d${text}`;
    expect(auditEmail(html, filler, expected)).toContain('text/plain zawiera znaki wypełniacza preheadera');
  });

  it('layout bez `title`/z pustym tematem nie przechodzi (render wprost)', async () => {
    const element = (
      <EmailLayout locale="en" preview="Preview" title="">
        <EmailText>Body</EmailText>
        <EmailButton href="https://pracuj.be/x">Open</EmailButton>
      </EmailLayout>
    );
    const html = await render(element);
    const text = await render(element, { plainText: true });
    const violations = auditEmail(html, text, { locale: 'en', subject: 'Subject', previewPatterns: [/^Preview$/] });
    expect(violations.some((v) => v.startsWith('<title>'))).toBe(true);
  });
});
