import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgeAttestationSettings } from '@/components/settings/AgeAttestationSettings';
import { ProfileVisibilitySettings } from '@/components/settings/ProfileVisibilitySettings';
import { AgeStatusProvider } from '@/components/settings/age-status-context';
import { attestCandidateAgeAction } from '@/lib/actions/age-attestation';
import { setProfileVisibilityAction } from '@/lib/actions/profile-visibility';
import type { AgeAttestationState } from '@/lib/data/age-policy';
import type { ProfileVisibility } from '@/lib/data/profile-visibility';
import pl from '@/messages/pl.json';

/**
 * #828: potwierdzenie 18+ w sekcji „Wiek” odblokowuje przełącznik widoczności na tej samej
 * stronie, bez przeładowania — ale go NIE włącza (osobny opt-in, #494). Nieudany zapis
 * i niekompletny profil nie odblokowują. Kontrola ujemna: dawne okablowanie (sam prop
 * `adult` z odczytu strony, bez wspólnego stanu) zostawia przełącznik wyłączony.
 */

vi.mock('@/lib/actions/age-attestation', () => ({ attestCandidateAgeAction: vi.fn() }));
vi.mock('@/lib/actions/profile-visibility', () => ({ setProfileVisibilityAction: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const MINOR: AgeAttestationState = { requiredMinAge: 16, attestedMinAge: 16, meetsPolicy: true, isAdult: false };
const COMPLETE: ProfileVisibility = { searchable: false, completed: true, changedAt: null };
const INCOMPLETE: ProfileVisibility = { ...COMPLETE, completed: false };

const adultBand = pl.auth.ageBandAdult.replace('{age}', '18');

/** Obie sekcje jak na stronie `/candidate/ustawienia`; `shared=false` = okablowanie sprzed #828. */
function renderPage(visibility: ProfileVisibility = COMPLETE, shared = true) {
  const sections = (
    <>
      <AgeAttestationSettings initial={MINOR} />
      <ProfileVisibilitySettings initial={visibility} adult={MINOR.isAdult} />
    </>
  );
  render(
    <NextIntlClientProvider locale="pl" messages={pl} timeZone="Europe/Brussels">
      {shared ? <AgeStatusProvider initialAdult={MINOR.isAdult}>{sections}</AgeStatusProvider> : sections}
    </NextIntlClientProvider>,
  );
  return {
    toggle: () => screen.getByRole('switch', { name: pl.profileVisibility.toggleLabel }),
    confirmAdult: async () => {
      fireEvent.click(screen.getByRole('radio', { name: adultBand }));
      fireEvent.click(screen.getByRole('button', { name: pl.ageAttestation.submit }));
      await waitFor(() => expect(attestCandidateAgeAction).toHaveBeenCalledTimes(1));
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('ustawienia kandydata: wiek → widoczność profilu (#828)', () => {
  it('konto 16–17: przełącznik wyłączony z wyjaśnieniem', () => {
    const page = renderPage();
    expect(page.toggle()).toBeDisabled();
    expect(screen.getByTestId('profile-visibility-adult-only')).toHaveTextContent(pl.profileVisibility.requiresAdult);
  });

  it('udany zapis 18+ odblokowuje przełącznik bez przeładowania, bez włączania widoczności', async () => {
    vi.mocked(attestCandidateAgeAction).mockResolvedValue({ ok: true, meetsPolicy: true });
    vi.mocked(setProfileVisibilityAction).mockResolvedValue({ ok: true, searchable: true, changedAt: null });
    const page = renderPage();
    await page.confirmAdult();
    expect(await screen.findByText(pl.ageAttestation.saved)).toBeInTheDocument();

    await waitFor(() => expect(page.toggle()).toBeEnabled());
    expect(screen.queryByTestId('profile-visibility-adult-only')).toBeNull();
    // Sam zapis wieku nie zmienia wyszukiwalności.
    expect(page.toggle()).toHaveAttribute('aria-checked', 'false');
    expect(setProfileVisibilityAction).not.toHaveBeenCalled();

    // Klawiatura: przełącznik przyjmuje fokus i dopiero świadoma decyzja wysyła zapis.
    page.toggle().focus();
    expect(document.activeElement).toBe(page.toggle());
    fireEvent.click(page.toggle());
    await waitFor(() => expect(setProfileVisibilityAction).toHaveBeenCalledWith(true));
    await waitFor(() => expect(page.toggle()).toHaveAttribute('aria-checked', 'true'));
  });

  it('nieudany zapis wieku: przełącznik nadal wyłączony', async () => {
    vi.mocked(attestCandidateAgeAction).mockResolvedValue({ ok: false, error: 'INTERNAL' });
    const page = renderPage();
    await page.confirmAdult();
    expect(await screen.findByText(pl.ageAttestation.saveError)).toBeInTheDocument();
    expect(page.toggle()).toBeDisabled();
    expect(screen.getByTestId('profile-visibility-adult-only')).toBeInTheDocument();
  });

  it('zapis bez spełnienia polityki (meetsPolicy=false): przełącznik nadal wyłączony', async () => {
    vi.mocked(attestCandidateAgeAction).mockResolvedValue({ ok: true, meetsPolicy: false });
    const page = renderPage();
    await page.confirmAdult();
    expect(await screen.findByText(pl.ageAttestation.saveError)).toBeInTheDocument();
    expect(page.toggle()).toBeDisabled();
  });

  it('18+ przy niekompletnym profilu: przełącznik nadal wyłączony (wymaga onboardingu)', async () => {
    vi.mocked(attestCandidateAgeAction).mockResolvedValue({ ok: true, meetsPolicy: true });
    const page = renderPage(INCOMPLETE);
    await page.confirmAdult();
    expect(await screen.findByText(pl.ageAttestation.saved)).toBeInTheDocument();
    expect(page.toggle()).toBeDisabled();
    expect(screen.queryByTestId('profile-visibility-adult-only')).toBeNull();
    expect(screen.getByRole('link', { name: pl.profileVisibility.completeProfile })).toBeInTheDocument();
  });

  it('kontrola ujemna: bez wspólnego stanu (sam prop z odczytu strony) przełącznik zostaje wyłączony', async () => {
    vi.mocked(attestCandidateAgeAction).mockResolvedValue({ ok: true, meetsPolicy: true });
    const page = renderPage(COMPLETE, false);
    await page.confirmAdult();
    expect(await screen.findByText(pl.ageAttestation.saved)).toBeInTheDocument();
    expect(page.toggle()).toBeDisabled();
    expect(screen.getByTestId('profile-visibility-adult-only')).toBeInTheDocument();
  });
});
