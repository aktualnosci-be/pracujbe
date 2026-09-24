import type { ScreeningQuestion } from '@/lib/screening/questions';

/**
 * Pytania screeningowe oferty fikcyjnej na serwerze fixture E2E
 * (`playwright.applications-fixture.config.ts`, tryb `full`; oferta 1003). Wołane wyłącznie
 * z gałęzi fixture w `@/lib/jobs` — w buildzie produkcyjnym pytania pochodzą z bazy.
 */
const FIXTURE_JOB_ID = '1003';

const QUESTIONS: ScreeningQuestion[] = [
  {
    id: 'f1010000-0000-4000-8000-000000000001',
    position: 0,
    type: 'yes_no',
    required: true,
    prompt: {
      pl: 'Czy masz prawo jazdy kat. C+E?',
      nl: 'Heb je een rijbewijs C+E?',
      fr: 'Avez-vous le permis C+E ?',
      en: 'Do you hold a C+E driving licence?',
    },
    options: [],
  },
  {
    id: 'f1010000-0000-4000-8000-000000000002',
    position: 1,
    type: 'single_choice',
    required: true,
    prompt: { pl: 'Jak dojedziesz do pracy?', en: 'How will you get to work?' },
    options: [
      { id: 'o1', label: { pl: 'Własnym samochodem', en: 'Own car' } },
      { id: 'o2', label: { pl: 'Komunikacją publiczną', en: 'Public transport' } },
    ],
  },
  {
    id: 'f1010000-0000-4000-8000-000000000003',
    position: 2,
    type: 'date',
    required: false,
    prompt: { pl: 'Od kiedy możesz zacząć?', en: 'When can you start?' },
    options: [],
  },
  {
    id: 'f1010000-0000-4000-8000-000000000004',
    position: 3,
    type: 'short_text',
    required: false,
    prompt: { pl: 'Doświadczenie z tachografem cyfrowym', en: 'Experience with a digital tachograph' },
    options: [],
  },
];

export function fixtureScreeningQuestions(jobId: string): ScreeningQuestion[] {
  return jobId === FIXTURE_JOB_ID ? QUESTIONS : [];
}
