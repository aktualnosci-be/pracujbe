import { ALL_SENSITIVE_KINDS, findSensitiveData, redactSensitiveData, REDACTION_MARKERS } from '@/lib/privacy/sensitive-data';
import { ASSIST_LIMITS, ASSIST_MIN_DESCRIPTION, type AssistRequest, type AssistResponse } from '@/lib/ai-assist/schema';
import {
  ASSIST_FIELDS,
  ASSIST_TEXT_FIELDS,
  sameAssistValue,
  type AssistDropped,
  type AssistField,
  type AssistSuggestion,
  type AssistValue,
} from '@/lib/ai-assist/fields';

/**
 * Deterministyczne bramki asystenta redagowania (#37) — działają niezależnie od instrukcji
 * dla modelu:
 *   - przed wysłaniem: wykrycie poleceń dla AI (prompt injection) i redakcja e-maili, telefonów
 *     i numerów identyfikacyjnych w tekście oferty;
 *   - po odpowiedzi: propozycja z NOWYM faktem (liczba, adres WWW nieobecne w tekście
 *     pracodawcy), z danymi kontaktowymi/identyfikatorem albo niezgodna z limitami kreatora
 *     nie jest pokazywana — pole zostaje bez propozycji z podanym powodem.
 */

/**
 * Tekst skierowany do modelu zamiast do kandydata (PL/NL/FR/EN). Celowo wąskie wzorce —
 * zwykła oferta ich nie zawiera; model dodatkowo zgłasza `suspiciousInstructions`.
 */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts?|rules)\b/i,
  /\b(?:system\s+prompt|developer\s+message|you\s+are\s+now\s+(?:an?\s+)?(?:ai|assistant|chatgpt|claude))\b/i,
  /\bzignoruj\s+(?:wszystkie\s+)?(?:poprzednie|wcześniejsze|powyższe)\s+(?:instrukcje|polecenia)\b/i,
  /\bnegeer\s+(?:alle\s+)?(?:vorige|eerdere|bovenstaande)\s+(?:instructies|opdrachten)\b/i,
  /\bignore[rz]?\s+(?:toutes\s+)?les\s+instructions\s+(?:précédentes|ci-dessus)\b/i,
  /<\s*\/?\s*(?:system|instructions?|offer_text)\b/i,
];

function requestTexts(req: AssistRequest): string[] {
  const f = req.fields;
  return [req.title, f.description ?? '', ...(f.responsibilities ?? []), ...(f.requirementsMandatory ?? [])];
}

export function detectInjection(req: AssistRequest): boolean {
  return requestTexts(req).some((text) => INJECTION_PATTERNS.some((p) => p.test(text)));
}

/** Czy jest co poprawiać — opis co najmniej 30 znaków albo przynajmniej jedna pozycja listy. */
export function hasAssistableContent(req: AssistRequest): boolean {
  const f = req.fields;
  return (
    (f.description ?? '').length >= ASSIST_MIN_DESCRIPTION ||
    (f.responsibilities ?? []).length > 0 ||
    (f.requirementsMandatory ?? []).length > 0
  );
}

/** Usuwa puste pola z żądania (pole bez treści nie idzie do modelu i nie dostaje propozycji). */
export function requestedFields(req: AssistRequest): AssistField[] {
  const f = req.fields;
  return ASSIST_FIELDS.filter((field) => {
    const value = f[field];
    if (value === undefined) return false;
    if (typeof value === 'string') return value.length >= ASSIST_MIN_DESCRIPTION;
    return value.length > 0;
  });
}

/** Redakcja danych kontaktowych i identyfikatorów przed wysłaniem do dostawcy. */
export function redactRequest(req: AssistRequest): AssistRequest {
  const r = (text: string) => redactSensitiveData(text, ALL_SENSITIVE_KINDS).text;
  const f = req.fields;
  return {
    locale: req.locale,
    title: r(req.title),
    fields: {
      ...(f.description !== undefined ? { description: r(f.description) } : {}),
      ...(f.responsibilities !== undefined ? { responsibilities: f.responsibilities.map(r) } : {}),
      ...(f.requirementsMandatory !== undefined ? { requirementsMandatory: f.requirementsMandatory.map(r) } : {}),
    },
  };
}

const NUMBER = /\d(?:[.,]?\d)*/g;
const WEB = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi;

/** Liczby (bez separatorów) i adresy WWW (małymi literami) — „fakty”, których model nie może dodać. */
export function factsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(NUMBER)) out.add(`n:${m[0].replace(/[.,]/g, '')}`);
  for (const m of text.matchAll(WEB)) out.add(`w:${m[0].toLowerCase().replace(/[.,;:!?]+$/, '')}`);
  return out;
}

/** Fakty obecne w propozycji, których nie ma w tekście pracodawcy. */
export function newFacts(source: Set<string>, suggestion: string): string[] {
  return [...factsOf(suggestion)].filter((fact) => !source.has(fact));
}

const MARKERS = Object.values(REDACTION_MARKERS);

function hasSensitive(text: string): boolean {
  return MARKERS.some((m) => text.includes(m)) || findSensitiveData(text, ALL_SENSITIVE_KINDS).length > 0;
}

/** Czyści znaki sterujące i niewidoczne znaki kierunku tekstu (jak import #465). */
function clean(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '').trim();
}

function validShape(field: AssistField, value: AssistValue): boolean {
  if (typeof value === 'string') {
    return value.length >= ASSIST_MIN_DESCRIPTION && value.length <= ASSIST_LIMITS.description;
  }
  const max = field === 'requirementsMandatory' ? ASSIST_LIMITS.requirement : ASSIST_LIMITS.line;
  return value.length > 0 && value.length <= ASSIST_LIMITS.items && value.every((item) => item.length > 0 && item.length <= max);
}

export interface GuardedSuggestions {
  suggestions: AssistSuggestion[];
  dropped: AssistDropped[];
}

/**
 * Buduje propozycje pole po polu. `original` = tekst pracodawcy PRZED redakcją (to on zostanie
 * w formularzu, gdy pracodawca nie zaakceptuje propozycji). Fakty porównujemy z tekstem
 * po redakcji — tym, który widział model.
 */
export function guardSuggestions(
  original: AssistRequest,
  sent: AssistRequest,
  response: AssistResponse,
  fields: readonly AssistField[],
): GuardedSuggestions {
  const source = new Set(requestTexts(sent).flatMap((text) => [...factsOf(text)]));
  const suggestions: AssistSuggestion[] = [];
  const dropped: AssistDropped[] = [];

  for (const field of fields) {
    const before = original.fields[field];
    if (before === undefined) continue;
    const raw = response[field];
    const suggested: AssistValue = ASSIST_TEXT_FIELDS.has(field)
      ? clean(raw as string)
      : (raw as string[]).map(clean).filter((item) => item.length > 0);
    // Brak propozycji (pusto) albo bez zmian — nic do pokazania.
    if ((typeof suggested === 'string' ? suggested.length : suggested.length) === 0) continue;
    if (sameAssistValue(suggested, before)) continue;

    const texts = typeof suggested === 'string' ? [suggested] : suggested;
    if (texts.some(hasSensitive)) {
      dropped.push({ field, reason: 'sensitive' });
    } else if (texts.some((text) => newFacts(source, text).length > 0)) {
      dropped.push({ field, reason: 'newFacts' });
    } else if (!validShape(field, suggested)) {
      dropped.push({ field, reason: 'invalid' });
    } else {
      suggestions.push({ field, original: before, suggested });
    }
  }
  return { suggestions, dropped };
}
