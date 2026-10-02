'use client';

import * as React from 'react';

/**
 * Wyszukiwanie opisem (#711) jako zwinięta sekcja. Strona renderuje ją wyłącznie przy włączonej
 * funkcji (`AI_JOB_SEARCH_ENABLED`, domyślnie wyłączona). Kod formularza (`JobSearchAssist`)
 * jest osobnym chunkiem pobieranym dopiero po rozwinięciu sekcji — lista ofert nie płaci za niego
 * przy zwykłym wejściu (budżet JS #395), a zwinięty nagłówek jest w HTML z serwera, więc nic nie
 * przesuwa układu (CLS). Bez JavaScriptu sekcja pokazuje tylko informację, że wymaga JS — zostaje
 * zwykła wyszukiwarka i filtry listy.
 */
// `React.lazy` zamiast `next/dynamic` — bez kodu obsługi SSR/bailout w bundlu listy. Komponent
// renderuje się wyłącznie po rozwinięciu (`open` startuje jako false), więc nigdy na serwerze.
const JobSearchAssist = React.lazy(() =>
  import('@/components/public/JobSearchAssist').then((m) => ({ default: m.JobSearchAssist })),
);

export interface JobSearchAssistDisclosureProps {
  locale: string;
  /** Nagłówek sekcji (tłumaczenie z serwera — `jobSearchAssist.title`). */
  title: string;
  /** Tekst dla przeglądarki bez JavaScriptu (`common.formJsRequired`). */
  noScriptText: string;
}

export function JobSearchAssistDisclosure({ locale, title, noScriptText }: JobSearchAssistDisclosureProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <details
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="min-w-0 rounded-[16px] border border-border px-[23px] py-4 max-[600px]:px-[18px]"
    >
      <summary className="flex min-h-11 cursor-pointer items-center break-words text-base font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {title}
      </summary>
      <noscript>
        <p className="mt-2 text-sm text-muted-foreground">{noScriptText}</p>
      </noscript>
      {open ? (
        <React.Suspense fallback={null}>
          <JobSearchAssist locale={locale} />
        </React.Suspense>
      ) : null}
    </details>
  );
}
