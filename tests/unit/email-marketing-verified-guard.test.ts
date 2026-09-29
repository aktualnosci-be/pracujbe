import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AUDIT_ACTION_KEY, AUDIT_ENTITY_TYPES } from '@/lib/admin/list-params';

/**
 * #1038 — marketing tylko na potwierdzony adres. Zachowanie sprawdza supabase/tests/rls.sql
 * (EMQ1038); tu strażnik przed cofnięciem przez późniejszą migrację: NAJNOWSZA definicja każdej
 * funkcji decyzyjnej musi znać `email_address_verified`. Kontrola ujemna: definicje sprzed 0186.
 */

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

function latestDefinition(fn: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  const re = new RegExp(`create (?:or replace )?function public\\.${fn}\\(`, 'ig');
  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS, file), 'utf8');
    for (const match of text.matchAll(re)) {
      const rest = text.slice(match.index);
      const end = rest.search(/\n(?:revoke|grant|comment on|drop|create|alter)\b/i);
      found = { file, body: end === -1 ? rest : rest.slice(0, end) };
    }
  }
  if (!found) throw new Error(`brak definicji ${fn}`);
  return found;
}

describe('marketing wymaga potwierdzonego adresu (#1038)', () => {
  it.each(['email_allowed', 'email_delivery_suppression_reason', 'enqueue_campaign_batch', 'enqueue_email_outcome'])(
    'najnowsza definicja %s zna email_address_verified',
    (fn) => {
      expect(latestDefinition(fn).body).toContain('email_address_verified');
    },
  );

  it('kontrola ujemna: definicje sprzed migracji nie znają potwierdzenia adresu', () => {
    const read = (file: string): string => readFileSync(join(MIGRATIONS, file), 'utf8');
    expect(read('0087_email_unsubscribe_budget.sql')).not.toContain('email_address_verified');
    expect(read('0101_email_consent_campaigns.sql')).not.toContain('email_address_verified');
    expect(read('0175_classifieds_account_notifications.sql')).not.toContain('email_address_verified');
  });

  it('powód odbiorcy kampanii jest dozwolony w CHECK, a wygaszenie mapowane w triggerze synchronizacji', () => {
    const sync = latestDefinition('sync_email_campaign_recipient').body;
    expect(sync).toContain("'suppressed_unverified_address'");
    const migration = readFileSync(join(MIGRATIONS, files.find((f) => f.startsWith('0186'))!), 'utf8');
    expect(migration).toMatch(/email_campaign_recipients_reason[\s\S]*'unverified_address'/);
  });
});

describe('język e-maili: audyt w panelu admina (#1049)', () => {
  it('akcja i typ obiektu są znane dziennikowi', () => {
    expect(AUDIT_ACTION_KEY['profile.email_locale_changed']).toBe('auditActionEmailLocaleChanged');
    expect(AUDIT_ENTITY_TYPES).toContain('profile');
  });

  it('RPC zapisuje audyt tylko przy zmianie i waliduje język względem słownika', () => {
    const body = latestDefinition('set_my_email_locale').body;
    expect(body).toContain('is_supported_locale');
    expect(body).toContain("write_audit('profile.email_locale_changed'");
    expect(body).toMatch(/if v_old is distinct from p_locale then/);
  });
});
