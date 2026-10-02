import type { Locale } from '@/i18n/routing';
import { INJECTION_PATTERNS } from '@/lib/ai-assist/guard';
import type { ExplainSource } from '@/lib/ai-explain/sources';
import type { ExplainGapKind, ExplainResponse, ExplainTopic } from '@/lib/ai-explain/schema';
import { extractFacts, type Facts } from '@/lib/translation/facts';

/**
 * Deterministyczne bramki wyjaśnienia oferty (#773) — działają niezależnie od instrukcji dla
 * modelu (fail-closed):
 *   - przed wysłaniem: tekst skierowany do AI w treści oferty = brak wywołania modelu;
 *   - po odpowiedzi: objaśnienie bez wskazanego, istniejącego źródła, z danymi kontaktowymi,
 *     z liczbą/kwotą/walutą/datą/godziną/pojęciem płacy innymi niż we wskazanych fragmentach,
 *     z nową jednostką albo oznaczeniem kwalifikacji, albo z negacją niezgodną ze źródłem —
 *     NIE jest pokazywane (liczone jako pominięte).
 *
 * Kontrola faktów korzysta z tej samej ekstrakcji co tłumaczenia (`src/lib/translation/facts.ts`,
 * PL/NL/FR/EN): objaśnienie w języku wybranym przez kandydata porównujemy z faktami fragmentów
 * w ich języku. Nie wykrywa zmian znaczenia poza tymi kategoriami — dlatego UI zawsze pokazuje
 * źródło obok objaśnienia i zastrzeżenie, że wiąże treść oferty.
 */

export function sourcesContainInjection(sources: readonly ExplainSource[]): boolean {
  return sources.some((s) => INJECTION_PATTERNS.some((p) => p.test(s.modelText)));
}

export type ExplainDropReason = 'source' | 'contact' | 'facts' | 'negation';

export interface GuardedItem {
  topic: ExplainTopic;
  explanation: string;
  sourceIds: string[];
}

export interface GuardedGap {
  topic: ExplainTopic;
  kind: ExplainGapKind;
  note: string;
  sourceIds: string[];
}

export interface GuardedExplanation {
  items: GuardedItem[];
  gaps: GuardedGap[];
  /** Liczba objaśnień i uwag odrzuconych przez bramki. */
  dropped: number;
}

type SetKind = 'numbers' | 'currencies' | 'dates' | 'times' | 'pay_terms' | 'units' | 'terms';
/** Muszą się zgadzać dokładnie (objaśnienie powtarza każdą wartość wskazanych fragmentów). */
const EXACT_KINDS: readonly SetKind[] = ['numbers', 'currencies', 'dates', 'times', 'pay_terms'];
/** Mogą zostać pominięte, ale nie mogą się pojawić nowe. */
const SUBSET_KINDS: readonly SetKind[] = ['units', 'terms'];

function set(values: readonly string[]): Set<string> {
  return new Set(values);
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((v) => b.has(v));
}

function subset(a: Set<string>, b: Set<string>): boolean {
  return [...a].every((v) => b.has(v));
}

function hasContact(facts: Facts): boolean {
  return facts.emails.length > 0 || facts.urls.length > 0 || facts.phones.length > 0;
}

interface SourceFacts {
  facts: Facts;
}

function unionFacts(cited: readonly SourceFacts[]): { sets: Record<SetKind, Set<string>>; negation: boolean } {
  const kinds: SetKind[] = [...EXACT_KINDS, ...SUBSET_KINDS];
  const sets = Object.fromEntries(kinds.map((k) => [k, new Set<string>()])) as Record<SetKind, Set<string>>;
  let negation = false;
  for (const { facts } of cited) {
    for (const k of kinds) for (const v of facts[k]) sets[k].add(v);
    negation ||= facts.negation;
  }
  return { sets, negation };
}

/** Powód odrzucenia objaśnienia albo `null`, gdy przechodzi bramki. */
export function checkExplanationItem(
  explanation: string,
  cited: readonly SourceFacts[],
  locale: Locale,
): ExplainDropReason | null {
  if (cited.length === 0) return 'source';
  const facts = extractFacts(explanation, locale);
  if (hasContact(facts)) return 'contact';
  const source = unionFacts(cited);
  for (const k of EXACT_KINDS) if (!sameSet(set(facts[k]), source.sets[k])) return 'facts';
  for (const k of SUBSET_KINDS) if (!subset(set(facts[k]), source.sets[k])) return 'facts';
  if (facts.negation !== source.negation) return 'negation';
  return null;
}

/**
 * Uwaga o brakującej/sprzecznej/niejasnej informacji: źródło opcjonalne (brak informacji nie ma
 * źródła), ale wskazane id musi istnieć; bez danych kontaktowych i bez faktów spoza wskazanych
 * fragmentów (bez źródła — bez żadnej liczby, kwoty ani daty).
 */
export function checkGapNote(note: string, cited: readonly SourceFacts[], locale: Locale): ExplainDropReason | null {
  const facts = extractFacts(note, locale);
  if (hasContact(facts)) return 'contact';
  const source = unionFacts(cited);
  for (const k of [...EXACT_KINDS, ...SUBSET_KINDS]) if (!subset(set(facts[k]), source.sets[k])) return 'facts';
  return null;
}

/** Odpowiedź modelu (po parserze) → objaśnienia i uwagi, które przeszły bramki. */
export function guardExplanation(
  response: ExplainResponse,
  sources: readonly ExplainSource[],
  targetLocale: Locale,
): GuardedExplanation {
  const factsById = new Map<string, SourceFacts>();
  for (const s of sources) factsById.set(s.id, { facts: extractFacts(s.modelText, s.factLocale) });
  const resolve = (ids: readonly string[]): { ok: boolean; ids: string[]; cited: SourceFacts[] } => {
    const unique = [...new Set(ids)];
    const cited = unique.map((id) => factsById.get(id));
    return {
      ok: cited.every((c) => c !== undefined),
      ids: unique,
      cited: cited.filter((c): c is SourceFacts => c !== undefined),
    };
  };

  let dropped = 0;
  const items: GuardedItem[] = [];
  for (const item of response.items) {
    const r = resolve(item.sourceIds);
    if (!r.ok || checkExplanationItem(item.explanation, r.cited, targetLocale) !== null) {
      dropped += 1;
      continue;
    }
    items.push({ topic: item.topic, explanation: item.explanation, sourceIds: r.ids });
  }
  const gaps: GuardedGap[] = [];
  for (const gap of response.gaps) {
    const r = resolve(gap.sourceIds);
    if (!r.ok || checkGapNote(gap.note, r.cited, targetLocale) !== null) {
      dropped += 1;
      continue;
    }
    gaps.push({ topic: gap.topic, kind: gap.kind, note: gap.note, sourceIds: r.ids });
  }
  return { items, gaps, dropped };
}
