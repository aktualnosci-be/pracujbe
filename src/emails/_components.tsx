/**
 * Wspólne komponenty layoutu wiadomości e-mail Pracuj.be (React Email).
 *
 * Wygląd = kalka prototypu „Ludzie i praca” (#6/#7): `docs/design/people-passport/prototype/
 * materials/newsletter.html` — szare tło #f4f4f4, biała kolumna 600 px bez ramki, logo
 * „pracuj” + biały „.be” na czerwonym kafelku (geometria nagłówka strony, `.people .logo`),
 * nagłówek 36 px z −1 px światła, akapity 16 px / 1,7 w #666, czerwony przycisk z promieniem
 * 11 px, sekcje paszportu oddzielone linią #e5e5e5, stopka na #f8f8f8.
 *
 * Odstępstwa wymuszone przez klienty pocztowe i wymogi repo (opis w PR / CLAUDE.md §2):
 * - style inline i układ tabelaryczny (brak arkuszy i media queries w wielu klientach);
 * - bez webfontów: `'DM Sans', Arial, sans-serif` — DM Sans tylko, gdy jest zainstalowany
 *   u odbiorcy, inaczej Arial jak w prototypowym newsletterze;
 * - #777 z prototypu → #767676 (WCAG AA na bieli), tekst stopki na #f8f8f8 → #6b6b6b;
 * - wartości heksadecymalne zamiast tokenów CSS (zmienne CSS nie działają w poczcie) —
 *   WYŁĄCZNIE przez `emailPalette` (test `email-palette.test.tsx` odrzuca inne kolory).
 */

import type { CSSProperties, ReactNode } from 'react';
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { Button as REButton } from '@react-email/components';

import type { Locale } from '@/i18n/routing';
import { env } from '@/lib/env';
import { interpolate, layoutCopy } from '@/emails/copy';
import type { EmailSenderIdentity } from '@/lib/email/sender';

/**
 * Paleta maili = kolory prototypowego newslettera (tokeny `--pp-*` z globals.css).
 * Jedyne źródło kolorów w mailach.
 */
export const emailPalette = {
  /** --pp-red: kafelek „.be”, przycisk. */
  primary: '#D92932',
  /** Link tekstowy „Poznaj ofertę →” (newsletter.html). */
  link: '#B91F29',
  /** --pp-ink: nagłówki, wartości pól. */
  foreground: '#151515',
  /** Akapity (newsletter.html `color:#666`, --pp-text-hero). */
  text: '#666666',
  /** Etykiety i drobny tekst (#777 → #767676 AA, --pp-text-meta). */
  muted: '#767676',
  /** Tekst stopki na #f8f8f8 (--pp-text-note, AA na szarym tle). */
  footerText: '#6B6B6B',
  /** Linki stopki (newsletter.html `color:#555`). */
  footerLink: '#555555',
  background: '#FFFFFF',
  /** Tło wokół kolumny (newsletter.html `background:#f4f4f4`). */
  canvas: '#F4F4F4',
  /** --pp-section-bg: stopka. */
  soft: '#F8F8F8',
  /** --pp-line: linie oddzielające paszporty. */
  border: '#E5E5E5',
  /** --pp-note-bg / --pp-line-note: notatka (`.p-profile-note`). */
  noteBackground: '#FFF9F9',
  noteBorder: '#F0D8D9',
} as const;

const palette = emailPalette;

/** Bez webfontów: DM Sans tylko z systemu odbiorcy, dalej Arial jak w newsletter.html. */
export const emailFontStack = "'DM Sans', Arial, sans-serif";

