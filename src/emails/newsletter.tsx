import type { CSSProperties, ReactElement } from "react";
import { render } from "@react-email/render";
import { Link, Section, Text } from "@react-email/components";

import {
  EmailButton,
  EmailHeading,
  EmailLayout,
  EmailRawLink,
  EmailText,
  emailPalette,
} from "@/emails/_components";
import { newsletterCopy } from "@/emails/newsletter-copy";
import { interpolate, layoutCopy } from "@/emails/copy";
import type { Locale } from "@/i18n/routing";
import { env } from "@/lib/env";

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
}

/**
 * Wynik służy wyłącznie do przeglądu/renderowania. Nie jest kontraktem transportu.
 * Issue #45 musi najpierw dodać ponowną kontrolę zgody tuż przed wysyłką,
 * one-click unsubscribe URL i nagłówki RFC 8058 oraz tożsamość/adres nadawcy.
 */
export interface NewsletterRenderFoundation {
  readonly transportReady: false;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

const placeholderPattern = /\{\{[^}]+\}\}/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertRenderableJobs(
  jobs: readonly NewsletterJob[],
  locale: Locale,
): asserts jobs is readonly NewsletterJob[] {
  if (jobs.length < 1 || jobs.length > 3) {
    throw new Error("Newsletter wymaga od 1 do 3 realnych ofert.");
  }

  for (const job of jobs) {
    const values = [job.slug, job.title, job.city, job.salary ?? ""];
    if (job.isDemo === true)
      throw new Error("Newsletter nie może zawierać oferty demonstracyjnej.");
    if (job.locale !== locale) {
      throw new Error("Język oferty musi być zgodny z językiem newslettera.");
    }
    if (
      !slugPattern.test(job.slug) ||
      values.some((value) => placeholderPattern.test(value))
    ) {
      throw new Error(
        "Newsletter wymaga realnego sluga i treści bez placeholderów.",
      );
    }
    if (!job.title.trim() || !job.city.trim()) {
      throw new Error("Newsletter wymaga tytułu i miasta każdej oferty.");
    }
  }
}

const styles = {
  card: {
    borderTop: `1px solid ${emailPalette.border}`,
    padding: "20px 0 16px 0",
  } satisfies CSSProperties,
  eyebrow: {
    color: emailPalette.primary,
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "1px",
    lineHeight: "16px",
    margin: "0 0 8px 0",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  title: {
    color: emailPalette.foreground,
    fontSize: "19px",
    fontWeight: 700,
    lineHeight: "26px",
    margin: "0 0 12px 0",
  } satisfies CSSProperties,
  detail: {
    color: emailPalette.muted,
    fontSize: "13px",
    lineHeight: "20px",
    margin: "0 0 4px 0",
  } satisfies CSSProperties,
  value: {
    color: emailPalette.foreground,
    fontWeight: 600,
  } satisfies CSSProperties,
  link: {
    color: emailPalette.primaryDark,
    display: "inline-block",
    fontSize: "14px",
    fontWeight: 700,
    lineHeight: "22px",
    marginTop: "8px",
  } satisfies CSSProperties,
} as const;

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

  return (
    <Section style={styles.card} data-newsletter-job={job.slug}>
      <Text style={styles.eyebrow}>{copy.passport}</Text>
      <Text style={styles.title}>{job.title}</Text>
      <Text style={styles.detail}>
        {copy.location}: <span style={styles.value}>{job.city}</span>
      </Text>
      {salary ? (
        <Text style={styles.detail} data-newsletter-field="salary">
          {copy.salary}: <span style={styles.value}>{salary}</span>
        </Text>
      ) : null}
      <Link href={href} style={styles.link}>
        {copy.viewJob}
      </Link>
    </Section>
  );
}

export function NewsletterEmail({
  locale,
  jobs,
}: NewsletterEmailProps): ReactElement {
  assertRenderableJobs(jobs, locale);
  const copy = newsletterCopy[locale];
  const jobsHref = `${env.siteUrl}/${locale}/oferty-pracy`;
  const preferencesHref = `${env.siteUrl}/${locale}/candidate/ustawienia`;

  return (
    <EmailLayout locale={locale} preview={copy.preview}>
      <EmailHeading>{copy.heading}</EmailHeading>
      <EmailText>{copy.intro}</EmailText>
      {jobs.map((job) => (
        <NewsletterJobCard key={job.slug} locale={locale} job={job} />
      ))}
      <EmailButton href={jobsHref}>{copy.viewAll}</EmailButton>
      <EmailText muted>{copy.preferencesNote}</EmailText>
      <Link href={preferencesHref} style={styles.link}>
        {copy.preferences}
      </Link>
      <EmailRawLink href={preferencesHref} />
    </EmailLayout>
  );
}

function renderNewsletterText(locale: Locale, jobs: readonly NewsletterJob[]): string {
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
    interpolate(footer.rights, { year: new Date().getFullYear() }),
  );

  return `${lines.join("\n")}\n`;
}

export async function renderNewsletterEmail(
  locale: Locale,
  jobs: readonly NewsletterJob[],
): Promise<NewsletterRenderFoundation> {
  assertRenderableJobs(jobs, locale);
  const html = await render(<NewsletterEmail locale={locale} jobs={jobs} />);
  return {
    transportReady: false,
    subject: newsletterCopy[locale].subject,
    html,
    text: renderNewsletterText(locale, jobs),
  };
}
