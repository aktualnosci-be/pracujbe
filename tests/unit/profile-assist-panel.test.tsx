import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileAssistPanel } from '@/components/candidate/ProfileAssistPanel';
import { applyProfileAssistProposals, proposeProfileFromAnswers } from '@/lib/actions/profile-assist';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * #37 (część kandydata) — UI asystenta profilu: informacja o AI przed pierwszym użyciem
 * (art. 50 ust. 1 AI Act) w języku interfejsu i powiązana z przyciskiem; propozycje domyślnie
 * NIEzaznaczone; zapis tylko zaznaczonych; błąd zachowuje odpowiedzi.
 */

vi.mock('@/lib/actions/profile-assist', () => ({
  proposeProfileFromAnswers: vi.fn(),
  applyProfileAssistProposals: vi.fn(),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Omit<React.ComponentProps<'a'>, 'href'> & { href: string }) => (
    <a {...props} href={href}>{children}</a>
  ),
}));

const MESSAGES = { pl, en, nl, fr } as const;

function setup(locale: keyof typeof MESSAGES = 'pl') {
  vi.mocked(proposeProfileFromAnswers).mockResolvedValue({
    ok: true,
    removed: { referenceSections: 0, personalSections: 0, thirdPartyLines: 1, personalLines: 0, specialCategoryLines: 0, contacts: 1 },
    proposals: [
      { id: 'occupation-0', kind: 'occupation', value: 'Magazynier', evidence: 'pracowałem w magazynie', uncertain: false },
      { id: 'skill-0', kind: 'skill', value: 'Kierowanie zespołem', evidence: '', uncertain: true },
    ],
  });
  vi.mocked(applyProfileAssistProposals).mockResolvedValue({
    ok: true,
    added: { occupations: 1, skills: 0, languages: 0, certificates: 0, experienceYears: false },
  });
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <ProfileAssistPanel />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProfileAssistPanel', () => {
  for (const locale of Object.keys(MESSAGES) as (keyof typeof MESSAGES)[]) {
    it(`${locale}: informacja o AI widoczna przed użyciem i opisuje przycisk`, () => {
      setup(locale);
      const m = MESSAGES[locale].profileAssist;
      const notice = screen.getByText(m.aiNotice);
      const button = screen.getByRole('button', { name: m.propose });
      const describedBy = button.getAttribute('aria-describedby') ?? '';
      expect(describedBy).not.toBe('');
      expect(document.getElementById(describedBy)?.contains(notice)).toBe(true);
      expect(proposeProfileFromAnswers).not.toHaveBeenCalled();
    });
  }

  it('propozycje niezaznaczone; zapis tylko zaznaczonych', async () => {
    setup();
    fireEvent.change(screen.getByLabelText(pl.profileAssist.questionWork), {
      target: { value: 'Przez 3 lata pracowałem w magazynie.' },
    });
    fireEvent.click(screen.getByRole('button', { name: pl.profileAssist.propose }));
    await screen.findByRole('heading', { name: pl.profileAssist.reviewTitle });
    expect(proposeProfileFromAnswers).toHaveBeenCalledWith({ work: 'Przez 3 lata pracowałem w magazynie.' });
    for (const box of screen.getAllByRole('checkbox')) expect(box).not.toBeChecked();
    expect(screen.getByText(pl.profileAssist.noSource)).toBeTruthy();

    // Kontrola ujemna: bez zaznaczenia nic nie idzie do zapisu.
    fireEvent.click(screen.getByRole('button', { name: pl.profileAssist.apply }));
    expect(await screen.findByRole('alert')).toHaveTextContent(pl.profileAssist.errorNothingSelected);
    expect(applyProfileAssistProposals).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Magazynier' }));
    fireEvent.click(screen.getByRole('button', { name: pl.profileAssist.apply }));
    await screen.findByRole('heading', { name: pl.profileAssist.doneTitle });
    expect(applyProfileAssistProposals).toHaveBeenCalledWith({
      occupations: ['Magazynier'],
      skills: [],
      languages: [],
      certificates: [],
      experienceYears: null,
    });
  });

  it('błąd serwera: komunikat bez technikaliów, odpowiedzi zostają', async () => {
    setup();
    vi.mocked(proposeProfileFromAnswers).mockResolvedValueOnce({ ok: false, error: 'PROFILE_ASSIST_SENSITIVE_DATA' });
    const field = screen.getByLabelText(pl.profileAssist.questionWork) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Magazyn, NISS 85.07.30-033.28' } });
    fireEvent.click(screen.getByRole('button', { name: pl.profileAssist.propose }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(pl.errors.profileAssistSensitiveData));
    expect(field.value).toBe('Magazyn, NISS 85.07.30-033.28');
  });
});
