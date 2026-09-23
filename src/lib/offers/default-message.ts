import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * Standardowe zaproszenie w propozycji pracy (#289, Invariant #1).
 *
 * Nowe propozycje bez własnej treści mają `offers.message = ''` i tekst renderuje się po stronie
 * odbiorcy. Starsze rekordy mogą zawierać szablon zapisany w języku sesji PRACODAWCY — taki
 * tekst rozpoznajemy (dokładne dopasowanie do szablonu w dowolnym z 4 języków) i również
 * traktujemy jako brak własnej treści, żeby kandydat zobaczył zaproszenie w swoim języku.
 */
const DEFAULT_MESSAGES = new Set(
  [pl, nl, fr, en].map((messages) => messages.dashboard.offerDefaultMessage.trim()),
);

/** Własna treść rekrutera albo `null`, gdy należy pokazać standardowe zaproszenie odbiorcy. */
export function customOfferMessage(message: string | null | undefined): string | null {
  const trimmed = (message ?? '').trim();
  if (!trimmed || DEFAULT_MESSAGES.has(trimmed)) return null;
  return trimmed;
}
