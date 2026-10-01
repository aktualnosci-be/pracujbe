import { describe, expect, it } from 'vitest';
import {
  QUALIFICATIONS_DISPLAY_LIMIT,
  jobQualificationsJsonLd,
  parseJobQualifications,
} from '@/lib/job-qualifications';

/**
 * #866 (decyzja 01.10.2026): umiejętności i certyfikaty oferty na publicznym szczególe —
 * parser wierszy `getPublicJobQualifications` i pola JobPosting.
 */
describe('parseJobQualifications', () => {
  it('dzieli umiejętności na wymagane i mile widziane, nazwa słownika ma pierwszeństwo', () => {
    expect(
      parseJobQualifications(
        [
          { skill_label: 'Heftruck', is_mandatory: true, localized_label: 'Obsługa wózka widłowego' },
          { skill_label: 'Orderpicking', is_mandatory: false, localized_label: null },
        ],
        [{ certificate_label: 'VCA Basis' }],
      ),
    ).toEqual({
      skillsMandatory: [{ label: 'Obsługa wózka widłowego', localized: true }],
      skillsOptional: [{ label: 'Orderpicking', localized: false }],
      certificates: [{ label: 'VCA Basis', localized: false }],
    });
  });

  it('brak pozycji = brak sekcji (undefined), także po odrzuceniu złych wierszy', () => {
    expect(parseJobQualifications([], [])).toBeUndefined();
    expect(
      parseJobQualifications(
        [{ skill_label: '   ', is_mandatory: true }, { skill_label: 42 }, null, 'x'],
        [{ certificate_label: '' }, { certificate_label: 'a'.repeat(161) }],
      ),
    ).toBeUndefined();
  });

  it('ta sama nazwa raz (bez wielkości liter i spacji); wymagana wygrywa z mile widzianą', () => {
    const result = parseJobQualifications(
      [
        { skill_label: 'vca  basis', is_mandatory: false },
        { skill_label: 'Spawanie', is_mandatory: false },
        { skill_label: 'Spawanie', is_mandatory: true },
      ],
      [{ certificate_label: 'VCA' }, { certificate_label: 'vca' }],
    );
    expect(result?.skillsMandatory).toEqual([{ label: 'Spawanie', localized: false }]);
    expect(result?.skillsOptional).toEqual([{ label: 'vca basis', localized: false }]);
    expect(result?.certificates).toEqual([{ label: 'VCA', localized: false }]);
  });

  it('zbyt długa umiejętność (ponad limit kreatora 120) nie trafia na stronę', () => {
    expect(parseJobQualifications([{ skill_label: 'a'.repeat(121), is_mandatory: true }], [])).toBeUndefined();
    expect(parseJobQualifications([{ skill_label: 'a'.repeat(120), is_mandatory: true }], [])?.skillsMandatory).toHaveLength(1);
  });

  it(`najwyżej ${QUALIFICATIONS_DISPLAY_LIMIT} pozycji każdego rodzaju`, () => {
    const rows = Array.from({ length: QUALIFICATIONS_DISPLAY_LIMIT + 5 }, (_, i) => ({ certificate_label: `C${i}` }));
    expect(parseJobQualifications([], rows)?.certificates).toHaveLength(QUALIFICATIONS_DISPLAY_LIMIT);
  });
});

describe('jobQualificationsJsonLd', () => {
  it('skills = lista nazw (Text), qualifications = EducationalOccupationalCredential', () => {
    expect(
      jobQualificationsJsonLd({
        skillsMandatory: [{ label: 'Spawanie MIG', localized: false }],
        skillsOptional: [{ label: 'Czytanie rysunku', localized: true }],
        certificates: [{ label: 'VCA Basis', localized: false }],
      }),
    ).toEqual({
      skills: 'Spawanie MIG, Czytanie rysunku',
      qualifications: [
        { '@type': 'EducationalOccupationalCredential', credentialCategory: 'certificate', name: 'VCA Basis' },
      ],
    });
  });

  it('kontrola ujemna: brak kwalifikacji albo pusta grupa = brak pól (nie puste wartości)', () => {
    expect(jobQualificationsJsonLd(undefined)).toEqual({});
    expect(
      jobQualificationsJsonLd({
        skillsMandatory: [],
        skillsOptional: [],
        certificates: [{ label: 'VCA', localized: false }],
      }),
    ).not.toHaveProperty('skills');
  });
});
