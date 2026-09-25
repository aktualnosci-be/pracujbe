import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, resetFakeDb } from '../helpers/fake-db';

/**
 * #610 — kontrakt stanu `used` linku rejestracji zaproszenia (0121/0142): zużycie tokenu nie
 * zmienia statusu zaproszenia (zostaje `pending`, czeka w panelu), więc `team_invitation_signup_preview`
 * rozróżnia „zużyty” od „nieznany/wygasły/rozstrzygnięty” — oba dawałyby ten sam ogólny wynik
 * bez tego rozróżnienia. Tu: mapowanie wiersza z bazy (`outcome`) na `TeamInvitationSignupPreview`
 * w `readTeamInvitationSignup` — samą sekwencję preview → consume → preview na realnej bazie
 * dowodzi `supabase/tests/rls.sql` (sekcja TI610).
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());

import { readTeamInvitationSignup } from '@/lib/team/invite-signup';

const TOKEN = 'a'.repeat(43);

beforeEach(() => {
  resetFakeDb(null);
});

describe('readTeamInvitationSignup: kontrakt outcome', () => {
  it('token zużyty (used) → status "used", niezależnie od pozostałych pól wiersza', async () => {
    fakeDb.rpc('team_invitation_signup_preview', [
      { outcome: 'used', company_name: null, role: null, email: null, expires_at: null },
    ]);
    await expect(readTeamInvitationSignup(TOKEN)).resolves.toEqual({ status: 'used' });
  });

  it('token nieznany/wygasły/rozstrzygnięty (invalid) → status "invalid"', async () => {
    fakeDb.rpc('team_invitation_signup_preview', [
      { outcome: 'invalid', company_name: null, role: null, email: null, expires_at: null },
    ]);
    await expect(readTeamInvitationSignup(TOKEN)).resolves.toEqual({ status: 'invalid' });
  });

  it('token ważny (valid) → dane zaproszenia', async () => {
    const expiresAt = new Date('2026-10-01T00:00:00.000Z');
    fakeDb.rpc('team_invitation_signup_preview', [
      {
        outcome: 'valid',
        company_name: 'Acme BV',
        role: 'recruiter',
        email: 'nowy@firma.be',
        expires_at: expiresAt,
      },
    ]);
    await expect(readTeamInvitationSignup(TOKEN)).resolves.toEqual({
      status: 'valid',
      companyName: 'Acme BV',
      role: 'recruiter',
      email: 'nowy@firma.be',
      expiresAt: expiresAt.toISOString(),
    });
  });

  it('kontrola ujemna: "used" sprawdzane PRZED walidacją pól "valid" — brakujące dane nie cofają do "invalid"', async () => {
    // Gdyby mapowanie sprawdzało najpierw kompletność pól "valid" (rola/firma/e-mail/data),
    // zużyty token (bez tych pól) trafiłby do ogólnego "invalid" zamiast jednoznacznego "used".
    fakeDb.rpc('team_invitation_signup_preview', [
      { outcome: 'used', company_name: null, role: null, email: null, expires_at: null },
    ]);
    const result = await readTeamInvitationSignup(TOKEN);
    expect(result.status).not.toBe('invalid');
    expect(result).toEqual({ status: 'used' });
  });

  it('format tokenu spoza wzorca nie odpytuje bazy i zwraca "invalid"', async () => {
    await expect(readTeamInvitationSignup('zbyt-krotki')).resolves.toEqual({ status: 'invalid' });
    expect(fakeDb.callsTo('team_invitation_signup_preview')).toHaveLength(0);
  });
});
