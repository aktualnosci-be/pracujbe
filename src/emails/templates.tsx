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
import { Section } from '@react-email/components';

import type { Locale } from '@/i18n/routing';
import { env } from '@/lib/env';
import {
  EmailButton,
  EmailHeading,
  EmailHighlight,
  EmailLayout,
  EmailPassport,
  type EmailPassportField,
  EmailQuote,
  EmailRawLink,
  EmailText,
  EmailTextLink,
} from '@/emails/_components';
import type { EmailCopy, EmailType } from '@/emails/copy';
import { emailCopy, greetings, interpolate, jobMatchAlertOffLabel, jobOfferPassportCopy, layoutCopy, moderationLabels } from '@/emails/copy';
import { applicationStatusLabel } from '@/emails/status-labels';
import type { EmailSenderIdentity } from '@/lib/email/sender';

/**
 * Dane wejściowe każdego typu maila. Nazwy pól odpowiadają tokenom `{...}` w `copy.ts`.
 * Pola `*Url` to gotowe, absolutne adresy (linki CTA).
 */
export interface EmailDataMap {
  accountConfirmation: { firstName?: string; confirmationUrl: string };
  welcome: { firstName?: string; dashboardUrl: string };
  passwordReset: { firstName?: string; resetUrl: string };
  magicLink: { firstName?: string; loginUrl: string };
  emailChange: { firstName?: string; confirmationUrl: string };
  invite: { firstName?: string; inviteUrl: string };
  newApplication: {
    recipientName?: string;
    /** Brak / placeholder (`—`) → neutralny wariant treści (#294). */
    candidateName?: string | null;
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
  newMessage: {
    firstName?: string;
    senderName?: string | null;
    preview?: string;
    messageUrl: string;
  };
  jobOffer: {
    firstName?: string;
    companyName: string;
    jobTitle: string;
    salary?: string;
    /** Wiadomość od pracodawcy — renderowana jako cytat (#293). */
    message?: string | null;
    /** Termin odpowiedzi (ISO 8601) — formatowany w locale odbiorcy (#293). */
    expiresAt?: string | null;
    offerUrl: string;
  };
  offerAccepted: {
    recipientName?: string;
    candidateName?: string | null;
    jobTitle: string;
    actionUrl: string;
  };
  offerDeclined: {
    recipientName?: string;
    candidateName?: string | null;
    jobTitle: string;
    actionUrl: string;
  };
  statusChanged: {
    firstName?: string;
    companyName: string;
    jobTitle: string;
    /** Surowa wartość enuma `application_status` — mapowana na etykietę w języku odbiorcy (#288). */
    status: string;
    applicationUrl: string;
  };
  jobPublished: { recipientName?: string; jobTitle: string; jobUrl: string };
  /** Decyzja admina o firmie (#310) — do właściciela firmy, w jego języku. */
  companyVerified: { recipientName?: string; companyName: string; actionUrl: string };
  /** `reason` = uzasadnienie admina, renderowane jako cytat (tekst, bez HTML). */
  companyRejected: { recipientName?: string; companyName: string; reason?: string | null; actionUrl: string };
  companySuspended: { recipientName?: string; companyName: string; reason?: string | null; actionUrl: string };
  teamInvitation: {
    recipientName?: string;
    companyName: string;
    inviterName?: string | null;
    actionUrl: string;
  };
  /** 0121: adres bez konta — `actionUrl` = rejestracja pracodawcy z tokenem we fragmencie `#`. */
  teamInvitationSignup: {
    companyName: string;
    inviterName?: string | null;
    actionUrl: string;
  };
  /**
   * Digest nowych ofert dla zapisanego wyszukiwania (#100). `jobs` = najnowsze (≤ 5) z
   * gotowymi adresami w locale odbiorcy (worker, `delivery-data.ts`); `count` = wszystkie nowe.
   */
  jobMatch: {
    recipientName?: string;
    searchName: string;
    count: number;
    jobs?: Array<{ title: string; companyName?: string; city?: string; url: string }>;
    actionUrl: string;
    /** Link wyłączenia tylko tego alertu — wyłącznie z opcji workera (renderEmail), nie z payloadu. */
    alertOffUrl?: string;
  };
  /** Aplikacja bez konta (#98) — do gościa, w języku formularza (brak profilu odbiorcy). */
  guestApplicationConfirm: { recipientName?: string; jobTitle: string; companyName: string; actionUrl: string };
  guestApplicationSent: { recipientName?: string; jobTitle: string; companyName: string; actionUrl: string };
  /** Zmiana statusu aplikacji gościa (0122) — w języku formularza; `status` jak w `statusChanged`. */
  guestStatusChanged: { recipientName?: string; jobTitle: string; companyName: string; status: string; actionUrl: string };
  jobExpiring: { recipientName?: string; jobTitle: string; expiryDate?: string; renewUrl: string };
  payment: { recipientName?: string; amount: string; description?: string; actionUrl: string };
  invoice: { recipientName?: string; invoiceNumber: string; amount: string; downloadUrl: string };
  supportContact: { name?: string; subject?: string; message?: string; actionUrl?: string };
  /** Potwierdzenie zgłoszenia treści (#41) — także do osoby bez konta, w jej języku. */
  reportReceived: {
    recipientName?: string | null;
    caseNumber: string;
    accessCode: string;
    targetType?: string;
    actionUrl: string;
  };
  /** Wynik sprawy DSA dla zgłaszającego (#42) — bez uzasadnienia i danych autora. */
  reportDecisionActioned: { recipientName?: string | null; caseNumber: string; actionUrl: string };
  reportDecisionNoAction: { recipientName?: string | null; caseNumber: string; actionUrl: string };
  /** Cofnięcie ograniczenia — do zgłaszającego (#43, 0109): bez powodu i danych autora. */
  reportRestored: { recipientName?: string | null; caseNumber: string; actionUrl: string };
  /**
   * Uzasadnienie decyzji moderacyjnej dla autora treści (#42): fakty (cytat), podstawa
   * (`groundType` → etykieta w języku odbiorcy + `groundReference`), udział automatyzacji.
   */
  moderationJobRemoved: ModerationEmailData & { jobTitle: string };
  moderationCompanySuspended: ModerationEmailData;
  /** Cofnięcie ograniczenia (#42): `reason` renderowany jako cytat. */
  moderationRestored: {
    recipientName?: string;
    companyName: string;
    jobTitle?: string | null;
    reason: string;
    decisionReference: string;
    actionUrl: string;
  };
  /** Odwołanie od decyzji moderacyjnej (#43) — przyjęcie i wynik, bez danych drugiej strony. */
  appealReceived: AppealEmailData;
  appealUpheld: AppealEmailData & { reasoning: string };
  appealReversed: AppealEmailData & { reasoning: string };
  /** Zawiadomienie o naruszeniu danych (#490): temat i treść od administratora (tekst). */
  breachNotice: {
    recipientName?: string;
    noticeSubject: string;
    noticeText: string;
    incidentReference: string;
    actionUrl: string;
  };
}

/**
 * Dane e-maili odwołania (#43). `subjectRef` = numer decyzji (autor) albo numer sprawy
 * (zgłaszający) — ustalany w szablonie z tego, co przekazało RPC.
 */
interface AppealEmailData {
  recipientName?: string | null;
  appealReference: string;
  decisionReference?: string | null;
  caseNumber?: string | null;
  actionUrl: string;
}

/** Wspólne dane uzasadnienia decyzji moderacyjnej (#42). */
interface ModerationEmailData {
  recipientName?: string;
  companyName: string;
  facts: string;
  groundType: string;
  groundReference: string;
  automatedDetection?: boolean;
  decisionReference: string;
  actionUrl: string;
}

/** Propsy komponentu szablonu: język + dane danego typu. */
export type EmailProps<T extends EmailType> = { locale: Locale } & EmailDataMap[T];

/**
 * Pole, od którego zależy zdanie w treści danego typu maila. Gdy jest puste albo jest
 * placeholderem z bazy (`—`), używamy neutralnego wariantu `EmailCopy.anonymous` (#288/#294).
 */
const SUBJECT_FIELD: Partial<Record<EmailType, string>> = {
  newApplication: 'candidateName',
  offerAccepted: 'candidateName',
  offerDeclined: 'candidateName',
  newMessage: 'senderName',
  statusChanged: 'status',
  guestStatusChanged: 'status',
  companyRejected: 'reason',
  companySuspended: 'reason',
  teamInvitation: 'inviterName',
  teamInvitationSignup: 'inviterName',
};

/** Pusta wartość albo sam placeholder (myślniki/spacje), np. `'—'` z `coalesce(..., '—')` w RPC. */
function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return String(value).replace(/[\s\-\u2010-\u2015]/g, '').length === 0;
}

