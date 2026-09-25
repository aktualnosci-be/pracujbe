// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FILTERED, redactError, redactString, redactUrl, redactValue } from '@/lib/privacy/redact';
import { buildErrorWebhookText } from '@/lib/error-webhook';
import { installConsoleRedaction } from '@/lib/privacy/console';
import { PII, UUID, expectNoPii } from '../helpers/privacy-fixtures';

/**
 * #502 — dane kandydata nie wychodzą z aplikacji przez kanał błędów (webhook #571) ani logi serwera.
 * Wartości syntetyczne; każda kontrola sprawdza najpierw, że wejście je zawiera (kontrola ujemna).
 */
describe('redactString', () => {
  it('usuwa e-mail, telefony, NISS/BIS, IBAN, tokeny, JWT i nazwę pliku CV', () => {
    const raw = [
      `user ${PII.email} tel ${PII.phoneIntl} / ${PII.phoneNational}`,
      `niss ${PII.niss} bis ${PII.nissPlain} iban ${PII.iban}`,
      `plik ${PII.cvFile} token=${PII.token} Authorization: Bearer ${PII.jwt}`,
      `https://pracuj.be/pl/aplikacja/potwierdz?token=${PII.token}#t=${PII.token}`,
      `/pl/aplikacja/przejmij/${PII.token}`,
    ].join('\n');
    expect(raw).toContain(PII.email);
    const out = redactString(raw);
    for (const key of ['email', 'phoneIntl', 'phoneNational', 'niss', 'nissPlain', 'iban', 'cvFile', 'token', 'jwt'] as const) {
      expect(out, key).not.toContain(PII[key]);
    }
    expect(out).toContain('https://pracuj.be/pl/aplikacja/potwierdz?[Filtered]');
  });

  it('usuwa wiersz i wartość klucza z błędów Postgresa', () => {
    const raw = `new row violates check constraint\nDETAIL: Failing row contains (${UUID}, ${PII.firstName}, ${PII.lastName}, ${PII.messageBody}).\nKey (email)=(${PII.email}) already exists.`;
    const out = redactString(raw);
    expect(out).not.toContain(PII.firstName);
    expect(out).not.toContain(PII.messageBody);
    expect(out).not.toContain(PII.email);
    expect(out).toContain('Failing row contains ([Filtered])');
    expect(out).toContain('Key (email)=([Filtered])');
  });

  it('zostawia kody błędów, UUID-y, daty, ścieżki i liczby techniczne', () => {
    const raw = `INTERNAL 23505 PGRST116 area=email.outbox.send ${UUID} 2026-09-24T10:00:00.000Z /pl/oferty-pracy status 503 at handler (/app/.next/server/chunks/123.js:10:5) retry in 60s`;
    expect(redactString(raw)).toBe(raw);
  });
});

describe('redactUrl', () => {
  it('ścina query i fragment, zostawia ścieżkę; usuwa segmenty-tokeny i dane logowania', () => {
    expect(redactUrl(`https://pracuj.be/pl/oferty-pracy?q=${PII.email}&city=Gent`)).toBe('https://pracuj.be/pl/oferty-pracy?[Filtered]');
    expect(redactUrl(`/nl/aplikacja/potwierdz#${PII.token}`)).toBe('/nl/aplikacja/potwierdz#[Filtered]');
    expect(redactUrl(`https://u:p@db.example/x/${PII.token}/${UUID}`)).toBe(`https://db.example/x/${FILTERED}/${UUID}`);
    expect(redactUrl(`/api/files/${encodeURIComponent(PII.cvFile)}`)).toBe(`/api/files/${FILTERED}`);
    expect(redactUrl('/pl/praca/kategoria/magazyn')).toBe('/pl/praca/kategoria/magazyn');
  });
});

