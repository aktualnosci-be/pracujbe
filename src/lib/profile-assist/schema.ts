import { CV_EXTRACTION_JSON_SCHEMA } from '@/lib/cv-import/proposals';

/**
 * Structured output asystenta profilu (#37): te same pola profilu zawodowego co import CV
 * (zawody, umiejętności, języki, certyfikaty, lata doświadczenia — każda pozycja ze źródłem
 * i niepewnością), bez pól na imię, kontakt, dane osobowe czy ocenę osoby. Zamiast `isCv`
 * jest `aboutWork` (czy odpowiedzi w ogóle dotyczą pracy). Walidacja odpowiedzi:
 * `mapCvExtraction` (te same limity, filtry i dopasowanie źródła do wysłanego tekstu).
 */
const { isCv: _isCv, ...cvProperties } = CV_EXTRACTION_JSON_SCHEMA.properties;
void _isCv;

export const PROFILE_ASSIST_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['aboutWork', 'suspiciousInstructions', 'occupations', 'skills', 'languages', 'certificates', 'experienceYears'],
  properties: {
    aboutWork: { type: 'boolean', description: 'true only if the answers describe the person’s own work, skills, languages or certificates.' },
    ...cvProperties,
  },
} as const;
