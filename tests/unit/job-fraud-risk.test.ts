import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  JOB_FRAUD_CATEGORIES,
  JOB_FRAUD_PATTERNS,
  jobFraudRisk,
  type JobFraudCategory,
} from '@/lib/job-trust/fraud-risk';

/**
 * 0167 — sygnały oszustwa w treści oferty. Decyzja jest w bazie (`job_fraud_patterns`,
 * `job_fraud_risk`); tu: zachowanie wzorców w 4 językach, brak fałszywych trafień na typowe
 * warunki pracy i zgodność TS ↔ SQL (te same wzorce, ta sama kolejność).
 */

const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/0167_offer_trust.sql'), 'utf8');

const FLAGGED: readonly (readonly [JobFraudCategory, string])[] = [
  // opłaty od kandydata
  ['candidate_fee', 'Przed rozpoczęciem pracy wpłać kaucję 200 EUR.'],
  ['candidate_fee', 'Opłata za szkolenie BHP wynosi 50 EUR.'],
  ['candidate_fee', 'Koszty rekrutacyjne pokrywa kandydat: 100 zł wpisowe.'],
  ['candidate_fee', 'Kaucja za mieszkanie płatna z góry.'],
  ['candidate_fee', 'A small registration fee is required before you start.'],
  ['candidate_fee', 'Upfront payment for the accommodation.'],
  ['candidate_fee', 'Deposit for the room: 300 EUR.'],
  ['candidate_fee', 'Inschrijvingskosten: 75 euro.'],
  ['candidate_fee', 'Je moet vooraf betalen voor de huisvesting.'],
  ['candidate_fee', 'Waarborg voor de kamer: 400 euro.'],
  ['candidate_fee', 'Frais de dossier : 50 €.'],
  ['candidate_fee', 'Caution pour le logement à payer avant de commencer.'],
  ['candidate_fee', 'Vous devez verser un acompte.'],
  // kontakt poza portalem
  ['off_platform_contact', 'Kontakt wyłącznie przez WhatsApp.'],
  ['off_platform_contact', 'Napisz na Telegram: @rekruter'],
  ['off_platform_contact', 'Stuur een bericht via Whats App.'],
  ['off_platform_contact', 'Contactez-nous sur Viber.'],
  ['off_platform_contact', 'Write to us: https://wa.me/32470000000'],
  // krypto / zadania online
  ['crypto_tasks', 'Wynagrodzenie w kryptowalutach.'],
  ['crypto_tasks', 'Proste zadania online, płatne w USDT.'],
  ['crypto_tasks', 'Verdien geld met online opdrachten.'],
  ['crypto_tasks', 'Tâches en ligne rémunérées.'],
  ['crypto_tasks', 'Earn money liking videos from home.'],
  // prośby o płatność / dane karty
  ['payment_request', 'Prześlij pieniądze przez Western Union.'],
  ['payment_request', 'Podaj numer karty i kod CVV.'],
  ['payment_request', 'Wyślij kod BLIK na numer rekrutera.'],
  ['payment_request', 'Send us the money for the visa.'],
  ['payment_request', 'Stuur je kaartgegevens.'],
  ['payment_request', 'Effectuer un virement de 100 €.'],
  ['payment_request', 'Pay with a gift card.'],
];

const NOT_FLAGGED: readonly string[] = [
  // PL
  'Wynagrodzenie wypłacane przelewem co tydzień.',
  'Zwrot kosztów dojazdu i możliwość zaliczek na wynagrodzenie.',
  'Zakwaterowanie 80 EUR tygodniowo, potrącane z wypłaty.',
  'Szkolenie BHP zapewnia pracodawca.',
  'Kontakt przez formularz na portalu.',
  'Wymagany certyfikat VCA i prawo jazdy kat. B.',
  'Praca na zmiany, transport do pracy zapewniony.',
  'Bez opłat — koszty szkolenia pokrywa firma.',
  // NL
  'Loon wordt wekelijks op je rekening gestort.',
  'Opleiding betaald door de werkgever. Eigen vervoer is een plus.',
  'Huisvesting mogelijk, kosten worden van het loon afgehouden.',
  // FR
  'Formation payée, salaire versé par virement bancaire chaque semaine.',
  'Remboursement des frais de déplacement.',
  'Logement proposé, loyer retenu sur le salaire.',
  // EN
  'Salary paid by bank transfer every week.',
  'Signal the forklift operator before moving pallets.',
  'Travel costs are reimbursed. Training provided.',
  'We offer a sign-on bonus after three months.',
];

describe('job fraud risk — trafienia (0167)', () => {
  it.each(FLAGGED)('%s: %s', (category, text) => {
    expect(jobFraudRisk([text])).toContain(category);
  });

  it('każda kategoria ma przykład w teście', () => {
    const covered = new Set(FLAGGED.map(([category]) => category));
    expect([...covered].sort()).toEqual([...JOB_FRAUD_CATEGORIES].sort());
  });

  it('kilka pól i kategorii — posortowane, bez powtórzeń', () => {
    expect(
      jobFraudRisk(['Magazynier', 'Kontakt przez WhatsApp', null, '', 'Opłata za szkolenie 50 EUR', 'WhatsApp']),
    ).toEqual(['candidate_fee', 'off_platform_contact']);
  });
});

describe('job fraud risk — kontrola ujemna (typowe warunki pracy)', () => {
  it.each(NOT_FLAGGED)('%s', (text) => {
    expect(jobFraudRisk([text])).toEqual([]);
  });

  it('puste pola → brak kategorii', () => {
    expect(jobFraudRisk([])).toEqual([]);
    expect(jobFraudRisk(['  ', undefined])).toEqual([]);
  });
});

describe('zgodność z migracją 0167', () => {
  it('te same wzorce co job_fraud_patterns (kolejność i treść)', () => {
    const block = MIGRATION.split('-- fraud-patterns:begin')[1]?.split('-- fraud-patterns:end')[0];
    expect(block).toBeDefined();
    const fromSql = [...(block ?? '').matchAll(/\('([a-z_]+)', '([^']*)'\)/g)].map((m) => [m[1], m[2]]);
    expect(fromSql).toEqual(JOB_FRAUD_PATTERNS.map(([c, p]) => [c, p]));
  });

  it('kategorie w CHECK tabeli = lista w TS', () => {
    expect(MIGRATION).toContain(
      `rule_categories <@ array[${JOB_FRAUD_CATEGORIES.map((c) => `'${c}'`).join(', ')}]::text[]`,
    );
  });

  it('każdy wzorzec kompiluje się i używa tylko składni wspólnej z PostgreSQL ARE', () => {
    for (const [, pattern] of JOB_FRAUD_PATTERNS) {
      expect(() => new RegExp(pattern)).not.toThrow();
      expect(pattern).not.toMatch(/[\\']/);
      expect(pattern).toMatch(/^[a-z0-9 ()|?*+[\]{},-]+$/);
    }
  });

  it('kontrola ujemna: wzorzec bez granicy słowa trafiałby w typowy tekst', () => {
    // Bez spacji granicznej „ t me ” trafiałoby w każde „…t me…” („at meeting”).
    expect(new RegExp('t me').test(' at meeting ')).toBe(true);
    expect(jobFraudRisk(['Daily stand-up at meeting room 2'])).toEqual([]);
  });
});
