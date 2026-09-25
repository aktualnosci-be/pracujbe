import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emailProviderFromEnv, mailTransportFromEnv, MailSendError } from '@/lib/email/transport';
import {
  EMAILLABS_API_BASE,
  emailLabsMessageId,
  emailLabsPayload,
  emailLabsTransport,
  parseMailbox,
} from '@/lib/email/transport/emaillabs';
import { processEmailQueue } from '@/lib/email/outbox';
import { fakeDb, resetFakeDb } from '../helpers/fake-db';

/**
 * Adapter EmailLabs (REST v2.1) za wspólnym transportem poczty — bez sieci (atrapa fetch):
 * kontrakt żądania, ACK tylko z identyfikatorem wiadomości, klasyfikacja błędów, idempotencja
 * (sprawdzenie messageId przed wysyłką), nagłówki wypisania i wyłączenie śledzenia linków,
 * wybór dostawcy przez EMAIL_PROVIDER oraz ścieżka workera kolejki domenowej.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isProductionMode: () => true,
}));

const CONFIG = { appKey: 'app-key-test', secretKey: 'auth-key-test', smtpAccount: '1.pracujbe.smtp' };
const KEY = '0a1b2c3d-0000-4000-8000-000000000001';
const MESSAGE_ID = `${KEY}@pracuj.be`;
const MESSAGE = {
  from: 'Pracuj.be <no-reply@pracuj.be>',
  to: 'kandydat@example.test',
  subject: 'Nowa propozycja pracy',
  html: '<p>Treść</p>',
  text: 'Treść',
};

interface Call { url: string; init: RequestInit }

/** Atrapa HTTP EmailLabs: kolejne odpowiedzi dla GET (sprawdzenie) i POST (wysyłka). */
function fakeFetch(handlers: { lookup?: () => Response; send?: () => Response | Promise<Response> }) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (init.method === 'GET') return handlers.lookup?.() ?? jsonResponse(404, { meta: {} });
    return (await handlers.send?.()) ?? jsonResponse(200, accepted(MESSAGE_ID));
  });
  return { fn, calls, posts: () => calls.filter((c) => c.init.method === 'POST') };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function accepted(messageId: string) {
  return {
    meta: { numberOfErrors: 0, numberOfData: 1, status: 200, uniqId: 'u1' },
    data: [{ to: [{ email: MESSAGE.to, messageId }], status: 'injected' }],
  };
}

function bodyOf(call: Call | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init.body)) as Record<string, unknown>;
}

