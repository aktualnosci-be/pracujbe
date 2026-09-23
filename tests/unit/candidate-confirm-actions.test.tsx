import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationActions } from '@/components/candidate/ApplicationActions';
import { ProfileChecklist } from '@/components/candidate/ProfileChecklist';
import { withdrawApplication } from '@/lib/actions/candidate';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh }),
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock('@/lib/actions/candidate', () => ({ withdrawApplication: vi.fn() }));

const messages = { pl, nl, fr, en } as const;

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function renderActions(locale: keyof typeof messages = 'pl', jobTitle?: string) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <ApplicationActions applicationId="app-1" status="submitted" slug="job-1" jobTitle={jobTitle} />
    </NextIntlClientProvider>,
  );
}

function openWithdraw(m: (typeof messages)['pl']) {
  fireEvent.click(screen.getByRole('button', { name: m.dashboard.rowActions }));
  fireEvent.click(screen.getByRole('menuitem', { name: m.dashboard.withdrawApplication }));
}

describe('wycofanie aplikacji wymaga potwierdzenia (#328)', () => {
  it.each(['pl', 'nl', 'fr', 'en'] as const)(
    'anulowanie nie wysyła akcji i oddaje fokus przyciskowi „…”: %s',
    async (locale) => {
      const m = messages[locale];
      renderActions(locale, 'Magazynier');
      openWithdraw(m);

      const dialog = screen.getByRole('alertdialog', { name: m.dashboard.withdrawConfirmTitle });
      expect(dialog).toHaveTextContent('Magazynier');
      expect(screen.getByRole('button', { name: m.common.cancel })).toHaveFocus();

      fireEvent.click(screen.getByRole('button', { name: m.common.cancel }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(withdrawApplication).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: m.dashboard.rowActions })).toHaveFocus(),
      );
    },
  );

  it('potwierdzenie wysyła akcję raz, ogłasza sukces i wraca fokusem do „…”', async () => {
    vi.mocked(withdrawApplication).mockResolvedValue({ ok: true });
    renderActions('pl');
    openWithdraw(pl);
    expect(screen.getByRole('alertdialog')).toHaveTextContent(pl.dashboard.withdrawConfirmDescription);

    const confirm = screen.getByRole('button', { name: pl.dashboard.withdrawConfirm });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(withdrawApplication).toHaveBeenCalledExactlyOnceWith('app-1');
    expect(await screen.findByRole('status')).toHaveTextContent(pl.dashboard.withdrawSuccess);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: pl.dashboard.rowActions })).toHaveFocus(),
    );
  });

  it('błąd zamyka dialog i pokazuje komunikat bez odświeżania', async () => {
    vi.mocked(withdrawApplication).mockResolvedValue({ ok: false, error: 'INTERNAL' });
    renderActions('pl');
    openWithdraw(pl);
    fireEvent.click(screen.getByRole('button', { name: pl.dashboard.withdrawConfirm }));

    expect(await screen.findByText(pl.errors.generic)).toBeVisible();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('checklista kompletności (#317)', () => {
  it('„Dodaj” z celem jest prawdziwym linkiem z nazwą sekcji', () => {
    render(
      <ProfileChecklist
        items={[
          { label: 'Umiejętności', action: 'Dodaj', href: '/candidate/onboarding?step=3' },
          { label: 'Zdjęcie', hint: 'Brak' },
        ]}
      />,
    );
    const link = screen.getByRole('link', { name: 'Dodaj: Umiejętności' });
    expect(link).toHaveAttribute('href', '/candidate/onboarding?step=3');
    expect(link).toHaveClass('min-h-11');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('bez celu nie udaje linku (neutralny tekst, bez koloru akcentu)', () => {
    render(<ProfileChecklist items={[{ label: 'Doświadczenie', action: 'Dodaj' }]} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const text = screen.getByText('Dodaj');
    expect(text).toHaveClass('text-muted-foreground');
    expect(text.className).not.toMatch(/text-accent/);
  });

  it('uzupełniona sekcja nie ma akcji', () => {
    render(<ProfileChecklist items={[{ label: 'Języki', done: true, action: 'Dodaj', href: '/x' }]} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('Dodaj')).not.toBeInTheDocument();
  });
});
