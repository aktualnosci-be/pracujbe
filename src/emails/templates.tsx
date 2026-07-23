/**
 * Szablony wiadomości e-mail Pracuj.be (React Email) — po jednym komponencie na typ maila.
 *
 * ZASADA KLUCZOWA: język maila = argument `locale` (język ODBIORCY). Żaden inny kontekst
 * (żądanie, next-intl, przeglądarka) nie decyduje o języku — wyłącznie `locale`.
 *
 * Każdy komponent przyjmuje `{ locale, ...dane }` i deleguje do wspólnego `EmailShell`,
 * który składa treść z `emailCopy[type][locale]` (interpolacja tokenów `{...}` danymi maila)
 * oraz layoutu z `@/emails/_components`.
 *
 * `renderEmail(type, locale, data)` zwraca `{ subject, html }` (render przez @react-email/render).
 */

import { createElement, type FunctionComponent, type ReactElement } from 'react';
import { render } from '@react-email/render';

import type { Locale } from '@/i18n/routing';
import { env } from '@/lib/env';
import {
  EmailButton,
  EmailHeading,
  EmailHighlight,
  EmailLayout,
  EmailQuote,
  EmailRawLink,
  EmailText,
} from '@/emails/_components';
import type { EmailType } from '@/emails/copy';
import { emailCopy, greetings, interpolate, layoutCopy } from '@/emails/copy';

/**
 * Dane wejściowe każdego typu maila. Nazwy pól odpowiadają tokenom `{...}` w `copy.ts`.
 * Pola `*Url` to gotowe, absolutne adresy (linki CTA).
 */
export interface EmailDataMap {
  accountConfirmation: { firstName?: string; confirmationUrl: string };
  welcome: { firstName?: string; dashboardUrl: string };
  passwordReset: { firstName?: string; resetUrl: string };
  newApplication: {
    recipientName?: string;
    candidateName: string;
    jobTitle: string;
    applicationUrl: string;
  };
  applicationViewed: {
    firstName?: string;
    companyName: string;
    jobTitle: string;
    applicationUrl: string;
  };
  contactInvitation: {
    firstName?: string;
    companyName: string;
    jobTitle?: string;
    message?: string;
    actionUrl: string;
  };
  newMessage: { firstName?: string; senderName: string; preview?: string; messageUrl: string };
  jobOffer: {
    firstName?: string;
    companyName: string;
    jobTitle: string;
    salary?: string;
    offerUrl: string;
  };
  offerAccepted: {
    recipientName?: string;
    candidateName: string;
    jobTitle: string;
    actionUrl: string;
  };
  offerDeclined: {
    recipientName?: string;
    candidateName: string;
    jobTitle: string;
    actionUrl: string;
  };
  statusChanged: {
    firstName?: string;
    companyName: string;
    jobTitle: string;
    status: string;
    applicationUrl: string;
  };
  jobPublished: { recipientName?: string; jobTitle: string; jobUrl: string };
  jobExpiring: { recipientName?: string; jobTitle: string; expiryDate?: string; renewUrl: string };
  payment: { recipientName?: string; amount: string; description?: string; actionUrl: string };
  invoice: { recipientName?: string; invoiceNumber: string; amount: string; downloadUrl: string };
  supportContact: { name?: string; subject?: string; message?: string; actionUrl?: string };
}

/** Propsy komponentu szablonu: język + dane danego typu. */
export type EmailProps<T extends EmailType> = { locale: Locale } & EmailDataMap[T];

/**
 * Wspólny „szkielet” treści maila: nagłówek, powitanie, akapity, opcjonalne wyróżnienie
 * i cytat, przycisk CTA (z surowym linkiem fallback) oraz opcjonalny tekst końcowy.
 */
function EmailShell(props: {
  locale: Locale;
  type: EmailType;
  vars: Record<string, unknown>;
  ctaHref: string;
  greetingName?: string;
  quote?: string;
  /** Nadpisanie wyróżnienia (gdy zależy od danych, np. tytuł + wynagrodzenie). */
  highlight?: string;
}): ReactElement {
  const { locale, type, vars, ctaHref, greetingName, quote } = props;
  const copy = emailCopy[type][locale];
  const lc = layoutCopy[locale];

  const preview = interpolate(copy.preview, vars);
  const heading = interpolate(copy.heading, vars);
  const paragraphs = interpolate(copy.body, vars)
    .split('\n\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const resolvedHighlight =
    props.highlight ?? (copy.highlight ? interpolate(copy.highlight, vars) : undefined);
  const showHighlight = resolvedHighlight !== undefined && resolvedHighlight.trim().length > 0;

  const trimmedQuote = quote?.trim();
  const showQuote = trimmedQuote !== undefined && trimmedQuote.length > 0;

  const outro = copy.outro ? interpolate(copy.outro, vars) : undefined;
  const greeting = `${greetings[locale]}${greetingName ? ` ${greetingName}` : ''},`;

  return (
    <EmailLayout locale={locale} preview={preview}>
      <EmailHeading>{heading}</EmailHeading>
      <EmailText>{greeting}</EmailText>
      {paragraphs.map((paragraph, index) => (
        <EmailText key={index}>{paragraph}</EmailText>
      ))}
      {showHighlight ? <EmailHighlight>{resolvedHighlight}</EmailHighlight> : null}
      {showQuote ? <EmailQuote>{trimmedQuote}</EmailQuote> : null}
      <EmailButton href={ctaHref}>{copy.cta}</EmailButton>
      <EmailText muted>{lc.buttonFallback}</EmailText>
      <EmailRawLink href={ctaHref} />
      {outro ? <EmailText muted>{outro}</EmailText> : null}
    </EmailLayout>
  );
}

/* -------------------------------------------------------------------------- */
/*  Komponenty szablonów — po jednym na typ maila                             */
/* -------------------------------------------------------------------------- */

export function AccountConfirmationEmail(props: EmailProps<'accountConfirmation'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="accountConfirmation"
      vars={props}
      ctaHref={props.confirmationUrl}
      greetingName={props.firstName}
    />
  );
}