/**
 * Przygotowuje dane do interpolacji w języku odbiorcy: status aplikacji → przetłumaczona
 * etykieta (nieznany → pusty), placeholdery nazw → puste.
 */
function prepareVars(
  type: EmailType,
  locale: Locale,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const vars: Record<string, unknown> = { ...data };
  if (type === 'statusChanged' || type === 'guestStatusChanged') {
    vars.status = applicationStatusLabel(locale, data.status) ?? '';
  }
  const field = SUBJECT_FIELD[type];
  if (field && isBlank(vars[field])) vars[field] = '';
  return vars;
}

/** Treść maila w języku odbiorcy — z neutralnym wariantem, gdy brak kluczowej danej. */
function resolveCopy(type: EmailType, locale: Locale, vars: Record<string, unknown>): EmailCopy {
  const copy = emailCopy[type][locale];
  const field = SUBJECT_FIELD[type];
  if (field && copy.anonymous && isBlank(vars[field])) {
    return { ...copy, ...copy.anonymous };
  }
  return copy;
}

/** Tag BCP 47 do formatowania dat w e-mailu (Belgia dla nl/fr). */
const DATE_LOCALE: Record<Locale, string> = {
  pl: 'pl-PL',
  nl: 'nl-BE',
  fr: 'fr-BE',
  en: 'en-GB',
};

