import { describe, expect, it } from "vitest";

import { renderNewsletterEmail, type NewsletterJob } from "@/emails/newsletter";
import { newsletterCopy } from "@/emails/newsletter-copy";
import { routing, type Locale } from "@/i18n/routing";

const localizedJobs: Record<Locale, readonly NewsletterJob[]> = {
  pl: [
    {
      locale: "pl",
      slug: "operator-cnc-antwerpia",
      title: "Operator CNC",
      city: "Antwerpia",
      salary: "18–21 € / godz.",
      isDemo: false,
    },
    {
      locale: "pl",
      slug: "elektryk-przemyslowy-gandawa",
      title: "Elektryk przemysłowy",
      city: "Gandawa",
      isDemo: false,
    },
    {
      locale: "pl",
      slug: "magazynier-bruksela",
      title: "Magazynier",
      city: "Bruksela",
      salary: "2 900 € / mies.",
      isDemo: false,
    },
  ],
  nl: [
    {
      locale: "nl",
      slug: "cnc-operator-antwerpen",
      title: "CNC-operator",
      city: "Antwerpen",
      salary: "18–21 € / uur",
      isDemo: false,
    },
    {
      locale: "nl",
      slug: "industrieel-elektricien-gent",
      title: "Industrieel elektricien",
      city: "Gent",
      isDemo: false,
    },
    {
      locale: "nl",
      slug: "magazijnier-brussel",
      title: "Magazijnier",
      city: "Brussel",
      salary: "2.900 € / maand",
      isDemo: false,
    },
  ],
  fr: [
    {
      locale: "fr",
      slug: "operateur-cnc-anvers",
      title: "Opérateur CNC",
      city: "Anvers",
      salary: "18–21 € / heure",
      isDemo: false,
    },
    {
      locale: "fr",
      slug: "electricien-industriel-gand",
      title: "Électricien industriel",
      city: "Gand",
      isDemo: false,
    },
    {
      locale: "fr",
      slug: "magasinier-bruxelles",
      title: "Magasinier",
      city: "Bruxelles",
      salary: "2 900 € / mois",
      isDemo: false,
    },
  ],
  en: [
    {
      locale: "en",
      slug: "cnc-operator-antwerp",
      title: "CNC operator",
      city: "Antwerp",
      salary: "€18–21 / hour",
      isDemo: false,
    },
    {
      locale: "en",
      slug: "industrial-electrician-ghent",
      title: "Industrial electrician",
      city: "Ghent",
      isDemo: false,
    },
    {
      locale: "en",
      slug: "warehouse-worker-brussels",
      title: "Warehouse worker",
      city: "Brussels",
      salary: "€2,900 / month",
      isDemo: false,
    },
  ],
};

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("renderer newslettera", () => {
  it.each(routing.locales)(
    "renderuje tekst z tymi samymi ofertami, linkami i kolejnością co HTML (%s)",
    async (locale: Locale) => {
      const jobs = localizedJobs[locale];
      const { html, text, transportReady } = await renderNewsletterEmail(
        locale,
        jobs,
      );
      const document = parse(html);
      const htmlJobs = Array.from(
        document.querySelectorAll("[data-newsletter-job]"),
      );

      expect(transportReady).toBe(false);
      expect(htmlJobs.map((card) => card.getAttribute("data-newsletter-job"))).toEqual(
        jobs.map((job) => job.slug),
      );
      expect(text).toContain(newsletterCopy[locale].heading);
      expect(text).toContain(newsletterCopy[locale].intro);
      expect(text).not.toMatch(/<\/?(?:html|body|section|a|p|span)\b|\{\{[^}]+\}\}/i);

      let previousPosition = -1;
      for (const job of jobs) {
        const titlePosition = text.indexOf(job.title);
        expect(titlePosition).toBeGreaterThan(previousPosition);
        previousPosition = titlePosition;
        expect(text).toContain(job.city);
        expect(text).toContain(
          `http://localhost:3000/${locale}/oferty-pracy/${job.slug}`,
        );
        if (job.salary) {
          expect(text).toContain(job.salary);
        }
      }

      expect(text).toContain(`http://localhost:3000/${locale}/oferty-pracy`);
      expect(text).toContain(
        `http://localhost:3000/${locale}/candidate/ustawienia`,
      );
    },
  );

  it.each(routing.locales)(
    "nie dopisuje pensji, gdy oferta nie podaje stawki (%s)",
    async (locale: Locale) => {
      const { text } = await renderNewsletterEmail(locale, [localizedJobs[locale][1]!]);
      expect(text).toContain(localizedJobs[locale][1]!.title);
      expect(text).not.toContain(`${newsletterCopy[locale].salary}:`);
    },
  );

  it.each(routing.locales)(
    "renderuje 1–3 realne oferty i lokalizowane linki (%s)",
    async (locale: Locale) => {
      for (const count of [1, 3]) {
        const jobs = localizedJobs[locale];
        const { subject, html } = await renderNewsletterEmail(
          locale,
          jobs.slice(0, count),
        );
        const document = parse(html);
        const renderedJobs = document.querySelectorAll("[data-newsletter-job]");

        expect(subject).toBe(newsletterCopy[locale].subject);
        expect(
          (await renderNewsletterEmail(locale, jobs.slice(0, count)))
            .transportReady,
        ).toBe(false);
        expect(document.documentElement.lang).toBe(locale);
        expect(renderedJobs).toHaveLength(count);
        expect(
          document.querySelector(
            `a[href="http://localhost:3000/${locale}/oferty-pracy"]`,
          ),
        ).not.toBeNull();
        expect(
          document.querySelector(
            `a[href="http://localhost:3000/${locale}/candidate/ustawienia"]`,
          ),
        ).not.toBeNull();

        for (const job of jobs.slice(0, count)) {
          const card = document.querySelector(
            `[data-newsletter-job="${job.slug}"]`,
          );
          expect(card?.textContent).toContain(job.title);
          expect(card?.textContent).toContain(job.city);
          expect(
            card?.querySelector(
              `a[href="http://localhost:3000/${locale}/oferty-pracy/${job.slug}"]`,
            ),
          ).not.toBeNull();
        }
        expect(html).not.toMatch(/\{\{[^}]+\}\}|undefined|null/i);
      }
    },
  );

  it.each(routing.locales)(
    "pomija pole wynagrodzenia, gdy stawki nie ma (%s)",
    async (locale: Locale) => {
      const jobs = localizedJobs[locale];
      const { html } = await renderNewsletterEmail(locale, [jobs[1]!]);
      const card = parse(html).querySelector("[data-newsletter-job]");

      expect(
        card?.querySelector('[data-newsletter-field="salary"]'),
      ).toBeNull();
      expect(card?.textContent).not.toContain(newsletterCopy[locale].salary);
    },
  );

  it("odrzuca placeholdery i oferty demonstracyjne", async () => {
    await expect(
      renderNewsletterEmail("pl", [
        {
          locale: "pl",
          slug: "oferta",
          title: "{{job_title}}",
          city: "Bruksela",
          isDemo: false,
        },
      ]),
    ).rejects.toThrow(/placeholderów/);
    await expect(
      renderNewsletterEmail("pl", [
        {
          locale: "pl",
          slug: "oferta-demo",
          title: "Oferta",
          city: "Bruksela",
          isDemo: true,
        },
      ]),
    ).rejects.toThrow(/demonstracyjnej/);
  });

  it.each([0, 4])(
    "odrzuca liczbę ofert spoza zakresu 1–3 (%s)",
    async (count) => {
      await expect(
        renderNewsletterEmail(
          "pl",
          Array.from({ length: count }, (_, index) => ({
            locale: "pl" as const,
            slug: `oferta-${index + 1}`,
            title: `Oferta ${index + 1}`,
            city: "Bruksela",
            isDemo: false,
          })),
        ),
      ).rejects.toThrow(/od 1 do 3/);
    },
  );

  it("odrzuca ofertę w języku innym niż język wiadomości", async () => {
    await expect(
      renderNewsletterEmail("pl", [localizedJobs.en[0]!]),
    ).rejects.toThrow(/Język oferty/);
  });

  it.each([
    "../admin",
    "oferta?next=admin",
    "oferta%2Fadmin",
    'oferta\"onclick-alert',
  ])("odrzuca niebezpieczny slug: %s", async (slug) => {
    await expect(
      renderNewsletterEmail("pl", [{ ...localizedJobs.pl[0]!, slug }]),
    ).rejects.toThrow(/realnego sluga/);
  });

  it("escapuje tekst oferty zamiast tworzyć z niego HTML", async () => {
    const hostileTitle = '<img src=x onerror="alert(1)">';
    const hostileCity = '<script>alert("city")</script>';
    const hostileSalary = '20 € <svg onload="alert(2)">';
    const { html } = await renderNewsletterEmail("pl", [
      {
        locale: "pl",
        slug: "bezpieczna-oferta",
        title: hostileTitle,
        city: hostileCity,
        salary: hostileSalary,
        isDemo: false,
      },
    ]);
    const document = parse(html);
    const card = document.querySelector("[data-newsletter-job]");

    expect(card?.textContent).toContain(hostileTitle);
    expect(card?.textContent).toContain(hostileCity);
    expect(card?.textContent).toContain(hostileSalary);
    expect(card?.querySelector("img, script, svg")).toBeNull();
    expect(html).not.toContain("<img src=x onerror=");
    expect(html).not.toContain("<script>alert");
  });
});
