import { describe, expect, it } from 'vitest';

import { relocalizeNextParam } from '../../src/lib/validation/auth';

/** Zmiana języka na logowaniu przenosi też cel powrotu (`?next=`) na wybrany język. */
describe('relocalizeNextParam', () => {
  it('podmienia prefiks języka w bezpiecznym next i zachowuje pozostałe parametry', () => {
    const search = `?next=${encodeURIComponent('/pl/oferty-pracy/abc?x=1')}&error=AUTH_INVALID_CREDENTIALS`;
    const params = new URLSearchParams(relocalizeNextParam(search, 'nl'));
    expect(params.get('next')).toBe('/nl/oferty-pracy/abc?x=1');
    expect(params.get('error')).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('podmienia prefiks także dla samego /{locale}', () => {
    expect(new URLSearchParams(relocalizeNextParam('?next=%2Fpl', 'fr')).get('next')).toBe('/fr');
  });

  it('bez next albo z niebezpiecznym next zostawia query bez zmian', () => {
    expect(relocalizeNextParam('', 'en')).toBe('');
    expect(relocalizeNextParam('?error=X', 'en')).toBe('?error=X');
    const evil = `?next=${encodeURIComponent('//evil.example/pl')}`;
    expect(relocalizeNextParam(evil, 'en')).toBe(evil);
  });
});
