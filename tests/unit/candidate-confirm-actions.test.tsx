import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationActions } from '@/components/candidate/ApplicationActions';
import { ProfileChecklist } from '@/components/candidate/ProfileChecklist';
import { profileChecklistItems } from '@/components/candidate/profile-checklist-items';
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

/** Nazwa przycisku „…”: z tytułem oferty, gdy jest znany (#341). */
function rowActionsName(m: (typeof messages)['pl'], jobTitle?: string) {
  return jobTitle ? m.dashboard.rowActionsFor.replace('{title}', jobTitle) : m.dashboard.rowActions;
}

function openWithdraw(m: (typeof messages)['pl'], jobTitle?: string) {
  fireEvent.click(screen.getByRole('button', { name: rowActionsName(m, jobTitle) }));
  fireEvent.click(screen.getByRole('menuitem', { name: m.dashboard.withdrawApplication }));
}

describe('wycofanie aplikacji wymaga potwierdzenia (#328)', () => {
  it.each(['pl', 'nl', 'fr', 'en'] as const)(
    'anulowanie nie wysyła akcji i oddaje fokus przyciskowi „…”: %s',
    async (locale) => {
      const m = messages[locale];
      renderActions(locale, 'Magazynier');
      openWithdraw(m, 'Magazynier');

      const dialog = screen.getByRole('alertdialog', { name: m.dashboard.withdrawConfirmTitle });
      expect(dialog).toHaveTextContent('Magazynier');
      expect(screen.getByRole('button', { name: m.common.cancel })).toHaveFocus();

      fireEvent.click(screen.getByRole('button', { name: m.common.cancel }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(withdrawApplication).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: rowActionsName(m, 'Magazynier') })).toHaveFocus(),
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

describe('menu „…” przy aplikacji — wzorzec ARIA menu (#341)', () => {
  it.each(['pl', 'nl', 'fr', 'en'] as const)('nazwa przycisku zawiera tytuł oferty: %s', (locale) => {
    const m = messages[locale];
    renderActions(locale, 'Magazynier – Antwerpia');
    const trigger = screen.getByRole('button', { name: rowActionsName(m, 'Magazynier – Antwerpia') });
    expect(trigger).toHaveAccessibleName(expect.stringContaining('Magazynier – Antwerpia'));
    expect(trigger.className).toMatch(/min-h-11/);
    expect(trigger.className).toMatch(/min-w-11/);
  });

  it('otwarcie przenosi fokus do menu, strzałki/Home/End krążą, Escape wraca do „…”', async () => {
    renderActions('pl', 'Magazynier');
    const trigger = screen.getByRole('button', { name: rowActionsName(pl, 'Magazynier') });
    fireEvent.click(trigger);
    const view = screen.getByRole('menuitem', { name: pl.dashboard.actionView });
    const withdraw = screen.getByRole('menuitem', { name: pl.dashboard.withdrawApplication });
    await waitFor(() => expect(view).toHaveFocus());

    const menu = screen.getByRole('menu');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(withdraw).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(view).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(withdraw).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(view).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(withdraw).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('strzałka w dół na zamkniętym przycisku otwiera menu', async () => {
    renderActions('pl');
    fireEvent.keyDown(screen.getByRole('button', { name: pl.dashboard.rowActions }), { key: 'ArrowDown' });
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: pl.dashboard.actionView })).toHaveFocus(),
    );
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

describe('pozycje checklisty pulpitu i profilu (#315, #317)', () => {
  it('pozycje to kroki kreatora: etykieta = tytuł kroku, „Dodaj” prowadzi do tego kroku', () => {
    const o = pl.onboarding as Record<string, string>;
    const items = profileChecklistItems(
      { basicInfo: false, preferences: false, experience: false, location: true, languages: false, availability: false },
      pl.dashboard.add,
      (key) => o[key]!,
    );
    expect(items.map((i) => i.label)).toEqual([1, 2, 3, 4, 5, 6].map((n) => o[`step${n}Title`]));
    expect(items.map((i) => i.href)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `/candidate/onboarding?step=${n}`));
    render(<ProfileChecklist items={items} />);
    // Uzupełniona „Lokalizacja” nie ma akcji; pozostałych pięć da się uzupełnić w kreatorze.
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.queryByText(pl.dashboard.checkPhoto)).not.toBeInTheDocument();
    expect(screen.queryByText(pl.dashboard.checkEducation)).not.toBeInTheDocument();
  });
});
