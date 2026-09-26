import type { ReactElement } from "react";
import { render } from "@react-email/render";

import {
  EmailButton,
  EmailHeading,
  EmailLayout,
  EmailPassport,
  type EmailPassportField,
  EmailRawLink,
  EmailText,
  EmailTextLink,
} from "@/emails/_components";
import { newsletterCopy } from "@/emails/newsletter-copy";
import { interpolate, layoutCopy } from "@/emails/copy";
import type { Locale } from "@/i18n/routing";
import { env } from "@/lib/env";
import type { EmailSenderIdentity } from "@/lib/email/sender";
import {
  NEWSLETTER_JOBS_MAX,
  NEWSLETTER_JOBS_MIN,
  newsletterJobIssues,
} from "@/lib/email/newsletter-rules";

export interface NewsletterJob {
  /** Język treści oferty. Musi być zgodny z językiem całej wiadomości. */
  locale: Locale;
  /** Publiczny slug oferty pochodzącej z trwałego źródła danych. */
  slug: string;
  title: string;
  city: string;
  salary?: string;
  /** Jawny znacznik chroni integrację przed przekazaniem danych demonstracyjnych. */
  isDemo: boolean;
}

export interface NewsletterEmailProps {
  locale: Locale;
  jobs: readonly NewsletterJob[];
  transport?: NewsletterTransport;
}

/**
 * Dane transportu (#45) — przekazuje je wyłącznie worker kolejki: podpisany adres wypisania
 * i tożsamość nadawcy z konfiguracji. Bez nich wynik jest tylko podglądem.
 */
export interface NewsletterTransport {
  unsubscribeUrl: string;
  sender: EmailSenderIdentity;
}

/**
 * `transportReady: true` tylko z kompletem danych transportu (wypisanie + nadawca z adresem
 * pocztowym). Worker odmawia wysyłki wyniku bez tej flagi.
 */
export interface NewsletterRenderFoundation {
  readonly transportReady: boolean;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export function assertRenderableJobs(
  jobs: readonly NewsletterJob[],
  locale: Locale,
): asserts jobs is readonly NewsletterJob[] {
  if (jobs.length < NEWSLETTER_JOBS_MIN || jobs.length > NEWSLETTER_JOBS_MAX) {
    throw new Error("Newsletter wymaga od 1 do 3 realnych ofert.");
  }

  for (const job of jobs) {
    if (job.isDemo === true)
      throw new Error("Newsletter nie może zawierać oferty demonstracyjnej.");
    if (job.locale !== locale) {
      throw new Error("Język oferty musi być zgodny z językiem newslettera.");
    }
    // Te same reguły pól co edytor kampanii w panelu admina (`newsletter-rules.ts`).
    const issues = Object.values(newsletterJobIssues(job));
    if (issues.includes("slug") || issues.includes("placeholder")) {
      throw new Error(
        "Newsletter wymaga realnego sluga i treści bez placeholderów.",
      );
    }
    if (issues.includes("required")) {
      throw new Error("Newsletter wymaga tytułu i miasta każdej oferty.");
    }
  }
}

/** Karta oferty = `PASZPORT PRACY` z prototypowego newsletter.html (miejsce | stawka, link). */
function NewsletterJobCard({
  locale,
  job,
}: {
  locale: Locale;
  job: NewsletterJob;
}): ReactElement {
  const copy = newsletterCopy[locale];
  const href = `${env.siteUrl}/${locale}/oferty-pracy/${job.slug}`;
  const salary = job.salary?.trim();
  const fields: EmailPassportField[] = [{ label: copy.location, value: job.city }];
  if (salary) {
    fields.push({ label: copy.salary, value: salary, data: ["data-newsletter-field", "salary"] });
  }

  return (
    <EmailPassport
      eyebrow={copy.passport}
      title={job.title}
      fields={fields}
      link={{ href, label: copy.viewJob }}
      sectionData={{ "data-newsletter-job": job.slug }}
    />
  );
}

export function NewsletterEmail({
  locale,
  jobs,
  transport,
}: NewsletterEmailProps): ReactElement {
  assertRenderableJobs(jobs, locale);
  const copy = newsletterCopy[locale];
  const jobsHref = `${env.siteUrl}/${locale}/oferty-pracy`;
  const preferencesHref = `${env.siteUrl}/${locale}/candidate/ustawienia`;

  return (
    <EmailLayout
      locale={locale}
      preview={copy.preview}
      unsubscribeUrl={transport?.unsubscribeUrl}
      sender={transport?.sender}
    >
      <EmailHeading>{copy.heading}</EmailHeading>
      <EmailText>{copy.intro}</EmailText>
      {jobs.map((job) => (
        <NewsletterJobCard key={job.slug} locale={locale} job={job} />
      ))}
      <EmailButton href={jobsHref}>{copy.viewAll}</EmailButton>
      <EmailText muted>{copy.preferencesNote}</EmailText>
      <EmailText muted>
        <EmailTextLink href={preferencesHref}>{copy.preferences}</EmailTextLink>
      </EmailText>
      <EmailRawLink href={preferencesHref} />
    </EmailLayout>
  );
}

function renderNewsletterText(
  locale: Locale,
  jobs: readonly NewsletterJob[],
  transport?: NewsletterTransport,
): string {
  const copy = newsletterCopy[locale];
  const footer = layoutCopy[locale];
  const site = `${env.siteUrl}/${locale}`;
  const lines = [copy.heading, "", copy.intro];

  for (const job of jobs) {
    lines.push("", copy.passport, job.title, `${copy.location}: ${job.city}`);
    if (job.salary?.trim()) {
      lines.push(`${copy.salary}: ${job.salary.trim()}`);
    }
    lines.push(`${copy.viewJob}: ${site}/oferty-pracy/${job.slug}`);
  }

  lines.push(
    "",
    `${copy.viewAll}: ${site}/oferty-pracy`,
    "",
    copy.preferencesNote,
    `${copy.preferences}: ${site}/candidate/ustawienia`,
    "",
    footer.tagline,
    footer.footerNote,
  );
  if (transport) {
    lines.push(
      `${footer.unsubscribe}: ${transport.unsubscribeUrl}`,
      `${footer.sender}: ${transport.sender.identity}`,
      `${footer.postalAddress}: ${transport.sender.postalAddress}`,
    );
  }
  lines.push(interpolate(footer.rights, { year: new Date().getFullYear() }));

  return `${lines.join("\n")}\n`;
}

export async function renderNewsletterEmail(
  locale: Locale,
  jobs: readonly NewsletterJob[],
  transport?: NewsletterTransport,
): Promise<NewsletterRenderFoundation> {
  assertRenderableJobs(jobs, locale);
  const ready = Boolean(
    transport?.unsubscribeUrl && transport.sender?.identity && transport.sender.postalAddress,
  );
  const html = await render(
    <NewsletterEmail locale={locale} jobs={jobs} transport={ready ? transport : undefined} />,
  );
  return {
    transportReady: ready,
    subject: newsletterCopy[locale].subject,
    html,
    text: renderNewsletterText(locale, jobs, ready ? transport : undefined),
  };
}
