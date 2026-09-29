import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CompanyViesCheck } from '@/components/admin/CompanyViesCheck';
import { parseViesAutoRetry, VIES_AUTO_MAX_ATTEMPTS, type ViesAutoRetry } from '@/lib/vies/state';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * #706 (0976): admin widzi, że automatyczne sprawdzenie VIES czeka na ponowienie po chwilowej
 * niedostępności usługi albo wyczerpało próby. Kontrole ujemne: zadanie dla innego numeru
 * i wiersz bez terminu nie są pokazywane; zapisany wynik rozstrzygający ukrywa informację.
 */

vi.mock('@/lib/actions/admin', () => ({ checkCompanyVies: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const VAT = '0417497106';

describe('parseViesAutoRetry', () => {
  it('zadanie dla bieżącego numeru: próby, termin, ostatni wynik', () => {
    expect(
      parseViesAutoRetry(
        { vat_number: VAT, attempts: 2, next_attempt_at: '2026-09-29T10:00:00Z', last_outcome: 'rate_limited' },
        VAT,
      ),
    ).toEqual({
      attempts: 2,
      maxAttempts: VIES_AUTO_MAX_ATTEMPTS,
      nextAttemptAt: '2026-09-29T10:00:00Z',
      lastOutcome: 'rate_limited',
      exhausted: false,
    });
  });

  it('wyczerpane próby', () => {
    expect(
      parseViesAutoRetry(
        { vat_number: VAT, attempts: VIES_AUTO_MAX_ATTEMPTS, next_attempt_at: new Date('2026-09-29T10:00:00Z'), last_outcome: 'unavailable' },
        VAT,
      )?.exhausted,
    ).toBe(true);
  });

  it('kontrola ujemna: inny numer, brak wiersza, zły termin, nieznany wynik', () => {
    expect(parseViesAutoRetry({ vat_number: '0403170701', attempts: 1, next_attempt_at: 'x' }, VAT)).toBeNull();
    expect(parseViesAutoRetry(null, VAT)).toBeNull();
    expect(parseViesAutoRetry({ vat_number: VAT, attempts: 1, next_attempt_at: null }, VAT)).toBeNull();
    expect(parseViesAutoRetry({ vat_number: VAT, attempts: 1, next_attempt_at: 'x', last_outcome: 'weird' }, VAT)?.lastOutcome).toBeNull();
  });
});

afterEach(cleanup);

const retry = (over: Partial<ViesAutoRetry> = {}): ViesAutoRetry => ({
  attempts: 1,
  maxAttempts: VIES_AUTO_MAX_ATTEMPTS,
  nextAttemptAt: '2026-09-29T10:00:00Z',
  lastOutcome: 'unavailable',
  exhausted: false,
  ...over,
});

for (const [locale, messages] of Object.entries({ pl, nl, fr, en })) {
  const view = (autoRetry: ViesAutoRetry | null, kind: 'not_checked' | 'valid' = 'not_checked') =>
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <CompanyViesCheck
          companyId="c1"
          initial={
            kind === 'valid'
              ? { kind: 'valid', vatNumber: VAT, checkedAt: '2026-09-28T10:00:00Z', viesName: 'NV', nameMatch: 'match' }
              : { kind: 'not_checked', vatNumber: VAT }
          }
          autoRetry={autoRetry}
        />
      </NextIntlClientProvider>,
    );

  describe(`CompanyViesCheck — kolejka automatyczna (${locale})`, () => {
    it('ponowienie zaplanowane: liczba prób i limit', () => {
      view(retry({ attempts: 3 }));
      const text = screen.getByTestId('vies-auto-retry').textContent ?? '';
      expect(text).toContain('3');
      expect(text).toContain(String(VIES_AUTO_MAX_ATTEMPTS));
    });

    it('wyczerpane próby: prośba o ręczne sprawdzenie', () => {
      view(retry({ attempts: VIES_AUTO_MAX_ATTEMPTS, exhausted: true }));
      expect(screen.getByTestId('vies-auto-retry').textContent).toBe(
        messages.admin.viesAutoExhausted.replace('{max}', String(VIES_AUTO_MAX_ATTEMPTS)),
      );
    });

    it('w kolejce bez nieudanej próby', () => {
      view(retry({ attempts: 0, lastOutcome: null }));
      expect(screen.getByTestId('vies-auto-retry').textContent).toBe(messages.admin.viesAutoQueued);
    });

    it('kontrola ujemna: bez zadania i przy zapisanym wyniku — brak informacji', () => {
      view(null);
      expect(screen.queryByTestId('vies-auto-retry')).toBeNull();
      cleanup();
      view(retry(), 'valid');
      expect(screen.queryByTestId('vies-auto-retry')).toBeNull();
    });
  });
}
