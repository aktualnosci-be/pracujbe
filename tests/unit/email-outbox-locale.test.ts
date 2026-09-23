import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmailType } from '@/emails/copy';
import { renderEmail } from '@/emails/templates';
import type { Locale } from '@/i18n/routing';
import { processEmailQueue } from '@/lib/email/outbox';

/**
 * #348 — Invariant #1 na ścieżce produkcyjnej: worker outboxa (`processEmailQueue`) renderuje
 * i wysyła e-mail w języku z wiersza kolejki (`email_deliveries.locale`, wyznaczonym w DB dla
 * ODBIORCY), a nie w języku domyślnym serwera, payloadu czy sesji nadawcy.
 */

const { send, adminRpc, adminFrom } = vi.hoisted(() => ({
  send: vi.fn(),
  adminRpc: vi.fn(),
  adminFrom: vi.fn(),
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: adminRpc, from: adminFrom }) }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isProductionMode: () => true,
}));

const SITE = 'https://pracuj.be';

function row(id: string, template: EmailType, locale: string, payload: Record<string, unknown>) {
  return { id, profile_id: null, to_email: `${id}@example.test`, template, locale, payload, attempts: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 're_test';
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  // Pułapka: domyślny język serwera NIE może wpływać na język odbiorcy.
  process.env.NEXT_PUBLIC_DEFAULT_LOCALE = 'pl';
  send.mockResolvedValue({ data: { id: 'provider-1' }, error: null });
  adminFrom.mockReturnValue({ update: () => ({ eq: async () => ({ error: null }) }) });
});

const CASES: Array<{ template: EmailType; locale: Locale; path: string; payload: Record<string, unknown> }> = [
  // Payload celowo niesie język NADAWCY (pl) — worker ma go zignorować.
  { template: 'jobOffer', locale: 'nl', path: '/nl/candidate/propozycje', payload: { companyName: 'Acme', jobTitle: 'Magazijnier', locale: 'pl' } },
  { template: 'newApplication', locale: 'fr', path: '/fr/employer/aplikacje', payload: { candidateName: 'Jan', jobTitle: 'Cariste', senderLocale: 'pl' } },
  { template: 'statusChanged', locale: 'en', path: '/en/candidate/aplikacje', payload: { companyName: 'Acme', jobTitle: 'Driver', status: 'viewed' } },
  { template: 'offerAccepted', locale: 'nl', path: '/nl/employer/aplikacje', payload: { candidateName: 'Jan', jobTitle: 'Chauffeur' } },
  { template: 'newMessage', locale: 'fr', path: '/fr/candidate/wiadomosci', payload: { senderName: 'Jan', panel: 'candidate' } },
];

describe('processEmailQueue — język odbiorcy z email_deliveries.locale', () => {
  it.each(CASES)('$template w $locale: temat, treść i link w języku wiersza', async ({ template, locale, path, payload }) => {
    adminRpc.mockResolvedValue({ data: [row('d1', template, locale, payload)], error: null });

    const result = await processEmailQueue();
    expect(result).toMatchObject({ processed: 1, sent: 1, failed: 0, ok: true });

    const [message, options] = send.mock.calls[0]!;
    const data = { ...payload, applicationUrl: `${SITE}${path}`, offerUrl: `${SITE}${path}`, actionUrl: `${SITE}${path}`, messageUrl: `${SITE}${path}` };
    const expected = await (renderEmail as (t: EmailType, l: Locale, d: Record<string, unknown>) => Promise<{ subject: string }>)(template, locale, data);
    const polish = await (renderEmail as (t: EmailType, l: Locale, d: Record<string, unknown>) => Promise<{ subject: string }>)(template, 'pl', data);

    expect(expected.subject).not.toBe(polish.subject);
    expect(message.subject).toBe(expected.subject);
    expect(message.html).toContain(`lang="${locale}"`);
    expect(message.html).toContain(`${SITE}${path}`);
    expect(message.html).not.toContain(`${SITE}/pl/`);
    expect(options).toEqual({ idempotencyKey: 'd1' });
  });

  it('paczka z odbiorcami w różnych językach: każdy e-mail w języku swojego wiersza', async () => {
    adminRpc.mockResolvedValue({
      data: [
        row('a', 'jobOffer', 'fr', { companyName: 'Acme', jobTitle: 'Cariste' }),
        row('b', 'jobOffer', 'en', { companyName: 'Acme', jobTitle: 'Driver' }),
      ],
      error: null,
    });
    await processEmailQueue();
    const htmlByRecipient = Object.fromEntries(send.mock.calls.map(([m]) => [m.to, m.html as string]));
    expect(htmlByRecipient['a@example.test']).toContain(`${SITE}/fr/candidate/propozycje`);
    expect(htmlByRecipient['b@example.test']).toContain(`${SITE}/en/candidate/propozycje`);
  });

  it('nieobsługiwany język w wierszu → fallback en (nie pl serwera)', async () => {
    adminRpc.mockResolvedValue({ data: [row('d1', 'jobOffer', 'de', { companyName: 'Acme', jobTitle: 'Fahrer' })], error: null });
    await processEmailQueue();
    expect(send.mock.calls[0]![0].html).toContain(`${SITE}/en/candidate/propozycje`);
  });
});
