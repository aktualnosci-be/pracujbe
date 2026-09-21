/**
 * Wspólne komponenty layoutu wiadomości e-mail Pracuj.be (React Email).
 *
 * Styl: jasny, prosty, responsywny; tekstowe logo „pracuj.be”, jeden przycisk CTA, stopka.
 * Bez ciężkich grafik i bez zewnętrznych zasobów (maile muszą działać offline w kliencie).
 *
 * WYJĄTEK OD ZASADY KOLORÓW: klasy Tailwind (bg-primary itd.) mapowane są na zmienne CSS,
 * które NIE istnieją w kontekście klienta pocztowego. Maile wymagają stylów inline i wartości
 * heksadecymalnych — dlatego kolory marki trzymamy tu w jednym miejscu (`palette`), spójnym
 * z design tokenami aplikacji, i tylko przez ten obiekt (bez rozsypanych hexów w JSX).
 */

import type { CSSProperties, ReactNode } from 'react';
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
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

/**
 * Paleta marki (spójna z design tokenami globals.css). Jedyne źródło kolorów w mailach.
 */
const palette = {
  primary: '#D92932',
  primaryDark: '#B91D25',
  foreground: '#151515',
  muted: '#616161',
  background: '#FFFFFF',
  soft: '#F7F7F7',
  border: '#DEDEDE',
  success: '#16A34A',
  warning: '#EA580C',
  error: '#DC2626',
} as const;

const fontStack =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif";

const styles = {
  body: {
    backgroundColor: palette.soft,
    margin: 0,
    padding: '24px 0',
    fontFamily: fontStack,
    color: palette.foreground,
    WebkitFontSmoothing: 'antialiased',
  } satisfies CSSProperties,
  container: {
    backgroundColor: palette.background,
    borderRadius: '12px',
    border: `1px solid ${palette.border}`,
    maxWidth: '560px',
    margin: '0 auto',
    overflow: 'hidden',
  } satisfies CSSProperties,
  header: {
    padding: '24px 32px 0 32px',
  } satisfies CSSProperties,
  logoLink: {
    textDecoration: 'none',
    display: 'inline-block',
  } satisfies CSSProperties,
  logoTile: {
    display: 'inline-block',
    backgroundColor: palette.primary,
    color: palette.background,
    borderRadius: '8px',
    fontWeight: 700,
    fontSize: '18px',
    lineHeight: '22px',
    padding: '4px 6px',
    marginLeft: '2px',
    verticalAlign: 'middle',
  } satisfies CSSProperties,
  logoWordFirst: {
    color: palette.foreground,
    fontWeight: 700,
    fontSize: '18px',
    verticalAlign: 'middle',
  } satisfies CSSProperties,
  content: {
    padding: '8px 32px 8px 32px',
  } satisfies CSSProperties,
  heading: {
    color: palette.foreground,
    fontSize: '22px',
    lineHeight: '30px',
    fontWeight: 700,
    margin: '16px 0 8px 0',
  } satisfies CSSProperties,
  text: {
    color: palette.foreground,
    fontSize: '15px',
    lineHeight: '24px',
    margin: '0 0 14px 0',
  } satisfies CSSProperties,
  textMuted: {
    color: palette.muted,
    fontSize: '13px',
    lineHeight: '20px',
    margin: '0 0 8px 0',
  } satisfies CSSProperties,
  highlight: {
    backgroundColor: palette.soft,
    border: `1px solid ${palette.border}`,
    borderRadius: '8px',
    padding: '14px 16px',
    color: palette.foreground,
    fontSize: '16px',
    fontWeight: 600,
    lineHeight: '22px',
    margin: '4px 0 18px 0',
  } satisfies CSSProperties,
  quote: {
    borderLeft: `3px solid ${palette.primary}`,
    backgroundColor: palette.soft,
    borderRadius: '0 8px 8px 0',
    padding: '12px 16px',
    color: palette.foreground,
    fontSize: '14px',
    lineHeight: '22px',
    fontStyle: 'italic',
    margin: '4px 0 18px 0',
    whiteSpace: 'pre-line',
  } satisfies CSSProperties,
  buttonWrap: {
    margin: '8px 0 20px 0',
  } satisfies CSSProperties,
  button: {
    backgroundColor: palette.primary,
    color: palette.background,
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: 600,
    textDecoration: 'none',
    textAlign: 'center',
    padding: '12px 24px',
    display: 'inline-block',
  } satisfies CSSProperties,
  rawLink: {
    color: palette.primary,
    fontSize: '12px',
    lineHeight: '18px',
    wordBreak: 'break-all',
    margin: '0 0 16px 0',
    display: 'inline-block',
  } satisfies CSSProperties,
  hr: {
    borderColor: palette.border,
    margin: '8px 0',
  } satisfies CSSProperties,
  footer: {
    padding: '16px 32px 28px 32px',
  } satisfies CSSProperties,
  footerText: {
    color: palette.muted,
    fontSize: '12px',
    lineHeight: '18px',
    margin: '0 0 6px 0',
  } satisfies CSSProperties,
  footerLink: {
    color: palette.muted,
    fontSize: '12px',
    textDecoration: 'underline',
  } satisfies CSSProperties,
} as const;

/** Tekstowe logo „pracuj.be” z białym sufiksem na czerwonym kafelku. */
function EmailLogo({ locale }: { locale: Locale }): ReactNode {
  const href = `${env.siteUrl}/${locale}`;
  return (
    <Link href={href} style={styles.logoLink}>
      <span style={styles.logoWordFirst}>pracuj</span>
      <span style={styles.logoTile}>.be</span>
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
}: {
  locale: Locale;
  preview: string;
  children: ReactNode;
}): ReactNode {
  const lc = layoutCopy[locale];
  const year = new Date().getFullYear();
  const rights = interpolate(lc.rights, { year });
  const helpHref = `${env.siteUrl}/${locale}`;

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

          <Hr style={styles.hr} />

          <Section style={styles.footer}>
            <Text style={styles.footerText}>{lc.tagline}</Text>
            <Text style={styles.footerText}>{lc.footerNote}</Text>
            <Text style={styles.footerText}>
              <Link href={helpHref} style={styles.footerLink}>
                {lc.help}
              </Link>
              {'  ·  '}
              <Link href={helpHref} style={styles.footerLink}>
                {lc.privacy}
              </Link>
            </Text>
            <Text style={styles.footerText}>{rights}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