const styles = {
  body: {
    backgroundColor: palette.canvas,
    margin: 0,
    padding: 0,
    fontFamily: emailFontStack,
    color: palette.foreground,
    WebkitFontSmoothing: 'antialiased',
  } satisfies CSSProperties,
  container: {
    backgroundColor: palette.background,
    width: '100%',
    maxWidth: '600px',
    margin: '0 auto',
  } satisfies CSSProperties,
  header: {
    padding: '32px 28px 20px 28px',
  } satisfies CSSProperties,
  logoLink: {
    // Bez jawnego koloru <Link> React Email wstawia własny niebieski (#067df7).
    color: palette.foreground,
    textDecoration: 'none',
    display: 'inline-block',
  } satisfies CSSProperties,
  /* Znak z nagłówka strony (`.people .logo` 29 px / 800 / −1,5 px; `.suffix`: odstęp .09em,
     dopełnienie .1/.17/.14em, promień .22em, światło −.055em) przeliczony na piksele. */
  logoWord: {
    color: palette.foreground,
    fontFamily: emailFontStack,
    fontSize: '29px',
    fontWeight: 800,
    letterSpacing: '-1.5px',
    lineHeight: '29px',
    padding: '0 3px 0 0',
    verticalAlign: 'baseline',
    whiteSpace: 'nowrap',
  } satisfies CSSProperties,
  logoTile: {
    backgroundColor: palette.primary,
    color: palette.background,
    borderRadius: '6px',
    fontFamily: emailFontStack,
    fontSize: '29px',
    fontWeight: 800,
    letterSpacing: '-1.6px',
    lineHeight: '29px',
    padding: '3px 5px 4px 5px',
    verticalAlign: 'baseline',
    whiteSpace: 'nowrap',
  } satisfies CSSProperties,
  content: {
    padding: '12px 28px 28px 28px',
  } satisfies CSSProperties,
  heading: {
    color: palette.foreground,
    fontSize: '36px',
    lineHeight: '40px',
    letterSpacing: '-1px',
    fontWeight: 700,
    margin: '20px 0',
  } satisfies CSSProperties,
  text: {
    color: palette.text,
    fontSize: '16px',
    lineHeight: '27px',
    margin: '0 0 16px 0',
  } satisfies CSSProperties,
  textMuted: {
    color: palette.muted,
    fontSize: '13px',
    lineHeight: '22px',
    margin: '0 0 12px 0',
  } satisfies CSSProperties,
  highlight: {
    borderTop: `1px solid ${palette.border}`,
    borderBottom: `1px solid ${palette.border}`,
    padding: '24px 0',
    color: palette.foreground,
    fontSize: '21px',
    fontWeight: 700,
    lineHeight: '27px',
    margin: '8px 0 24px 0',
  } satisfies CSSProperties,
  quote: {
    border: `1px solid ${palette.noteBorder}`,
    backgroundColor: palette.noteBackground,
    borderRadius: '19px',
    padding: '20px 22px',
    color: palette.foreground,
    fontSize: '15px',
    lineHeight: '25px',
    margin: '4px 0 24px 0',
    whiteSpace: 'pre-line',
  } satisfies CSSProperties,
  buttonWrap: {
    margin: '18px 0 20px 0',
  } satisfies CSSProperties,
  button: {
    backgroundColor: palette.primary,
    color: palette.background,
    borderRadius: '11px',
    fontFamily: emailFontStack,
    fontSize: '15px',
    lineHeight: '18px',
    fontWeight: 700,
    textDecoration: 'none',
    textAlign: 'center',
    padding: '17px 23px',
    display: 'inline-block',
  } satisfies CSSProperties,
  rawLink: {
    color: palette.link,
    fontSize: '12px',
    lineHeight: '18px',
    wordBreak: 'break-all',
    margin: '0 0 16px 0',
    display: 'inline-block',
  } satisfies CSSProperties,
  footer: {
    backgroundColor: palette.soft,
    padding: '24px 28px',
  } satisfies CSSProperties,
  footerStrong: {
    color: palette.foreground,
    fontSize: '12px',
    fontWeight: 700,
    lineHeight: '22px',
    margin: 0,
  } satisfies CSSProperties,
  footerText: {
    color: palette.footerText,
    fontSize: '12px',
    lineHeight: '22px',
    margin: 0,
  } satisfies CSSProperties,
  footerLink: {
    color: palette.footerLink,
    fontSize: '12px',
    textDecoration: 'underline',
  } satisfies CSSProperties,
  passport: {
    borderTop: `1px solid ${palette.border}`,
    padding: '24px 0',
  } satisfies CSSProperties,
  passportEyebrow: {
    color: palette.muted,
    fontSize: '11px',
    letterSpacing: '1px',
    lineHeight: '16px',
    margin: '0 0 10px 0',
    textTransform: 'uppercase',
  } satisfies CSSProperties,
  passportTitle: {
    color: palette.foreground,
    fontSize: '21px',
    fontWeight: 700,
    lineHeight: '27px',
    margin: '0 0 16px 0',
  } satisfies CSSProperties,
  passportCell: {
    color: palette.foreground,
    fontSize: '14px',
    lineHeight: '20px',
    padding: '0 12px 12px 0',
    verticalAlign: 'top',
    width: '50%',
  } satisfies CSSProperties,
  /* newsletter.html: `<span style="color:#777;font-size:11px">` — bez światła (tylko nadtytuł
     „PASZPORT PRACY” ma letter-spacing 1px). */
  passportLabel: {
    color: palette.muted,
    fontSize: '11px',
    lineHeight: '16px',
    margin: 0,
    textTransform: 'uppercase',
  } satisfies CSSProperties,
  passportValue: {
    color: palette.foreground,
    fontSize: '14px',
    fontWeight: 700,
    lineHeight: '20px',
    margin: 0,
  } satisfies CSSProperties,
  passportTitleLink: {
    color: palette.foreground,
    textDecoration: 'none',
  } satisfies CSSProperties,
  passportMeta: {
    color: palette.foreground,
    fontSize: '14px',
    lineHeight: '20px',
    margin: 0,
  } satisfies CSSProperties,
  /* newsletter.html: `<p style="font-size:13px;margin:17px 0 0">` pod tabelą pól. Komórki pól
     mają 12 px dolnego dopełnienia, więc margines akapitu = 17 − 12 = 5 px; rozmiar i interlinia
     jawnie (inaczej <Text> React Email wstawia 14 px / 24 px). */
  passportLinkWrap: {
    fontSize: '13px',
    lineHeight: '20px',
    margin: '5px 0 0 0',
  } satisfies CSSProperties,
  passportLink: {
    color: palette.link,
    fontSize: '13px',
    lineHeight: '20px',
    textDecoration: 'underline',
  } satisfies CSSProperties,
} as const;