describe('kontrakt żądania EmailLabs', () => {
  it('POST /v2.1/email z kluczami w nagłówkach, messageId z UUID wiersza i domeny nadawcy', async () => {
    const http = fakeFetch({});
    const result = await emailLabsTransport(CONFIG, http.fn).send(MESSAGE, { idempotencyKey: KEY });
    expect(result).toEqual({ id: MESSAGE_ID });
    const [post] = http.posts();
    expect(post?.url).toBe(`${EMAILLABS_API_BASE}/v2.1/email`);
    expect(post?.init.headers).toMatchObject({
      'Application-Key': 'app-key-test',
      Authorization: 'auth-key-test',
      'Content-Type': 'application/json',
    });
    expect(bodyOf(post)).toMatchObject({
      smtpAccount: '1.pracujbe.smtp',
      subject: MESSAGE.subject,
      from: { email: 'no-reply@pracuj.be', name: 'Pracuj.be' },
      to: [{ email: MESSAGE.to, messageId: MESSAGE_ID }],
      content: { html: MESSAGE.html, text: MESSAGE.text },
    });
  });

  it('nagłówki wypisania (RFC 8058) przechodzą bez zmian, śledzenie linków wyłączone', () => {
    const headers = {
      'List-Unsubscribe': '<https://pracuj.be/api/email/unsubscribe?t=x>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
    const payload = emailLabsPayload({ ...MESSAGE, headers }, MESSAGE_ID, CONFIG.smtpAccount);
    expect(payload['headers']).toEqual({ ...headers, 'X-TRACKING-OFF': '1' });
    // Bez nagłówków wypisania (np. mail konta) śledzenie i tak jest wyłączone.
    expect(emailLabsPayload(MESSAGE, MESSAGE_ID, CONFIG.smtpAccount)['headers']).toEqual({ 'X-TRACKING-OFF': '1' });
  });

  it('temat dłuższy niż 128 znaków jest skracany (limit API), nazwa nadawcy opcjonalna', () => {
    const long = emailLabsPayload({ ...MESSAGE, subject: 'ą'.repeat(200) }, MESSAGE_ID, CONFIG.smtpAccount);
    expect([...String(long['subject'])]).toHaveLength(128);
    expect(parseMailbox('no-reply@pracuj.be')).toEqual({ email: 'no-reply@pracuj.be' });
    expect(parseMailbox('"Pracuj.be" <no-reply@pracuj.be>')).toEqual({ email: 'no-reply@pracuj.be', name: 'Pracuj.be' });
    expect(parseMailbox('bez adresu')).toBeNull();
    expect(emailLabsMessageId(KEY, 'No-Reply@Pracuj.BE')).toBe(MESSAGE_ID);
  });
});

describe('ACK i błędy', () => {
  it('odpowiedź 200 bez naszego messageId → brak ACK (provider_unavailable)', async () => {
    const http = fakeFetch({ send: () => jsonResponse(200, accepted('inny@pracuj.be')) });
    const error = await emailLabsTransport(CONFIG, http.fn).send(MESSAGE, { idempotencyKey: KEY }).catch((e) => e);
    expect(error).toBeInstanceOf(MailSendError);
    expect((error as MailSendError).code).toBe('provider_unavailable');
  });

  it.each([
    [429, 'provider_unavailable'],
    [500, 'provider_unavailable'],
    [401, 'provider_unavailable'],
    [400, 'delivery_failed'],
    [207, 'delivery_failed'],
  ] as const)('HTTP %i → %s, bez komunikatu dostawcy', async (status, code) => {
    const http = fakeFetch({
      send: () => jsonResponse(status, { errors: [{ message: 'kandydat@example.test rejected', code: 'E' }] }),
    });
    const error = await emailLabsTransport(CONFIG, http.fn).send(MESSAGE, { idempotencyKey: KEY }).catch((e) => e);
    expect((error as MailSendError).code).toBe(code);
    expect(String((error as Error).message)).not.toContain('@');
  });

  it('błąd sieci / timeout → provider_unavailable, bez URL i kluczy w błędzie', async () => {
    const fn = vi.fn(async () => { throw new TypeError(`fetch failed ${CONFIG.secretKey}`); });
    const error = await emailLabsTransport(CONFIG, fn).send(MESSAGE, { idempotencyKey: KEY }).catch((e) => e);
    expect((error as MailSendError).code).toBe('provider_unavailable');
    expect(String((error as Error).message)).not.toContain(CONFIG.secretKey);
  });
});

describe('idempotencja (EmailLabs nie ma Idempotency-Key)', () => {
  it('list o tym messageId już jest u dostawcy → ACK bez drugiej wysyłki', async () => {
    const http = fakeFetch({ lookup: () => jsonResponse(200, accepted(MESSAGE_ID)) });
    const result = await emailLabsTransport(CONFIG, http.fn).send(MESSAGE, { idempotencyKey: KEY });
    expect(result).toEqual({ id: MESSAGE_ID });
    expect(http.posts()).toHaveLength(0);
    const lookup = new URL(http.calls[0]!.url);
    expect(lookup.pathname).toBe('/v2.1/email');
    expect(lookup.searchParams.get('messageId')).toBe(MESSAGE_ID);
  });

  it('utracona odpowiedź po przyjęciu listu: ponowienie nie wysyła drugi raz', async () => {
    // Stan dostawcy: po pierwszym POST list istnieje, ale odpowiedź do nas nie dociera.
    let stored = false;
    const http = fakeFetch({
      lookup: () => (stored ? jsonResponse(200, accepted(MESSAGE_ID)) : jsonResponse(404, { meta: {} })),
      send: () => { stored = true; throw new TypeError('socket hang up'); },
    });
    const transport = emailLabsTransport(CONFIG, http.fn);
    await expect(transport.send(MESSAGE, { idempotencyKey: KEY })).rejects.toBeInstanceOf(MailSendError);
    await expect(transport.send(MESSAGE, { idempotencyKey: KEY })).resolves.toEqual({ id: MESSAGE_ID });
    expect(http.posts()).toHaveLength(1);
  });

  it('kontrola ujemna: gdy sprawdzenie nie widzi przyjętego listu, ten sam scenariusz daje dwie wysyłki', async () => {
    // Ochrona przed duplikatem zależy wyłącznie od sprawdzenia messageId: bez niego (tu: dostawca
    // zawsze odpowiada 404) druga próba wysyła list ponownie.
    let first = true;
    const http = fakeFetch({
      lookup: () => jsonResponse(404, { meta: {} }),
      send: () => {
        if (first) { first = false; throw new TypeError('socket hang up'); }
        return jsonResponse(200, accepted(MESSAGE_ID));
      },
    });
    const transport = emailLabsTransport(CONFIG, http.fn);
    await transport.send(MESSAGE, { idempotencyKey: KEY }).catch(() => undefined);
    await transport.send(MESSAGE, { idempotencyKey: KEY });
    expect(http.posts()).toHaveLength(2);
  });

  it('błąd sprawdzenia (np. brak uprawnienia klucza) → provider_unavailable i brak wysyłki', async () => {
    const http = fakeFetch({ lookup: () => jsonResponse(403, { errors: [] }) });
    const error = await emailLabsTransport(CONFIG, http.fn).send(MESSAGE, { idempotencyKey: KEY }).catch((e) => e);
    expect((error as MailSendError).code).toBe('provider_unavailable');
    expect(http.posts()).toHaveLength(0);
  });
});

describe('wybór dostawcy (EMAIL_PROVIDER)', () => {
  const el = { EMAILLABS_APP_KEY: 'a', EMAILLABS_SECRET_KEY: 'b', EMAILLABS_SMTP_ACCOUNT: '1.x.smtp' };

  it('bez EMAIL_PROVIDER: EmailLabs z kompletem kluczy, inaczej Resend, inaczej brak', () => {
    expect(emailProviderFromEnv({ ...el, RESEND_API_KEY: 're' })).toEqual({ provider: 'emaillabs', ready: true });
    expect(emailProviderFromEnv({ RESEND_API_KEY: 're' })).toEqual({ provider: 'resend', ready: true });
    expect(emailProviderFromEnv({ EMAILLABS_APP_KEY: 'a', RESEND_API_KEY: 're' })).toEqual({ provider: 'resend', ready: true });
    expect(emailProviderFromEnv({})).toEqual({ provider: null, ready: false });
  });

  it('jawny wybór bez kluczy = nie gotowy (bez cichego przełączenia na drugiego dostawcę)', () => {
    expect(emailProviderFromEnv({ EMAIL_PROVIDER: 'emaillabs', RESEND_API_KEY: 're' })).toEqual({ provider: 'emaillabs', ready: false });
    expect(mailTransportFromEnv({ EMAIL_PROVIDER: 'emaillabs', RESEND_API_KEY: 're' })).toBeNull();
    expect(emailProviderFromEnv({ ...el, EMAIL_PROVIDER: 'Resend', RESEND_API_KEY: 're' })).toEqual({ provider: 'resend', ready: true });
    expect(mailTransportFromEnv({ ...el, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're' })?.provider).toBe('resend');
  });

  it('nieznana wartość EMAIL_PROVIDER = brak dostawcy (fail-closed)', () => {
    expect(emailProviderFromEnv({ ...el, EMAIL_PROVIDER: 'emailabs' })).toEqual({ provider: null, ready: false });
    expect(mailTransportFromEnv({ ...el, EMAIL_PROVIDER: 'emailabs' })).toBeNull();
  });
});

describe('worker kolejki domenowej przez EmailLabs', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    resetFakeDb(null).exec('email.outbox.mark-sent').exec('email.outbox.mark-failed');
    fakeDb.rpc('claim_email_batch', [{
      id: KEY, profile_id: null, to_email: 'kandydat@example.test', template: 'jobOffer',
      locale: 'nl', payload: { companyName: 'Acme', jobTitle: 'Magazijnier' }, attempts: 0,
    }]);
    fakeDb.rpc('take_email_send_budget', [{ granted: true, retry_at: null }]);
    process.env.EMAIL_PROVIDER = 'emaillabs';
    process.env.EMAILLABS_APP_KEY = CONFIG.appKey;
    process.env.EMAILLABS_SECRET_KEY = CONFIG.secretKey;
    process.env.EMAILLABS_SMTP_ACCOUNT = CONFIG.smtpAccount;
    process.env.EMAIL_FROM = 'Pracuj.be <no-reply@pracuj.be>';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://pracuj.be';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...saved };
  });

  it('zapis sent: provider = emaillabs, provider_message_id = nadany messageId', async () => {
    const http = fakeFetch({});
    vi.stubGlobal('fetch', http.fn);
    const result = await processEmailQueue();
    expect(result).toMatchObject({ processed: 1, sent: 1, failed: 0, ok: true });
    expect(bodyOf(http.posts()[0])).toMatchObject({ to: [{ email: 'kandydat@example.test', messageId: MESSAGE_ID }] });
    const [mark] = fakeDb.callsTo('email.outbox.mark-sent');
    expect(mark).toMatchObject({ as: 'service', values: [KEY, MESSAGE_ID, 1, 'emaillabs'] });
  });

  it('odrzucenie przez EmailLabs: wiersz wraca z kodem błędu (bez komunikatu dostawcy)', async () => {
    vi.stubGlobal('fetch', fakeFetch({
      send: () => jsonResponse(400, { errors: [{ message: 'kandydat@example.test invalid' }] }),
    }).fn);
    const result = await processEmailQueue();
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    const [fail] = fakeDb.callsTo('email.outbox.mark-failed');
    expect(fail?.values).toContain('EMAIL_PROVIDER_REJECTED');
    expect(JSON.stringify(fail?.values)).not.toContain('kandydat@example.test invalid');
  });

  it('jawny EmailLabs bez kluczy w produkcji → pominięcie z ok:false (alarm), bez wysyłki', async () => {
    delete process.env.EMAILLABS_SECRET_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await processEmailQueue();
    expect(result).toMatchObject({ processed: 0, ok: false, skipped: 'emaillabs not configured' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
