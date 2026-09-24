/**
 * Porównanie nazwy podanej przez firmę z nazwą z VIES (#92).
 *
 * Wynik to wyłącznie sygnał dla administratora do ręcznego sprawdzenia — nigdy decyzja
 * ani publiczne oznaczenie. Porównujemy tokeny po usunięciu znaków diakrytycznych,
 * interpunkcji i form prawnych (BV/NV/SRL/SA/VZW…), bo VIES podaje nazwę w rejestrowym
 * zapisie (często wielkimi literami, z formą prawną na początku lub końcu).
 */

export type CompanyNameComparison = 'match' | 'mismatch' | 'unknown';

const LEGAL_FORMS = new Set([
  'bv', 'bvba', 'nv', 'vof', 'commv', 'comm', 'cv', 'cva', 'cvba', 'vzw', 'ivzw', 'esv',
  'sa', 'srl', 'sprl', 'sc', 'scrl', 'scs', 'sca', 'snc', 'asbl', 'aisbl', 'se', 'eeig', 'geie',
  'ltd', 'gmbh', 'sas', 'sarl', 'eurl',
]);

function tokens(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' en ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token !== '' && token !== 'en' && token !== 'et' && token !== 'and')
    .filter((token) => !LEGAL_FORMS.has(token));
}

export function compareCompanyNames(
  declared: string | null | undefined,
  official: string | null | undefined,
): CompanyNameComparison {
  const a = tokens(declared ?? '');
  const b = tokens(official ?? '');
  if (a.length === 0 || b.length === 0) return 'unknown';
  const setA = new Set(a);
  const setB = new Set(b);
  const aInB = a.every((token) => setB.has(token));
  const bInA = b.every((token) => setA.has(token));
  return aInB || bInA ? 'match' : 'mismatch';
}