/** Data ISO → długi format w języku odbiorcy (strefa Europe/Brussels); zła wartość → undefined. */
function formatEmailDate(value: unknown, locale: Locale): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return undefined;
  return new Intl.DateTimeFormat(DATE_LOCALE[locale], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Brussels',
  }).format(ts);
}

function asEmailSender(value: unknown): EmailSenderIdentity | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { identity, postalAddress } = value as Record<string, unknown>;
  return typeof identity === 'string' && typeof postalAddress === 'string'
    ? { identity, postalAddress }
    : undefined;
}

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
  /** Nadpisanie wyróżnienia (gdy zależy od danych). */
  highlight?: string;
  /** Własny blok treści renderowany zamiast standardowego wyróżnienia. */
  detail?: ReactElement;
}): ReactElement {
  const { locale, type, ctaHref, greetingName, quote } = props;
  const vars = prepareVars(type, locale, props.vars);
  const copy = resolveCopy(type, locale, vars);
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
  const name = greetingName?.trim();
  const greeting = `${greetings[locale]}${name ? ` ${name}` : ''},`;
  // #45: adres wypisania przekazuje renderEmail (opcja workera), nie payload kolejki.
  const unsubscribeUrl =
    typeof props.vars.unsubscribeUrl === 'string' ? props.vars.unsubscribeUrl : undefined;
  // #45: tożsamość nadawcy też z opcji workera (po danych), nigdy z payloadu kolejki.
  const sender = asEmailSender(props.vars.emailSender);

  return (
    <EmailLayout
      locale={locale}
      preview={preview}
      unsubscribeUrl={unsubscribeUrl}
      footerNote={copy.footerNote}
      sender={sender}
    >
      <EmailHeading>{heading}</EmailHeading>
      <EmailText>{greeting}</EmailText>
      {paragraphs.map((paragraph, index) => (
        <EmailText key={index}>{paragraph}</EmailText>
      ))}
      {props.detail ??
        (showHighlight ? <EmailHighlight>{resolvedHighlight}</EmailHighlight> : null)}
      {showQuote ? <EmailQuote>{trimmedQuote}</EmailQuote> : null}
      <EmailButton href={ctaHref}>{copy.cta}</EmailButton>
      <EmailText muted>{lc.buttonFallback}</EmailText>
      <EmailRawLink href={ctaHref} />
      {outro ? <EmailText muted>{outro}</EmailText> : null}
    </EmailLayout>
  );
}

