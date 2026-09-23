import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

const translations = { pl, nl, fr, en } as const;

vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ locale }: { locale: keyof typeof translations }) =>
    (key: keyof (typeof translations)['pl']['messages']) =>
      translations[locale].messages[key],
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

import { ConversationList } from '@/components/messaging/ConversationList';

describe('pusta lista rozmów', () => {
  it.each(['pl', 'nl', 'fr', 'en'] as const)('pokazuje pusty stan bez fikcyjnej rozmowy: %s', async (locale) => {
    render(await ConversationList({ items: [], basePath: '/candidate/wiadomosci', locale }));

    expect(screen.getByText(translations[locale].messages.empty)).toBeVisible();
    expect(screen.getByText(translations[locale].messages.emptyHint)).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
