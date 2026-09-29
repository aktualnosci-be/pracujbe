/**
 * Proste imię i nazwisko z publicznych formularzy (kontakt, zgłoszenie treści).
 *
 * Wartość trafia do powitania w e-mailu wysyłanym z domeny serwisu na podany adres, więc
 * dopuszczamy tylko krótką, zwykłą postać: litery (także z akcentami), spacje, myślnik,
 * apostrof. Bez cyfr, adresów, znaków sterujących i znaków specjalnych.
 * Pusta wartość jest dozwolona (pole opcjonalne). Zasada wspólna dla klienta i serwera
 * (schematy Zod) oraz dla workera e-mail (`buildDeliveryData` — ponowne sprawdzenie).
 */

/** Najdłuższe imię/nazwisko przyjmowane z formularza publicznego. */
export const SIMPLE_NAME_MAX = 80;

const SIMPLE_NAME_RE = /^\p{L}[\p{L}\p{M}]*(?:[ '’-]+\p{L}[\p{L}\p{M}]*)*$/u;

/** Czy wartość jest prostym imieniem (puste = tak, bo pole jest opcjonalne). */
export function isSimpleDisplayName(value: string): boolean {
  const v = value.normalize('NFC').trim();
  if (v === '') return true;
  return v.length <= SIMPLE_NAME_MAX && SIMPLE_NAME_RE.test(v);
}

/** Wartość gotowa do umieszczenia w e-mailu albo `undefined`, gdy nie jest prostym imieniem. */
export function safeDisplayNameForEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.normalize('NFC').trim();
  return v !== '' && isSimpleDisplayName(v) ? v : undefined;
}
