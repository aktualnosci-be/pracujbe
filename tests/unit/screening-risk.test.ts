import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SCREENING_FOLD_FROM,
  SCREENING_FOLD_TO,
  SCREENING_RISK_CATEGORIES,
  SCREENING_RISK_PATTERNS,
  foldScreeningText,
  screeningQuestionRisk,
  screeningTextRisk,
  type ScreeningRiskCategory,
} from '@/lib/screening/risk';

/**
 * #497 — detektor pytań screeningowych wymagających przeglądu przed publikacją.
 * Decyzja jest w bazie (migracja 0099); tu: zachowanie wzorców, brak fałszywych trafień
 * na typowe pytania o warunki pracy i zgodność TS ↔ SQL (te same wzorce i składanie znaków).
 */

const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase/migrations/0099_screening_question_review.sql'),
  'utf8',
);

const FLAGGED: readonly (readonly [ScreeningRiskCategory, string])[] = [
  // wiek / data urodzenia
  ['age', 'Ile masz lat?'],
  ['age', 'Podaj datę urodzenia'],
  ['age', 'W którym roku się urodziłeś?'],
  ['age', 'How old are you?'],
  ['age', 'What is your date of birth?'],
  ['age', 'Wat is je leeftijd?'],
  ['age', 'Geboortedatum'],
  ['age', 'Quel âge avez-vous ?'],
  ['age', 'Date de naissance'],
  // płeć
  ['sex', 'Płeć'],
  ['sex', 'Jesteś kobietą czy mężczyzną?'],
  ['sex', 'What is your gender?'],
  ['sex', 'Ben je een man of vrouw?'],
  ['sex', 'Êtes-vous un homme ou une femme ?'],
  // ciąża / plany rodzinne
  ['family', 'Czy jesteś w ciąży?'],
  ['family', 'Czy planujesz mieć dzieci?'],
  ['family', 'Czy masz dzieci?'],
  ['family', 'Are you pregnant?'],
  ['family', 'Do you plan to have children?'],
  ['family', 'Ben je zwanger?'],
  ['family', 'Heb je kinderen?'],
  ['family', 'Êtes-vous enceinte ?'],
  ['family', 'Avez-vous des enfants ?'],
  // stan cywilny
  ['marital', 'Stan cywilny'],
  ['marital', 'Czy jesteś żonaty?'],
  ['marital', 'Are you married?'],
  ['marital', 'Wat is je burgerlijke staat?'],
  ['marital', 'État civil'],
  // religia
  ['religion', 'Jakie jest Twoje wyznanie?'],
  ['religion', 'Czy jesteś osobą wierzącą?'],
  ['religion', 'What is your religion?'],
  ['religion', 'Draag je een hoofddoek?'],
  ['religion', 'Quelle est votre religion ?'],
  // pochodzenie
  ['origin', 'Jakiej jesteś narodowości?'],
  ['origin', 'Skąd pochodzisz?'],
  ['origin', 'What is your nationality?'],
  ['origin', 'Wat is je afkomst?'],
  ['origin', "D'où venez-vous ?"],
  ['origin', 'Pays de naissance'],
  // zdrowie
  ['health', 'Czy masz problemy ze zdrowiem?'],
  ['health', 'Czy chorujesz przewlekle?'],
  ['health', 'Czy masz orzeczenie o niepełnosprawności?'],
  ['health', 'Do you have any disability?'],
  ['health', 'Do you have a medical condition?'],
  ['health', 'Heb je een chronische ziekte?'],
  ['health', 'Avez-vous une maladie ?'],
  ['health', 'Quel est votre état de santé ?'],
  // orientacja
  ['orientation', 'Jaka jest Twoja orientacja seksualna?'],
  ['orientation', 'What is your sexual orientation?'],
  ['orientation', 'Seksuele geaardheid'],
  ['orientation', 'Orientation sexuelle'],
  // związki zawodowe
  ['union', 'Czy należysz do związku zawodowego?'],
  ['union', 'Are you a trade union member?'],
  ['union', 'Ben je lid van een vakbond?'],
  ['union', 'Êtes-vous syndiqué ?'],
  // poglądy polityczne
  ['political', 'Jakie masz poglądy polityczne?'],
  ['political', 'What are your political views?'],
  ['political', 'Wat is je politieke voorkeur?'],
  ['political', 'Opinions politiques'],
  // karalność
  ['criminal', 'Czy byłeś karany?'],
  ['criminal', 'Czy masz zaświadczenie o niekaralności?'],
  ['criminal', 'Do you have a criminal record?'],
  ['criminal', 'Heb je een blanco strafblad?'],
  ['criminal', 'Avez-vous un casier judiciaire ?'],
];

