import { z } from 'zod';

/**
 * Kształt odpowiedzi modelu wyjaśniającego ofertę (#773). Schemat `strict` dla structured
 * output + parser Zod po stronie serwera (odpowiedź jest niezaufana tak samo jak treść oferty).
 */

export const EXPLAIN_TOPICS = [
  'pay',
  'contract',
  'schedule',
  'location',
  'transport',
  'accommodation',
  'requirements',
  'language',
  'start',
  'costs',
  'other',
] as const;
export type ExplainTopic = (typeof EXPLAIN_TOPICS)[number];

export const EXPLAIN_GAP_KINDS = ['missing', 'contradictory', 'ambiguous'] as const;
export type ExplainGapKind = (typeof EXPLAIN_GAP_KINDS)[number];

export const EXPLAIN_LIMITS = {
  items: 12,
  gaps: 8,
  explanation: 600,
  note: 400,
  sourceIds: 6,
} as const;

export const EXPLAIN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suspiciousInstructions', 'items', 'gaps'],
  properties: {
    suspiciousInstructions: { type: 'boolean' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'explanation', 'sourceIds'],
        properties: {
          topic: { type: 'string', enum: [...EXPLAIN_TOPICS] },
          explanation: { type: 'string' },
          sourceIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'kind', 'note', 'sourceIds'],
        properties: {
          topic: { type: 'string', enum: [...EXPLAIN_TOPICS] },
          kind: { type: 'string', enum: [...EXPLAIN_GAP_KINDS] },
          note: { type: 'string' },
          sourceIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

const sourceIds = z.array(z.string().regex(/^S\d{1,3}$/)).max(EXPLAIN_LIMITS.sourceIds);
const clean = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1).max(max));

export const explainResponseSchema = z.object({
  suspiciousInstructions: z.boolean(),
  items: z
    .array(z.object({ topic: z.enum(EXPLAIN_TOPICS), explanation: clean(EXPLAIN_LIMITS.explanation), sourceIds }))
    .max(EXPLAIN_LIMITS.items),
  gaps: z
    .array(
      z.object({
        topic: z.enum(EXPLAIN_TOPICS),
        kind: z.enum(EXPLAIN_GAP_KINDS),
        note: clean(EXPLAIN_LIMITS.note),
        sourceIds,
      }),
    )
    .max(EXPLAIN_LIMITS.gaps),
});
export type ExplainResponse = z.infer<typeof explainResponseSchema>;