/** Propozycja pracy jako „paszport” z newsletter.html: pola w dwóch kolumnach. */
function JobOfferPassport(props: EmailProps<'jobOffer'>): ReactElement {
  const labels = jobOfferPassportCopy[props.locale];
  const salary = props.salary?.trim();
  const expiresAt = formatEmailDate(props.expiresAt, props.locale);
  const fields: EmailPassportField[] = [
    { label: labels.jobTitle, value: props.jobTitle, data: ['data-passport-field', 'job-title'] },
    { label: labels.companyName, value: props.companyName, data: ['data-passport-field', 'company-name'] },
  ];
  if (salary) fields.push({ label: labels.salary, value: salary, data: ['data-passport-field', 'salary'] });
  if (expiresAt) {
    fields.push({ label: labels.expiresAt, value: expiresAt, data: ['data-passport-field', 'expires-at'] });
  }

  return (
    <EmailPassport
      eyebrow={labels.title}
      fields={fields}
      sectionData={{ 'data-email-component': 'job-offer-passport' }}
    />
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

export function MagicLinkEmail(props: EmailProps<'magicLink'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="magicLink"
      vars={props}
      ctaHref={props.loginUrl}
      greetingName={props.firstName}
    />
  );
}

export function EmailChangeEmail(props: EmailProps<'emailChange'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="emailChange"
      vars={props}
      ctaHref={props.confirmationUrl}
      greetingName={props.firstName}
    />
  );
}

export function InviteEmail(props: EmailProps<'invite'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="invite"
      vars={props}
      ctaHref={props.inviteUrl}
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
  return (
    <EmailShell
      locale={props.locale}
      type="jobOffer"
      vars={props}
      ctaHref={props.offerUrl}
      greetingName={props.firstName}
      quote={props.message ?? undefined}
      detail={<JobOfferPassport {...props} />}
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

export function CompanyVerifiedEmail(props: EmailProps<'companyVerified'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="companyVerified"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName}
    />
  );
}

export function CompanyRejectedEmail(props: EmailProps<'companyRejected'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="companyRejected"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName}
      quote={props.reason ?? undefined}
    />
  );
}

export function CompanySuspendedEmail(props: EmailProps<'companySuspended'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="companySuspended"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName}
      quote={props.reason ?? undefined}
    />
  );
}

export function TeamInvitationEmail(props: EmailProps<'teamInvitation'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="teamInvitation"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName}
    />
  );
}

export function TeamInvitationSignupEmail(props: EmailProps<'teamInvitationSignup'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="teamInvitationSignup"
      vars={props}
      ctaHref={props.actionUrl}
    />
  );
}

export function GuestApplicationConfirmEmail(props: EmailProps<'guestApplicationConfirm'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="guestApplicationConfirm"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName}
    />
  );
}

export function GuestApplicationSentEmail(props: EmailProps<'guestApplicationSent'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="guestApplicationSent"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName}
    />
  );
}

export function GuestStatusChangedEmail(props: EmailProps<'guestStatusChanged'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="guestStatusChanged"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName}
    />
  );
}

