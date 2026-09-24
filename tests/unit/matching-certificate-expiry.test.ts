import { describe, expect, it } from 'vitest';

import { isCertificateValid, scoreMatch, type CertificateEntry, type MatchCandidate, type MatchJob } from '@/lib/matching/score';
import { referenceDate } from '@/lib/matching/reference-date';
import { step5Schema } from '@/lib/validation/candidate';

/**
 * #96: wygasły certyfikat kandydata nie spełnia wymagania oferty. Stała data odniesienia
 * (`today`) — wynik nie zależy od zegara maszyny.
 */
const TODAY = '2026-09-24';
const YESTERDAY = '2026-09-23';
const TOMORROW = '2026-09-25';

function candidate(certificates: CertificateEntry[]): MatchCandidate {
  return { occupations: [], categories: [], skills: [], languages: [], certificates, preferredContractTypes: [] };
}

const JOB: MatchJob = { skills: [], requiredLanguages: [], requiredCertificates: ['VCA'] };

function scoreWith(certificates: CertificateEntry[]) {
  return scoreMatch(candidate(certificates), JOB, { today: TODAY });
}

describe('scoreMatch — ważność certyfikatów (#96)', () => {
  // Bazowo bez certyfikatu: wszystkie inne kryteria bez wymagań.
  const without = scoreWith([]);

  it.each([
    ['brak daty (bezterminowy)', null, true],
    ['wygasa jutro', TOMORROW, true],
    ['wygasa dziś (ważny do końca dnia)', TODAY, true],
    ['wygasł wczoraj', YESTERDAY, false],
  ] as const)('%s', (_name, expiresAt, counts) => {
    const result = scoreWith([{ label: 'vca', expiresAt }]);
    if (counts) {
      expect(result.score).toBe(without.score + 5);
      expect(result.matched).toContain('VCA');
      expect(result.expiredCertificates).toEqual([]);
    } else {
      expect(result.score).toBe(without.score);
      expect(result.matched).not.toContain('VCA');
      // Wyjaśnienie: osobna pozycja „wygasł", nie „brak certyfikatu".
      expect(result.expiredCertificates).toEqual(['VCA']);
      expect(result.missing).not.toContain('VCA');
    }
  });

  it('kontrola ujemna: sama etykieta (dawny odczyt bez expires_at) podnosiła wynik wygasłym certyfikatem', () => {
    const labelOnly = scoreWith(['VCA']);
    const withExpiry = scoreWith([{ label: 'VCA', expiresAt: YESTERDAY }]);
    expect(labelOnly.score - withExpiry.score).toBe(5);
  });

  it('ważny duplikat etykiety wygrywa z wygasłym', () => {
    const result = scoreWith([
      { label: 'VCA', expiresAt: YESTERDAY },
      { label: 'VCA', expiresAt: TOMORROW },
    ]);
    expect(result.matched).toContain('VCA');
    expect(result.expiredCertificates).toEqual([]);
  });

  it('wygasły certyfikat, którego oferta nie wymaga, nie jest raportowany', () => {
    const result = scoreMatch(
      candidate([{ label: 'ADR', expiresAt: YESTERDAY }]),
      { skills: [], requiredLanguages: [] },
      { today: TODAY },
    );
    expect(result.expiredCertificates).toEqual([]);
  });

  it('isCertificateValid przyjmuje też pełny znacznik czasu', () => {
    expect(isCertificateValid({ label: 'x', expiresAt: `${YESTERDAY}T23:59:59Z` }, TODAY)).toBe(false);
    expect(isCertificateValid('x', TODAY)).toBe(true);
  });
});

describe('referenceDate — granica dnia w Belgii', () => {
  it('liczy dzień w strefie Europe/Brussels, nie UTC', () => {
    // 22:30 UTC 23.09 = 00:30 CEST 24.09.
    expect(referenceDate(new Date('2026-09-23T22:30:00Z'))).toBe('2026-09-24');
    expect(referenceDate(new Date('2026-09-23T21:30:00Z'))).toBe('2026-09-23');
  });
});

describe('step5Schema — data ważności certyfikatu', () => {
  it('przyjmuje datę kalendarzową i brak daty', () => {
    const ok = step5Schema.safeParse({ certificates: ['VCA', 'ADR'], certificateExpiry: { VCA: TODAY } });
    expect(ok.success).toBe(true);
    expect(step5Schema.parse({ certificates: ['VCA'] }).certificateExpiry).toEqual({});
  });

  it.each(['2026-02-30', '24-09-2026', 'jutro'])('odrzuca %s', (date) => {
    const bad = step5Schema.safeParse({ certificates: ['VCA'], certificateExpiry: { VCA: date } });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe('candidate.error.certificateExpiryInvalid');
  });
});
