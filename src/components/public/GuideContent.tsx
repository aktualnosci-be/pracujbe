import * as React from 'react';

import type { GuideBlock } from '@/lib/guides/guides';

/**
 * GuideContent — renderuje strukturalną treść artykułu (bloki: nagłówek / akapit / lista).
 *
 * Komponent serwerowy (bez stanu/hooków). Treść pochodzi z `@/lib/guides/guides` (dane statyczne),
 * więc klucze oparte na indeksie są bezpieczne (kolejność bloków jest stała). Typografia spójna
 * ze stronami informacyjnymi (`_legal/legal-page`): wąska kolumna, wyraźne nagłówki, czytelny tekst.
 */

export interface GuideContentProps {
  body: readonly GuideBlock[];
}

export function GuideContent({ body }: GuideContentProps): React.JSX.Element {
  return (
    <div className="mt-8">
      {body.map((block, index) => {
        const key = `${block.type}-${index}`;

        if (block.type === 'heading') {
          return (
            <h2
              key={key}
              className="mt-10 text-xl font-bold tracking-tight text-foreground first:mt-0 md:text-2xl"
            >
              {block.text}
            </h2>
          );
        }

        if (block.type === 'list') {
          return (
            <ul
              key={key}
              className="mt-4 list-disc space-y-2 pl-5 text-base leading-relaxed text-muted-foreground marker:text-accent"
            >
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{item}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={key} className="mt-4 text-base leading-relaxed text-muted-foreground">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}