export function WelcomeEmail(props: EmailProps<'welcome'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="welcome"
      vars={props}
      ctaHref={props.dashboardUrl}
      greetingName={props.firstName}
    />
  );
}

export function PasswordResetEmail(props: EmailProps<'passwordReset'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="passwordReset"
      vars={props}
      ctaHref={props.resetUrl}
      greetingName={props.firstName}
    />
  );
}

export function NewApplicationEmail(props: EmailProps<'newApplication'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="newApplication"
      vars={props}
      ctaHref={props.applicationUrl}
      greetingName={props.recipientName}
    />
  );
}

export function ApplicationViewedEmail(props: EmailProps<'applicationViewed'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="applicationViewed"
      vars={props}
      ctaHref={props.applicationUrl}
      greetingName={props.firstName}
    />
  );
}

export function ContactInvitationEmail(props: EmailProps<'contactInvitation'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="contactInvitation"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.firstName}
      quote={props.message}
    />
  );
}

export function NewMessageEmail(props: EmailProps<'newMessage'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="newMessage"
      vars={props}
      ctaHref={props.messageUrl}
      greetingName={props.firstName}
      quote={props.preview}
    />
  );
}

export function JobOfferEmail(props: EmailProps<'jobOffer'>): ReactElement {
  const highlight = props.salary ? `${props.jobTitle} · ${props.salary}` : undefined;
  return (
    <EmailShell
      locale={props.locale}
      type="jobOffer"
      vars={props}
      ctaHref={props.offerUrl}
      greetingName={props.firstName}
      highlight={highlight}
    />
  );
}

export function OfferAcceptedEmail(props: EmailProps<'offerAccepted'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="offerAccepted"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName}
    />
  );
}

export function OfferDeclinedEmail(props: EmailProps<'offerDeclined'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="offerDeclined"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName}
    />
  );
}

export function StatusChangedEmail(props: EmailProps<'statusChanged'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="statusChanged"
      vars={props}
      ctaHref={props.applicationUrl}
      greetingName={props.firstName}
    />
  );
}

export function JobPublishedEmail(props: EmailProps<'jobPublished'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="jobPublished"
      vars={props}
      ctaHref={props.jobUrl}
      greetingName={props.recipientName}
    />
  );
}

export function JobExpiringEmail(props: EmailProps<'jobExpiring'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="jobExpiring"
      vars={props}
      ctaHref={props.renewUrl}
      greetingName={props.recipientName}
    />
  );
}

export function PaymentEmail(props: EmailProps<'payment'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="payment"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName}
      quote={props.description}
    />
  );
}

export function InvoiceEmail(props: EmailProps<'invoice'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="invoice"
      vars={props}
      ctaHref={props.downloadUrl}
      greetingName={props.recipientName}
    />
  );
}

export function SupportContactEmail(props: EmailProps<'supportContact'>): ReactElement {
  const ctaHref = props.actionUrl ?? `${env.siteUrl}/${props.locale}`;
  return (
    <EmailShell
      locale={props.locale}
      type="supportContact"
      vars={props}
      ctaHref={ctaHref}
      greetingName={props.name}
      quote={props.message}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Rejestr + renderEmail                                                      */
/* -------------------------------------------------------------------------- */

/** Typ komponentu szablonu dla danego typu maila. */
type EmailComponent<T extends EmailType> = (props: EmailProps<T>) => ReactElement;

/** Mapa: typ maila -> komponent szablonu. */
const templates: { [K in EmailType]: EmailComponent<K> } = {
  accountConfirmation: AccountConfirmationEmail,
  welcome: WelcomeEmail,
  passwordReset: PasswordResetEmail,
  newApplication: NewApplicationEmail,
  applicationViewed: ApplicationViewedEmail,
  contactInvitation: ContactInvitationEmail,
  newMessage: NewMessageEmail,
  jobOffer: JobOfferEmail,
  offerAccepted: OfferAcceptedEmail,
  offerDeclined: OfferDeclinedEmail,
  statusChanged: StatusChangedEmail,
  jobPublished: JobPublishedEmail,
  jobExpiring: JobExpiringEmail,
  payment: PaymentEmail,
  invoice: InvoiceEmail,
  supportContact: SupportContactEmail,
};

/**
 * Renderuje wiadomość e-mail wybranego typu w języku ODBIORCY (`locale`).
 * Zwraca gotowy temat (z interpolacją) oraz kompletny HTML maila.
 */
export async function renderEmail<T extends EmailType>(
  type: T,
  locale: Locale,
  data: EmailDataMap[T],
): Promise<{ subject: string; html: string }> {
  // Rejestr jest w pełni typowany; tu kasujemy generyk wyłącznie na potrzeby createElement
  // (TS nie potrafi skorelować EmailDataMap[T] z sygnaturą createElement).
  const Component = templates[type] as unknown as FunctionComponent<Record<string, unknown>>;
  const element = createElement(Component, { locale, ...data });
  const html = await render(element);
  const subject = interpolate(emailCopy[type][locale].subject, data as Record<string, unknown>);
  return { subject, html };
}