/** Typowe pytania o realne warunki pracy — nie mogą trafiać do przeglądu. */
const NOT_FLAGGED: readonly string[] = [
  // PL
  'Czy masz prawo jazdy kat. C+E?',
  'Ile lat doświadczenia masz na wózku widłowym?',
  'Od kiedy możesz zacząć pracę?',
  'Czy masz certyfikat VCA?',
  'Czy możesz pracować na zmiany nocne?',
  'Jak dojedziesz do pracy?',
  'Czy mówisz po niderlandzku?',
  'Jaki jest Twój poziom języka francuskiego?',
  'Czy masz własny samochód?',
  'Czy masz doświadczenie w opiece nad dziećmi?',
  'Czy masz dobrą orientację w terenie?',
  'W związku z pracą w chłodni: czy możesz pracować w niskich temperaturach?',
  'Czy masz aktualne badania lekarskie kierowcy?',
  'Czy masz doświadczenie w większym magazynie?',
  'Czy możesz podnosić ciężary do 25 kg?',
  'Czy masz kartę kierowcy do tachografu?',
  'Doświadczenie z tachografem?',
  'Czy masz uprawnienia UDT na wózki widłowe?',
  'Czy znasz zasady BHP?',
  'Czy masz pozwolenie na pracę w Belgii?',
  'Czy możesz pracować w weekendy?',
  'Czy masz doświadczenie w gastronomii?',
  // EN
  'Do you have a valid driving licence?',
  'How many years of experience do you have?',
  'When can you start?',
  'Do you have a VCA certificate?',
  'Are you available for night shifts?',
  'Do you speak Dutch?',
  'Do you have health and safety training?',
  'Do you have experience in health care?',
  'Can you lift heavy loads?',
  'Do you have a work permit for Belgium?',
  'Do you have your own transport?',
  'Have you worked with children before?',
  'Are you willing to work overtime?',
  // NL
  'Heb je een rijbewijs C?',
  'Hoeveel jaar ervaring heb je?',
  'Wanneer kun je beginnen?',
  'Heb je een VCA-attest?',
  'Spreek je Nederlands of Frans?',
  'Ben je beschikbaar in het weekend?',
  'Heb je eigen vervoer?',
  'Kun je in ploegen werken?',
  'Heb je ervaring met kinderopvang?',
  // FR
  'Avez-vous le permis B ?',
  "Combien d'années d'expérience avez-vous ?",
  'Quand pouvez-vous commencer ?',
  'Avez-vous le certificat VCA ?',
  'Parlez-vous néerlandais ?',
  'Êtes-vous disponible le week-end ?',
  'Avez-vous une formation en santé et sécurité ?',
  'Avez-vous déjà travaillé comme femme de ménage ?',
  'Quel genre de poste recherchez-vous ?',
  'Acceptez-vous notre politique de confidentialité ?',
  'Avez-vous un moyen de transport ?',
  'Pouvez-vous travailler de nuit ?',
];

describe('screening risk — trafienia (#497)', () => {
  it.each(FLAGGED)('%s: %s', (category, text) => {
    expect(screeningTextRisk(text)).toContain(category);
  });

  it('każda kategoria ma przykład w teście', () => {
    const covered = new Set(FLAGGED.map(([category]) => category));
    expect([...covered].sort()).toEqual([...SCREENING_RISK_CATEGORIES].sort());
  });
});

