import type { Locale } from '@/i18n/routing';

/**
 * Glosariusz tłumaczeń (#32). Wersja wchodzi do wersji pipeline — zmiana glosariusza
 * ponownie kolejkuje tłumaczenia tej samej treści.
 *
 * - `DO_NOT_TRANSLATE` — kwalifikacje, certyfikaty i nazwy, które zostają dosłownie. Walidator
 *   faktów wymaga, by każde wystąpienie w źródle było też w przekładzie.
 * - `PREFERRED_TERMS` — terminologia belgijska (NL/FR) i odpowiedniki PL/EN. Tylko wskazówka
 *   dla modelu; zgodność ocenia benchmark (#30), nie walidator.
 */
export const GLOSSARY_VERSION = 'glossary-v1';

export const DO_NOT_TRANSLATE: readonly string[] = [
  'VCA',
  'VOL-VCA',
  'VIL-VCU',
  'BA4',
  'BA5',
  'SEP',
  'HACCP',
  'ADR',
  'CACES',
  'Code 95',
  'Pracuj.be',
];

export type GlossaryEntry = Record<Locale, string>;

export const PREFERRED_TERMS: readonly GlossaryEntry[] = [
  { pl: 'bony żywnościowe', nl: 'maaltijdcheques', fr: 'chèques-repas', en: 'meal vouchers' },
  { pl: 'ekobony', nl: 'ecocheques', fr: 'éco-chèques', en: 'eco vouchers' },
  { pl: 'praca tymczasowa (interim)', nl: 'uitzendarbeid', fr: 'intérim', en: 'temporary agency work' },
  { pl: 'premia na koniec roku', nl: 'eindejaarspremie', fr: "prime de fin d'année", en: 'end-of-year bonus' },
  { pl: 'dodatek zmianowy', nl: 'ploegenpremie', fr: "prime d'équipe", en: 'shift allowance' },
  { pl: 'ubezpieczenie szpitalne', nl: 'hospitalisatieverzekering', fr: 'assurance hospitalisation', en: 'hospitalisation insurance' },
  { pl: 'umowa na czas nieokreślony', nl: 'contract van onbepaalde duur', fr: 'contrat à durée indéterminée', en: 'permanent contract' },
  { pl: 'umowa na czas określony', nl: 'contract van bepaalde duur', fr: 'contrat à durée déterminée', en: 'fixed-term contract' },
  { pl: 'zwrot kosztów dojazdu', nl: 'verplaatsingsvergoeding', fr: 'indemnité de déplacement', en: 'travel allowance' },
];

/** Wiersze glosariusza dla pary języków (do promptu). */
export function glossaryFor(source: Locale, target: Locale): { source: string; target: string }[] {
  return PREFERRED_TERMS.map((e) => ({ source: e[source], target: e[target] }));
}