/** Znak „pracuj.be” jak w nagłówku strony: dwie komórki tabeli (Outlook ignoruje tło spanów). */
function EmailLogo({ locale }: { locale: Locale }): ReactNode {
  const href = `${env.siteUrl}/${locale}`;
  return (
    <Link href={href} style={styles.logoLink} aria-label="Pracuj.be">
      <table role="presentation" cellPadding={0} cellSpacing={0} border={0}>
        <tbody>
          <tr>
            <td style={styles.logoWord}>pracuj</td>
            <td style={styles.logoTile}>.be</td>
          </tr>
        </tbody>
      </table>
    </Link>
  );
}

/** Pole paszportu: etykieta (wersaliki 11 px) nad wartością (pogrubione 14 px), dwa akapity. */
export interface EmailPassportField {
  label: string;
  value: string;
  /** Atrybut `data-*` pola (selektory testów i podglądu), np. `['data-passport-field', 'salary']`. */
  data?: readonly [string, string];
}

/**
 * Sekcja „paszportu pracy” z newsletter.html: linia #e5e5e5, etykieta nad tytułem,
 * pola w dwóch kolumnach (tabela) i opcjonalny link „Poznaj ofertę →”.
 */
export function EmailPassport({
  eyebrow,
  title,
  fields,
  link,
  footer,
  sectionData,
}: {
  eyebrow?: string;
  title?: ReactNode;
  fields: readonly EmailPassportField[];
  link?: { href: string; label: string };
  /** Krótka linia pod tytułem, gdy pola nie mają etykiet (np. firma · miasto w digeście). */
  footer?: ReactNode;
  sectionData?: Record<string, string>;
}): ReactNode {
  const rows: EmailPassportField[][] = [];
  for (let index = 0; index < fields.length; index += 2) rows.push(fields.slice(index, index + 2));
  return (
    <Section style={styles.passport} {...sectionData}>
      {eyebrow ? <Text style={styles.passportEyebrow}>{eyebrow}</Text> : null}
      {title ? (
        <Text style={rows.length > 0 ? styles.passportTitle : { ...styles.passportTitle, margin: '0 0 6px 0' }}>
          {title}
        </Text>
      ) : null}
      {rows.length > 0 ? (
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((field, cellIndex) => (
                  <td
                    key={cellIndex}
                    style={styles.passportCell}
                    {...(field.data ? { [field.data[0]]: field.data[1] } : {})}
                  >
                    <Text style={styles.passportLabel}>{field.label}</Text>
                    <Text style={styles.passportValue}>{field.value}</Text>
                  </td>
                ))}
                {row.length === 1 ? <td style={styles.passportCell} /> : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {footer ? <Text style={styles.passportMeta}>{footer}</Text> : null}
      {link ? (
        <Text style={styles.passportLinkWrap}>
          <Link href={link.href} style={styles.passportLink}>
            {link.label}
          </Link>
        </Text>
      ) : null}
    </Section>
  );
}

/**
 * Link tekstowy: `link` = kolor linków prototypu (#B91F29, „Poznaj ofertę →”),
 * `title` = tytuł paszportu jako link (czarny, bez podkreślenia, jak nagłówek h2).
 */
export function EmailTextLink({
  href,
  children,
  tone = 'link',
}: {
  href: string;
  children: ReactNode;
  tone?: 'link' | 'title';
}): ReactNode {
  return (
    <Link href={href} style={tone === 'title' ? styles.passportTitleLink : styles.passportLink}>
      {children}
    </Link>
  );
}

/** Nagłówek treści (H1). */
export function EmailHeading({ children }: { children: ReactNode }): ReactNode {
  return <Heading style={styles.heading}>{children}</Heading>;
}

/** Akapit treści; `muted`/`small` dla drobnego tekstu pomocniczego. */
export function EmailText({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}): ReactNode {
  return <Text style={muted ? styles.textMuted : styles.text}>{children}</Text>;
}

/** Wyróżniony boks (np. tytuł stanowiska, kwota, status). */
export function EmailHighlight({ children }: { children: ReactNode }): ReactNode {
  return <Text style={styles.highlight}>{children}</Text>;
}

/** Cytowany blok (np. treść wiadomości / podglądu). */
export function EmailQuote({ children }: { children: ReactNode }): ReactNode {
  return <Text style={styles.quote}>{children}</Text>;
}

/** Główny przycisk CTA. */
export function EmailButton({ href, children }: { href: string; children: ReactNode }): ReactNode {
  return (
    <Section style={styles.buttonWrap}>
      <REButton href={href} style={styles.button}>
        {children}
      </REButton>
    </Section>
  );
}

/** Surowy link pod przyciskiem (fallback dla klientów blokujących przyciski). */
export function EmailRawLink({ href }: { href: string }): ReactNode {
  return (
    <Link href={href} style={styles.rawLink}>
      {href}
    </Link>
  );
}

/**
 * Kompletny layout maila: `<Html>` z nagłówkiem (logo), treścią (children) i stopką.
 * `preview` to preheader; `locale` ustawia `lang` i teksty stopki.
 */
export function EmailLayout({
  locale,
  preview,
  children,
  unsubscribeUrl,
  footerNote,
  sender,
}: {
  locale: Locale;
  preview: string;
  children: ReactNode;
  /** Strona wypisania z kategorii tej wiadomości (#45). Brak = mail bez linku wypisania. */
  unsubscribeUrl?: string;
  /** Nadpisanie noty „masz konto…” (odbiorca bez konta, #41). */
  footerNote?: string;
  /** Tożsamość i adres pocztowy nadawcy z konfiguracji (#45; wymagane w marketingu). */
  sender?: EmailSenderIdentity;
}): ReactNode {
  const lc = layoutCopy[locale];
  const year = new Date().getFullYear();
  const rights = interpolate(lc.rights, { year });
  // Pomoc i polityka prywatności w języku odbiorcy (#61/#6; link do prywatności zostaje —
  // decyzja właściciela 26.09.2026).
  const helpHref = `${env.siteUrl}/${locale}/pomoc`;
  const privacyHref = `${env.siteUrl}/${locale}/polityka-prywatnosci`;

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.header}>
            <EmailLogo locale={locale} />
          </Section>

          <Section style={styles.content}>{children}</Section>

          <Section style={styles.footer}>
            <Text style={styles.footerStrong}>{lc.tagline}</Text>
            <Text style={styles.footerText}>{footerNote ?? lc.footerNote}</Text>
            <Text style={styles.footerText}>
              <Link href={helpHref} style={styles.footerLink} data-email-help="">
                {lc.help}
              </Link>
              {'  ·  '}
              <Link href={privacyHref} style={styles.footerLink} data-email-privacy="">
                {lc.privacy}
              </Link>
              {unsubscribeUrl ? (
                <>
                  {'  ·  '}
                  <Link href={unsubscribeUrl} style={styles.footerLink} data-email-unsubscribe="">
                    {lc.unsubscribe}
                  </Link>
                </>
              ) : null}
            </Text>
            {sender ? (
              <Text style={styles.footerText} data-email-sender="">
                {lc.sender}: {sender.identity}
                {'  ·  '}
                {lc.postalAddress}: {sender.postalAddress}
              </Text>
            ) : null}
            <Text style={styles.footerText}>{rights}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