describe('screening risk — kontrola ujemna (typowe pytania, #497)', () => {
  it.each(NOT_FLAGGED)('%s', (text) => {
    expect(screeningTextRisk(text)).toEqual([]);
  });
});

describe('screening risk — pytanie z opcjami i tłumaczeniami (#497)', () => {
  it('neutralna treść, ryzykowna opcja → pytanie oznaczone', () => {
    expect(
      screeningQuestionRisk({
        prompt: { pl: 'Który przedział dotyczy Ciebie?' },
        options: [{ label: { pl: 'Do 30 lat' } }, { label: { pl: 'W ciąży', nl: 'Zwanger' } }],
      }),
    ).toEqual(['family']);
  });

  it('neutralna treść w języku oferty, ryzykowne tłumaczenie → pytanie oznaczone', () => {
    expect(
      screeningQuestionRisk({
        prompt: { pl: 'Czy możesz zacząć od zaraz?', fr: 'Quelle est votre date de naissance ?' },
      }),
    ).toEqual(['age']);
  });

  it('ryzykowne tłumaczenie opcji → pytanie oznaczone', () => {
    expect(
      screeningQuestionRisk({
        prompt: { pl: 'Wybierz odpowiedź' },
        options: [{ label: { pl: 'Tak', en: 'I am a trade union member' } }, { label: { pl: 'Nie' } }],
      }),
    ).toEqual(['union']);
  });

  it('kilka kategorii — posortowane, bez powtórzeń', () => {
    expect(
      screeningQuestionRisk({ prompt: { en: 'Your age and nationality? Your age again.' } }),
    ).toEqual(['age', 'origin']);
  });

  it('pytanie neutralne w każdym języku i opcji → brak kategorii', () => {
    expect(
      screeningQuestionRisk({
        prompt: { pl: 'Jak dojedziesz?', nl: 'Hoe kom je naar het werk?', fr: 'Comment venez-vous ?' },
        options: [{ label: { pl: 'Własny samochód', nl: 'Eigen auto' } }, { label: { pl: 'Komunikacja' } }],
      }),
    ).toEqual([]);
  });
});

describe('foldScreeningText', () => {
  it('diakrytyki PL/FR, œ/ß, interpunkcja → ASCII ze spacjami granicznymi', () => {
    expect(foldScreeningText('Żółć — ĄĘ? Œuvre, Straße; ÉTÉ!')).toBe(' zolc ae oeuvre strasse ete ');
  });
});

describe('zgodność z migracją 0099', () => {
  it('te same znaki składania co screening_fold', () => {
    expect(MIGRATION).toContain(`'${SCREENING_FOLD_FROM}'`);
    expect(MIGRATION).toContain(`'${SCREENING_FOLD_TO}'`);
    expect(Array.from(SCREENING_FOLD_FROM)).toHaveLength(SCREENING_FOLD_TO.length);
  });

  it('te same wzorce co screening_risk_patterns (kolejność i treść)', () => {
    const block = MIGRATION.split('-- risk-patterns:begin')[1]?.split('-- risk-patterns:end')[0];
    expect(block).toBeDefined();
    const fromSql = [...(block ?? '').matchAll(/\('([a-z]+)', '([^']*)'\)/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(fromSql).toEqual(SCREENING_RISK_PATTERNS.map(([c, p]) => [c, p]));
  });

  it('kategorie w CHECK tabeli = lista w TS', () => {
    for (const category of SCREENING_RISK_CATEGORIES) {
      expect(MIGRATION).toContain(`'${category}'`);
    }
  });

  it('każdy wzorzec kompiluje się i używa tylko składni wspólnej z PostgreSQL ARE', () => {
    for (const [, pattern] of SCREENING_RISK_PATTERNS) {
      expect(() => new RegExp(pattern)).not.toThrow();
      // Bez sekwencji z backslashem (różnice \b/\m między JS i ARE) i bez apostrofów (literał SQL).
      expect(pattern).not.toMatch(/[\\']/);
      expect(pattern).toMatch(/^[a-z0-9 ()|?*[\]!-]+$/);
    }
  });
});