/** Lista nowych ofert w digeście — sekcje jak paszporty newslettera: tytuł-link, firma · miasto. */
function JobMatchList({ jobs }: { jobs: EmailDataMap['jobMatch']['jobs'] }): ReactElement | null {
  const items = (jobs ?? []).filter((job) => job.title.trim().length > 0 && job.url.length > 0);
  if (items.length === 0) return null;
  return (
    <Section style={{ margin: '4px 0 8px 0' }} data-email-component="job-match-list">
      {items.map((job, index) => {
        const meta = [job.companyName, job.city].filter((v) => v && v.trim().length > 0).join(' · ');
        return (
          <EmailPassport
            key={index}
            title={<EmailTextLink href={job.url} tone="title">{job.title}</EmailTextLink>}
            fields={[]}
            footer={meta ? <strong>{meta}</strong> : undefined}
          />
        );
      })}
    </Section>
  );
}

export function JobMatchEmail(props: EmailProps<'jobMatch'>): ReactElement {
  const alertOffUrl = typeof props.alertOffUrl === 'string' && props.alertOffUrl.length > 0
    ? props.alertOffUrl
    : undefined;
  return (
    <EmailShell
      locale={props.locale}
      type="jobMatch"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName}
      detail={
        <>
          <JobMatchList jobs={props.jobs} />
          {alertOffUrl ? (
            <EmailText muted>
              <EmailTextLink href={alertOffUrl}>{jobMatchAlertOffLabel[props.locale]}</EmailTextLink>
            </EmailText>
          ) : null}
        </>
      }
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

export function ReportReceivedEmail(props: EmailProps<'reportReceived'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="reportReceived"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName ?? undefined}
    />
  );
}

export function ReportDecisionActionedEmail(props: EmailProps<'reportDecisionActioned'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="reportDecisionActioned"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName ?? undefined}
    />
  );
}

export function ReportDecisionNoActionEmail(props: EmailProps<'reportDecisionNoAction'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="reportDecisionNoAction"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName ?? undefined}
    />
  );
}

export function ReportRestoredEmail(props: EmailProps<'reportRestored'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="reportRestored"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName ?? undefined}
    />
  );
}

/** Etykiety podstawy i automatyzacji w języku odbiorcy (nieznana podstawa → pusta). */
function moderationVars(locale: Locale, props: ModerationEmailData): Record<string, unknown> {
  const labels = moderationLabels[locale];
  return {
    ...props,
    groundLabel: props.groundType === 'terms' ? labels.terms : props.groundType === 'law' ? labels.law : '',
    automationLabel: props.automatedDetection === true ? labels.automatedYes : labels.automatedNo,
  };
}

export function ModerationJobRemovedEmail(props: EmailProps<'moderationJobRemoved'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="moderationJobRemoved"
      vars={moderationVars(props.locale, props)}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName}
      quote={props.facts}
    />
  );
}

export function ModerationCompanySuspendedEmail(
  props: EmailProps<'moderationCompanySuspended'>,
): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="moderationCompanySuspended"
      vars={moderationVars(props.locale, props)}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName}
      quote={props.facts}
    />
  );
}

export function ModerationRestoredEmail(props: EmailProps<'moderationRestored'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="moderationRestored"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName}
      quote={props.reason}
    />
  );
}

function appealVars(props: AppealEmailData): Record<string, unknown> {
  return { ...props, subjectRef: props.decisionReference ?? props.caseNumber ?? props.appealReference };
}

export function AppealReceivedEmail(props: EmailProps<'appealReceived'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="appealReceived"
      vars={appealVars(props)}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName ?? undefined}
    />
  );
}

export function AppealUpheldEmail(props: EmailProps<'appealUpheld'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="appealUpheld"
      vars={appealVars(props)}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName ?? undefined}
      quote={props.reasoning}
    />
  );
}