describe('redactValue', () => {
  it('usuwa pola o wrażliwych nazwach i redaguje wartości, zostawia kody i UUID', () => {
    const raw = {
      area: 'messages.send',
      deliveryId: UUID,
      code: '23505',
      body: PII.messageBody,
      candidate: { firstName: PII.firstName, last_name: PII.lastName, bio: PII.bio },
      contactEmail: PII.email,
      phone_number: PII.phoneIntl,
      nested: [{ note: `zadzwoń ${PII.phoneNational}` }, `plik ${PII.cvFile}`],
      url: `https://pracuj.be/pl/x?token=${PII.token}`,
      accessToken: PII.jwt,
    };
    expect(JSON.stringify(raw)).toContain(PII.messageBody);
    const out = redactValue(raw);
    expectNoPii(JSON.stringify(out));
    expect(out.area).toBe('messages.send');
    expect(out.deliveryId).toBe(UUID);
    expect(out.code).toBe('23505');
    expect(out.url).toBe('https://pracuj.be/pl/x?[Filtered]');
    expect(raw.body).toBe(PII.messageBody); // wejście bez zmian
  });

  it('znosi cykle i głębokość bez wyjątku', () => {
    const a: Record<string, unknown> = { area: 'x' };
    a.self = a;
    expect(() => redactValue(a)).not.toThrow();
  });
});

describe('redactError', () => {
  it('redaguje wiadomość, stack i cause (Error oraz obiekt dostawcy)', () => {
    const provider = { code: '23505', message: `duplicate ${PII.email}`, details: `Failing row contains (${PII.firstName})` };
    const inner = new Error(`resend rejected ${PII.email}`, { cause: provider });
    const err = new Error(`save failed for ${PII.phoneIntl}`, { cause: inner });
    const out = redactError(err);
    expectNoPii(out);
    expect(out).toContain('23505');
    expect(out).toContain('[cause]');
  });
});

describe('wiadomość webhooka błędów (#571) z danymi kandydata na wejściu', () => {
  it('zostaje kod i trasa bez parametrów; wydanie/środowisko bez danych', () => {
    const input = {
      code: `failed for ${PII.email}`,
      route: `https://pracuj.be/pl/candidate/profil/${PII.cvFile}?email=${PII.email}#${PII.token}`,
      release: `1.0.0+${PII.jwt}`,
      environment: `prod ${PII.phoneIntl}`,
      time: new Date(0),
    };
    expect(JSON.stringify(input)).toContain(PII.email);
    const out = buildErrorWebhookText(input);
    expectNoPii(out);
    expect(out).toContain('Kod: INTERNAL');
    expect(out).toContain('Trasa: /pl/candidate/profil/[Filtered]');
  });
});

describe('logi serwera (console)', () => {
  it('owinięta konsola redaguje teksty, błędy (z cause) i obiekty; instalacja idempotentna', () => {
    const lines: unknown[][] = [];
    const sink = { log: (...a: unknown[]) => lines.push(a), info: (...a: unknown[]) => lines.push(a), warn: (...a: unknown[]) => lines.push(a), error: (...a: unknown[]) => lines.push(a), debug: (...a: unknown[]) => lines.push(a), trace: (...a: unknown[]) => lines.push(a) };
    installConsoleRedaction(sink);
    installConsoleRedaction(sink);
    sink.error(`⨯ Error: ${PII.email}`, new Error(`boom ${PII.niss}`, { cause: new Error(PII.phoneIntl) }), { body: PII.messageBody, area: 'x' });
    sink.warn('area=%s', `auth ${PII.jwt}`);
    expect(lines).toHaveLength(2);
    expectNoPii(JSON.stringify(lines));
    expect(JSON.stringify(lines)).toContain('"area":"x"');
    expect(lines[1]?.[0]).toBe('area=%s');
  });
});

describe('strażnik konfiguracji telemetrii', () => {
  it('brak konfiguracji Sentry; instrumentation rejestruje webhook błędów i redakcję logów', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    for (const file of ['sentry.client.config.ts', 'sentry.server.config.ts', 'sentry.edge.config.ts']) {
      expect(existsSync(file), file).toBe(false);
    }
    const instrumentation = readFileSync('src/instrumentation.ts', 'utf8');
    expect(instrumentation).toContain('installConsoleRedaction()');
    expect(instrumentation).toContain('installErrorWebhook()');
    expect(instrumentation).toContain('onRequestError = reportRequestError');
  });
});
