import { describe, expect, it } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * #305 — strona główna i lista ofert nie obiecują „tysięcy” ofert ani kandydatów,
 * których portal nie potrafi potwierdzić. Strażnik pilnuje, by te teksty nie wróciły.
 */

const VOLUME_CLAIM = /tysi[ąęa]c|thousand|duizend|milliers/i;

const KEYS = [
  ['home', 'ctaPostJobSub'],
  ['home', 'step1Desc'],
  ['jobs', 'subtitle'],
] as const;

describe('brak nieweryfikowalnych liczb na stronie głównej i liście ofert (#305)', () => {
  for (const [locale, messages] of Object.entries({ pl, nl, fr, en })) {
    it(locale, () => {
      for (const [ns, key] of KEYS) {
        const value = (messages as Record<string, Record<string, string>>)[ns]![key]!;
        expect(value, `${ns}.${key}`).toBeTruthy();
        expect(value, `${ns}.${key}`).not.toMatch(VOLUME_CLAIM);
      }
      // FAQ nie obiecuje ofert „w Twoim języku” — treść oferty jest w języku pracodawcy.
      expect(messages.home.faqA3).not.toMatch(
        /pokazujemy w Twoim języku|tonen we in jouw taal|affichées dans votre langue|shown in your language/,
      );
    });
  }

  it('kontrola ujemna: wzorzec wykrywa dawne sformułowania', () => {
    for (const old of [
      'Dotrzyj do tysięcy kandydatów',
      'Przeglądaj tysiące ofert',
      'Bereik duizenden kandidaten',
      'Touchez des milliers de candidats',
      'Browse thousands of jobs',
    ]) {
      expect(old).toMatch(VOLUME_CLAIM);
    }
  });
});