export function AppealReversedEmail(props: EmailProps<'appealReversed'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="appealReversed"
      vars={appealVars(props)}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName ?? undefined}
      quote={props.reasoning}
    />
  );
}

export function BreachNoticeEmail(props: EmailProps<'breachNotice'>): ReactElement {
  return (
    <EmailShell
      locale={props.locale}
      type="breachNotice"
      vars={props}
      ctaHref={props.actionUrl}
      greetingName={props.recipientName}
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
  magicLink: MagicLinkEmail,
  emailChange: EmailChangeEmail,
  invite: InviteEmail,
  newApplication: NewApplicationEmail,
  applicationViewed: ApplicationViewedEmail,
  contactInvitation: ContactInvitationEmail,
  newMessage: NewMessageEmail,
  jobOffer: JobOfferEmail,
  offerAccepted: OfferAcceptedEmail,
  offerDeclined: OfferDeclinedEmail,
  statusChanged: StatusChangedEmail,
  jobPublished: JobPublishedEmail,
  companyVerified: CompanyVerifiedEmail,
  companyRejected: CompanyRejectedEmail,
  companySuspended: CompanySuspendedEmail,
  teamInvitation: TeamInvitationEmail,
  teamInvitationSignup: TeamInvitationSignupEmail,
  jobMatch: JobMatchEmail,
  guestApplicationConfirm: GuestApplicationConfirmEmail,
  guestApplicationSent: GuestApplicationSentEmail,
  guestStatusChanged: GuestStatusChangedEmail,
  jobExpiring: JobExpiringEmail,
  payment: PaymentEmail,
  invoice: InvoiceEmail,
  supportContact: SupportContactEmail,
  reportReceived: ReportReceivedEmail,
  reportDecisionActioned: ReportDecisionActionedEmail,
  reportDecisionNoAction: ReportDecisionNoActionEmail,
  reportRestored: ReportRestoredEmail,
  moderationJobRemoved: ModerationJobRemovedEmail,
  moderationCompanySuspended: ModerationCompanySuspendedEmail,
  moderationRestored: ModerationRestoredEmail,
  appealReceived: AppealReceivedEmail,
  appealUpheld: AppealUpheldEmail,
  appealReversed: AppealReversedEmail,
  breachNotice: BreachNoticeEmail,
};

/**
 * Renderuje wiadomość e-mail wybranego typu w języku ODBIORCY (`locale`).
 * Zwraca gotowy temat (z interpolacją) oraz kompletny HTML maila.
 */
export async function renderEmail<T extends EmailType>(
  type: T,
  locale: Locale,
  data: EmailDataMap[T],
  options: { unsubscribeUrl?: string; sender?: EmailSenderIdentity; alertOffUrl?: string } = {},
): Promise<{ subject: string; html: string; text: string }> {
  // Rejestr jest w pełni typowany; tu kasujemy generyk wyłącznie na potrzeby createElement
  // (TS nie potrafi skorelować EmailDataMap[T] z sygnaturą createElement).
  const Component = templates[type] as unknown as FunctionComponent<Record<string, unknown>>;
  // `locale` PO danych: klucz `locale` w payloadzie kolejki nie może nadpisać języka odbiorcy (#348).
  // `unsubscribeUrl` też PO danych: payload kolejki nie może podmienić adresu wypisania (#45).
  const element = createElement(Component, {
    ...data,
    locale,
    unsubscribeUrl: options.unsubscribeUrl,
    emailSender: options.sender,
    // #100: link wyłączenia alertu też PO danych — payload kolejki go nie podmieni.
    alertOffUrl: options.alertOffUrl,
  });
  const html = await render(element);
  // #45: wersja text/plain z tego samego drzewa (multipart/alternative u dostawcy).
  const text = await render(element, { plainText: true });
  const vars = prepareVars(type, locale, data as Record<string, unknown>);
  const subject = interpolate(resolveCopy(type, locale, vars).subject, vars);
  return { subject, html, text };
}
