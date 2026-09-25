import { z } from 'zod/v3';

import { routing } from '@/i18n/routing';
import { containsPersonalIdentifier } from '@/lib/privacy/sensitive-data';

/**
 * Walidacja formularza kontaktu (#61) — ten sam schemat w formularzu (React Hook Form)
 * i w Server Action. Reguły lustrzane do `submit_contact_message` (0108); baza sprawdza je
 * ponownie, więc ominięcie formularza niczego nie daje.
 *
 * Komunikaty błędów to klucze i18n (`contact.error.*`), tłumaczone w formularzu.
 *
 * Minimalizacja (#495): portal nie potrzebuje numeru rejestru narodowego/BIS, PESEL ani
 * numeru dokumentu, żeby odpowiedzieć na wiadomość — treść z takim numerem jest odrzucana
 * przy polu, zanim cokolwiek trafi do bazy.
 */

/** Tematy wiadomości (kolejność = kolejność w formularzu). Zgodne z CHECK w 0108. */
export const CONTACT_TOPICS = [
  'candidate_account',
  'employer_account',
  'job_listing',
  'technical',
  'privacy',
  'other',
] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

/** Limity pól (= ograniczenia w bazie). */
export const CONTACT_LIMITS = {
  messageMin: 20,
  messageMax: 5000,
  nameMax: 200,
  emailMax: 254,
} as const;

/** Numer referencyjny nadawany przez bazę. */
export const CONTACT_REFERENCE_RE = /^KON-[0-9A-F]{4}-[0-9A-F]{4}$/;

/** Klucz etykiety tematu w namespace `contact` (formularz i panel admina). */
export const CONTACT_TOPIC_KEY: Record<ContactTopic, string> = {
  candidate_account: 'topicCandidateAccount',
  employer_account: 'topicEmployerAccount',
  job_listing: 'topicJobListing',
  technical: 'topicTechnical',
  privacy: 'topicPrivacy',
  other: 'topicOther',
};

export function isContactTopic(value: unknown): value is ContactTopic {
  return typeof value === 'string' && (CONTACT_TOPICS as readonly string[]).includes(value);
}

export const contactSchema = z.object({
  topic: z.enum(CONTACT_TOPICS, {
    errorMap: () => ({ message: 'contact.error.topicRequired' }),
  }),
  message: z
    .string()
    .trim()
    .min(1, 'contact.error.messageRequired')
    .min(CONTACT_LIMITS.messageMin, 'contact.error.messageTooShort')
    .max(CONTACT_LIMITS.messageMax, 'contact.error.messageTooLong')
    .refine((v) => !containsPersonalIdentifier(v), 'contact.error.sensitiveId'),
  senderName: z
    .string()
    .trim()
    .max(CONTACT_LIMITS.nameMax, 'contact.error.nameTooLong')
    .refine((v) => !containsPersonalIdentifier(v), 'contact.error.sensitiveId'),
  senderEmail: z
    .string()
    .trim()
    .min(1, 'contact.error.emailRequired')
    .max(CONTACT_LIMITS.emailMax, 'contact.error.emailInvalid')
    .email('contact.error.emailInvalid'),
  locale: z.enum(routing.locales),
  idempotencyKey: z.string().uuid(),
});

export type ContactInput = z.input<typeof contactSchema>;

/** Pola formularza (bez identyfikatora operacji i języka — te podaje komponent). */
export const contactFormSchema = contactSchema.omit({ locale: true, idempotencyKey: true });
export type ContactFormValues = z.input<typeof contactFormSchema>;
