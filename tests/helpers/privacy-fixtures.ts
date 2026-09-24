import { expect } from 'vitest';

/** Syntetyczne dane osobowe do testów redakcji (#502). */
export const PII = {
  email: 'jan.kowalski+cv@example.be',
  phoneIntl: '+32 470 12 34 56',
  phoneNational: '0470/12.34.56',
  niss: '85.07.30-033.28',
  nissPlain: '85073003328',
  iban: 'BE68 5390 0754 7034',
  cvFile: 'Jan_Kowalski_CV_2026.pdf',
  token: 'k7Qm2xZ9pL4vR8tY1wN6bC3dF5gH0jKsA2eU',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlLXZhbHVl',
  messageBody: 'Dzień dobry, mieszkam przy Rue Haute 12 i szukam pracy',
  bio: 'Pracowałem 5 lat na magazynie w Antwerpii',
  firstName: 'Janina',
  lastName: 'Wiśniewska',
} as const;

export const UUID = '3f1c2b9a-7d4e-4c1a-9b2f-0e6d5a8c7b10';

export function expectNoPii(payload: string): void {
  for (const [key, value] of Object.entries(PII)) {
    expect(payload, `wyciek: ${key}`).not.toContain(value);
  }
}
