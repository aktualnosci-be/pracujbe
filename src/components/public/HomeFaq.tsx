import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * HomeFaq — sekcja najczęstszych pytań na stronie głównej.
 *
 * Używa natywnych `<details>/<summary>` (dostępne, działa bez JS — komponent
 * serwerowy). Treść z namespace `home` (faqTitle + faqQ1..5 / faqA1..5).
 * Dodatkowo emituje dane strukturalne FAQPage (JSON-LD) dla SEO.
 */

const FAQ_ITEMS = [
  { q: 'faqQ1', a: 'faqA1' },
  { q: 'faqQ2', a: 'faqA2' },
  { q: 'faqQ3', a: 'faqA3' },
  { q: 'faqQ4', a: 'faqA4' },
  { q: 'faqQ5', a: 'faqA5' },
] as const;

export async function HomeFaq(): Promise<React.JSX.Element> {
  const t = await getTranslations('home');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map(({ q, a }) => ({
      '@type': 'Question',
      name: t(q),
      acceptedAnswer: { '@type': 'Answer', text: t(a) },
    })),
  };

  return (
    <section className="container py-12 md:py-16">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t('faqTitle')}
        </h2>
        <div className="mt-6 divide-y divide-border overflow-hidden rounded-lg border border-border">
          {FAQ_ITEMS.map(({ q, a }) => (
            <details key={q} className="group bg-background">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-left text-sm font-medium text-foreground transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5">
                {t(q)}
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <p className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground sm:px-5">
                {t(a)}
              </p>
            </details>
          ))}
        </div>
      </div>
      <script
        type="application/ld+json"
        // Dane strukturalne (nie tekst UI) — bezpiecznie serializowane z tłumaczeń.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </section>
  );
}
