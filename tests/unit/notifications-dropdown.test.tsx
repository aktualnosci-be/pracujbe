import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';
import { NotificationsDropdown } from '@/components/dashboard/NotificationsDropdown';

let locale: keyof typeof messages = 'pl';
const messages = { pl, nl, fr, en };

vi.mock('next-intl', () => ({
  useTranslations: () => (key: keyof typeof pl.notifications) => messages[locale].notifications[key],
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

afterEach(cleanup);

describe('notifications dropdown', () => {
  it.each(['pl', 'nl', 'fr', 'en'] as const)('shows a retryable read error in %s without an empty inbox or zero count', (selectedLocale) => {
    locale = selectedLocale;
    const onRetry = vi.fn();
    render(<NotificationsDropdown items={[]} error onRetry={onRetry} seeAllHref="/candidate/wiadomosci" />);
    expect(screen.getByRole('alert')).toHaveTextContent(messages[selectedLocale].notifications.loadError);
    expect(screen.queryByText(messages[selectedLocale].notifications.empty)).not.toBeInTheDocument();
    expect(screen.queryByText(messages[selectedLocale].notifications.markAllRead)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: messages[selectedLocale].notifications.retry }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps the valid empty state distinct from an error', () => {
    locale = 'pl';
    render(<NotificationsDropdown items={[]} count={0} />);
    expect(screen.getByText(pl.notifications.empty)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
