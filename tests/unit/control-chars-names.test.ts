import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #1244 — nazwa zapisanego wyszukiwania i nazwa firmy bez CR/LF i innych znaków sterujących
 * (reguła jak przy zmianie nazwy wyszukiwania, 0124; lustro CHECK z 0206), a temat e-maila
 * zawsze jednowierszowy (renderEmail + transport).
 */

vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import type { PortalIdentity } from '@/lib/auth/session';
import { fakeDb, resetFakeDb } from '../helpers/fake-db';
import { saveSearchAction } from '@/lib/actions/saved-searches';
import { companyFormSchema } from '@/lib/validation/company';
import { NO_CONTROL_CHARS_REGEX, toSingleLineHeader } from '@/lib/validation/text';
import { renderEmail } from '@/emails/templates';
import { buildDeliveryData } from '@/lib/email/delivery-data';
import { emailLabsPayload } from '@/lib/email/transport/emaillabs';
import { warmUpEmailRender } from '../helpers/email-render-warmup';

const USER = '11111111-1111-4111-8111-111111111111';
const INJECTION = 'Praca\r\nBcc: x@example.com';

beforeAll(async () => {
  await warmUpEmailRender();
});

describe('reguła znaków sterujących', () => {
  it.each([
    ['CR/LF', INJECTION],
    ['tabulator', 'a\tb'],
    ['DEL', 'a\u007fb'],
    ['C1 (NEL)', 'a\u0085b'],
  ])('odrzuca: %s', (_label, value) => {
    expect(NO_CONTROL_CHARS_REGEX.test(value)).toBe(false);
  });

  it('kontrola ujemna: zwykły tekst z polskimi znakami i emoji przechodzi', () => {
    expect(NO_CONTROL_CHARS_REGEX.test('Łódź — żółć, nocka 😀')).toBe(true);
  });

  it('toSingleLineHeader zamienia sekwencje znaków sterujących na jedną spację', () => {
    expect(toSingleLineHeader(` ${INJECTION}\u0085 `)).toBe('Praca Bcc: x@example.com');
    expect(toSingleLineHeader('Bez zmian')).toBe('Bez zmian');
  });
});

describe('zapis wyszukiwania (akcja)', () => {
  beforeEach(() => {
    resetFakeDb({ id: USER, role: 'candidate' } as PortalIdentity);
    fakeDb.rpc('save_saved_search', () => [{ saved_search_id: 'id-1', created: true }]);
  });

  const input = (name: string) => ({
    name,
    locale: 'pl' as const,
    filters: { keyword: 'magazyn' },
    query: '?keyword=magazyn',
  });

  it('nazwa z CR/LF odrzucona przed bazą', async () => {
    expect(await saveSearchAction(input(INJECTION))).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('kontrola ujemna: zwykła nazwa zapisana', async () => {
    expect(await saveSearchAction(input('Magazyn nocny'))).toEqual({ ok: true, id: 'id-1', created: true });
  });
});

describe('nazwa firmy', () => {
  it('znak sterujący = błąd przy polu nazwy', () => {
    const res = companyFormSchema.safeParse({ name: 'Firma\r\nBcc', vatNumber: '' });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues).toContainEqual(
        expect.objectContaining({ path: ['name'], message: 'company.error.nameInvalid' }),
      );
    }
  });

  it('kontrola ujemna: zwykła nazwa przechodzi', () => {
    expect(companyFormSchema.safeParse({ name: 'Firma Łódź', vatNumber: '' }).success).toBe(true);
  });

  it('komunikat istnieje w każdym języku', () => {
    for (const locale of ['pl', 'nl', 'fr', 'en']) {
      const messages = JSON.parse(readFileSync(resolve(__dirname, `../../src/messages/${locale}.json`), 'utf8'));
      expect(messages.company.error.nameInvalid).toEqual(expect.any(String));
    }
  });
});

describe('temat e-maila', () => {
  it('renderEmail nie wstawia CR/LF z nazwy wyszukiwania (dane sprzed 0206)', async () => {
    const { data } = buildDeliveryData(
      { template: 'jobMatch', locale: 'pl', payload: { searchName: INJECTION, count: 1, jobs: [] } },
      'https://pracuj.be',
    );
    const { subject } = await renderEmail('jobMatch', 'pl', data as never);
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toContain('Praca Bcc: x@example.com');
  });

  it('transport EmailLabs spłaszcza temat spoza renderEmail', () => {
    const payload = emailLabsPayload(
      { from: 'Pracuj.be <no-reply@pracuj.be>', to: 'a@example.test', subject: INJECTION, html: '<p>x</p>', text: 'x' },
      'id@pracuj.be',
      'smtp',
    );
    expect(payload['subject']).toBe('Praca Bcc: x@example.com');
  });
});
