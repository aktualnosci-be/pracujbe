import { z } from 'zod';

import { routing, type Locale } from '@/i18n/routing';
import { containsPersonalIdentifier } from '@/lib/privacy/sensitive-data';

/**
 * Szablony odpowiedzi firmy (0170) — walidacja (przeglądarka + Server Action) i czyste
 * reguły wstawiania w kompozytorze. Limity = CHECK-i tabel `company_message_templates`
 * (nazwa 1–80) i `company_message_template_variants` (treść 1–4000, jak wiadomość).
 */

export const TEMPLATE_NAME_MAX = 80;
export const TEMPLATE_BODY_MAX = 4000;
export const TEMPLATES_PER_COMPANY_MAX = 50;

export type TemplateVariants = Partial<Record<Locale, string>>;

export interface MessageTemplate {
  id: string;
  name: string;
  /** Znacznik wersji do CAS przy edycji (`updated_at` z bazy, bez przeliczania). */
  updatedAt: string;
  variants: TemplateVariants;
}

/** Kontekst szablonów w kompozytorze rozmowy (tylko strona firmowa, recruiter+). */
export interface ComposerTemplates {
  /** Język kandydata wg `resolve_recipient_locale` (Invariant #1); null = nieznany. */
  candidateLocale: Locale | null;
  companyName: string;
  jobTitle: string;
  templates: MessageTemplate[];
}

export const messageTemplateSchema = z
  .object({
    id: z.string().uuid().nullable(),
    name: z.string().trim().min(1).max(TEMPLATE_NAME_MAX),
    variants: z.record(z.string(), z.string().max(TEMPLATE_BODY_MAX)),
    expectedUpdatedAt: z.string().max(64).nullable(),
  })
  .superRefine((value, ctx) => {
    const keys = Object.keys(value.variants);
    if (keys.some((key) => !(routing.locales as readonly string[]).includes(key))) {
      ctx.addIssue({ code: 'custom', path: ['variants'], message: 'locale' });
    }
    if (!keys.some((key) => (value.variants[key] ?? '').trim().length > 0)) {
      ctx.addIssue({ code: 'custom', path: ['variants'], message: 'empty' });
    }
  });

export type MessageTemplateInput = z.input<typeof messageTemplateSchema>;

/** Niepuste warianty (przycięte) — to, co zapisze RPC. */
export function nonEmptyVariants(variants: Record<string, string>): TemplateVariants {
  const result: TemplateVariants = {};
  for (const locale of routing.locales) {
    const body = variants[locale]?.trim();
    if (body) result[locale] = body;
  }
  return result;
}

/** #495: NISS/BIS, PESEL, eID albo numer dokumentu nie trafia do szablonu — zwraca język wariantu. */
export function findSensitiveVariant(variants: Record<string, string>): Locale | null {
  for (const locale of routing.locales) {
    if (containsPersonalIdentifier(variants[locale])) return locale;
  }
  return null;
}

/**
 * Wybór wariantu wg języka KANDYDATA (Invariant #1). Brak wariantu w tym języku = `missing`:
 * kompozytor nie wstawia innego języka po cichu, tylko pokazuje rekruterowi, że kandydat
 * ma inny język, i listę dostępnych wersji do świadomego wyboru.
 */
export type TemplatePick =
  | { status: 'match'; locale: Locale; body: string }
  | { status: 'missing'; candidateLocale: Locale | null; available: Locale[] };

export function pickTemplateVariant(template: Pick<MessageTemplate, 'variants'>, candidateLocale: Locale | null): TemplatePick {
  const body = candidateLocale ? template.variants[candidateLocale] : undefined;
  if (candidateLocale && body) return { status: 'match', locale: candidateLocale, body };
  const available = routing.locales.filter((locale) => Boolean(template.variants[locale]));
  return { status: 'missing', candidateLocale, available };
}

/**
 * Zmienne szablonu: `{imie}`, `{stanowisko}`, `{firma}` (te same znaczniki we wszystkich
 * wariantach). Pusta wartość = znacznik zostaje w polu, żeby rekruter uzupełnił go ręcznie
 * przed wysłaniem (nigdy nie zgadujemy imienia).
 */
export const TEMPLATE_VARIABLES = ['imie', 'stanowisko', 'firma'] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export function fillTemplate(body: string, values: Partial<Record<TemplateVariable, string>>): string {
  return body.replace(/\{(imie|stanowisko|firma)\}/g, (token, key: TemplateVariable) => {
    const value = values[key]?.trim();
    return value ? value : token;
  });
}
