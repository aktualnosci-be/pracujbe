// @vitest-environment node
import { Pool } from 'pg';
import type { BetterAuthOptions } from 'better-auth';
import { describe, expect, it, vi } from 'vitest';
import { createAuthServer } from '@/lib/auth/server';
import {
  authorizeSignupRequest,
  signupMetadataForUser,
  withCandidateSignup,
  withEmployerSignup,
} from '@/lib/auth/signup-context';

const baseURL = 'https://auth.example.invalid';
const secret = 'auth-adapter-test-secret-not-for-production-0123456789';

describe('Fabryka auth odrzuca konfigurację przed otwarciem połączenia', () => {
  it.each(['http://pracuj.be', 'https://user:password@pracuj.be', 'https://pracuj.be/auth', 'https://pracuj.be?origin=other', 'not-a-url'])('odrzuca origin %s', async invalid => {
    const pool = new Pool();
    const connect = vi.spyOn(pool, 'connect');
    try {
      expect(() => createAuthServer({ pool, baseURL: invalid, secret, sendVerificationEmail: async () => {}, sendResetPassword: async () => {} })).toThrow('kanonicznego origin HTTPS');
      expect(connect).not.toHaveBeenCalled();
    } finally {
      await pool.end();
    }
  });

  it('nie korzysta z domyślnego słabego sekretu biblioteki', async () => {
    const pool = new Pool();
    const connect = vi.spyOn(pool, 'connect');
    try {
      expect(() => createAuthServer({ pool, baseURL, secret: 'short', sendVerificationEmail: async () => {}, sendResetPassword: async () => {} })).toThrow('co najmniej 32 znaków');
      expect(connect).not.toHaveBeenCalled();
    } finally {
      await pool.end();
    }
  });

  it('logger SDK nie wypisuje surowych komunikatów, parametrów SQL ani poświadczeń', async () => {
    const pool = new Pool();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const auth = createAuthServer({ pool, baseURL, secret });
      const logger: NonNullable<BetterAuthOptions['logger']> = auth.options.logger!;
      logger.log?.('error', 'sensitive-token@example.invalid', { token: 'private-reset-token', sql: 'secret query' });
      logger.log?.('warn', 'private-reset-token');
      expect(error.mock.calls).toEqual([['AUTH_SDK_ERROR']]);
      expect(warning.mock.calls).toEqual([['AUTH_SDK_WARNING']]);
    } finally {
      error.mockRestore();
      warning.mockRestore();
      await pool.end();
    }
  });
});

const candidate = {
  email: '  Applicant@Example.invalid ',
  password: 'CandidatePassword123',
  passwordConfirm: 'CandidatePassword123',
  firstName: ' Anna ',
  lastName: ' Nowak ',
  agreeTerms: true,
  privacyNoticeAck: true,
  ageConfirmed: true,
  minAge: 18,
};

describe('Serwerowy kontekst rejestracji', () => {
  it.each([
    { agreeTerms: false },
    { agreeTerms: undefined },
    { privacyNoticeAck: false },
    { privacyNoticeAck: undefined },
    { marketingOptIn: 'true' },
    // #492: bez deklaracji progu wieku kandydat nie przechodzi do SDK.
    { ageConfirmed: false },
    { minAge: undefined },
    { minAge: 12 },
    { passwordConfirm: 'DifferentPassword123' },
    { password: 'abcdefgh', passwordConfirm: 'abcdefgh' },
    { locale: 'de' },
    { email: 'invalid' },
    { firstName: '' },
  ])('odrzuca niepoprawny formularz przed SDK: %j', async invalid => {
    const action = vi.fn();
    await expect(withCandidateSignup({ ...candidate, ...invalid }, 'pl', action)).rejects.toThrow();
    expect(action).not.toHaveBeenCalled();
  });

  it('odrzuca pracodawcę bez firmy i niepoprawny język zapasowy', async () => {
    const action = vi.fn();
    await expect(withEmployerSignup(candidate, 'pl', action)).rejects.toThrow();
    await expect(withCandidateSignup(candidate, 'de', action)).rejects.toThrow();
    expect(action).not.toHaveBeenCalled();
  });

  it('ustala rolę w kodzie, usuwa dodatkowe pola i normalizuje dane formularza', async () => {
    await withCandidateSignup({
      ...candidate, role: 'admin', companyName: 'Injected',
      raw_user_meta_data: { agree_terms: false, role: 'admin' },
    }, 'fr', async body => {
      expect(body).toEqual({ email: 'applicant@example.invalid', name: 'Anna Nowak', password: candidate.password });
      authorizeSignupRequest(body);
      expect(signupMetadataForUser(body)).toEqual({
        signup_receipt_version: 2, agree_terms: true, privacy_notice_ack: true,
        optional_consents: { email_marketing: false },
        consent_wording: {
          terms: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          privacy: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          email_marketing: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        },
        role: 'candidate', locale: 'fr', first_name: 'Anna', last_name: 'Nowak', age_min_attested: 18,
      });
    });
  });

  it('zgoda na marketing z formularza trafia do markera jako osobny wybór (#493)', async () => {
    await withCandidateSignup({ ...candidate, marketingOptIn: true }, 'pl', async body => {
      authorizeSignupRequest(body);
      expect(signupMetadataForUser(body).optional_consents).toEqual({ email_marketing: true });
    });
  });

  it('nie dopuszcza SDK bez kontekstu, zmienionych danych ani drugiej próby w kontekście', async () => {
    const body = { email: 'applicant@example.invalid', name: 'Anna Nowak', password: candidate.password };
    expect(() => authorizeSignupRequest(body)).toThrow();
    expect(() => signupMetadataForUser(body)).toThrow();
    await withCandidateSignup(candidate, 'pl', async valid => {
      expect(() => signupMetadataForUser(valid)).toThrow();
      expect(() => authorizeSignupRequest({ ...valid, password: 'changed' })).toThrow();
      expect(() => authorizeSignupRequest({ ...valid, email: 'other@example.invalid' })).toThrow();
      authorizeSignupRequest(valid);
      expect(() => signupMetadataForUser({ ...valid, email: 'other@example.invalid' })).toThrow();
      expect(() => authorizeSignupRequest(valid)).toThrow();
    });
    expect(() => authorizeSignupRequest(body)).toThrow();
  });

  it('zamyka uprawnienie także dla zadania odłączonego od zakończonej akcji', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let detached!: Promise<void>;
    await withCandidateSignup(candidate, 'pl', async body => {
      detached = gate.then(() => { authorizeSignupRequest(body); });
    });
    release();
    await expect(detached).rejects.toThrow();
  });

  it('nie przenosi roli i języka między nakładającymi się kontekstami', async () => {
    let ready = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await Promise.all(['pl', 'nl', 'fr', 'en'].map(async locale => {
      const employer = locale === 'nl' || locale === 'en';
      const wrapper = employer ? withEmployerSignup : withCandidateSignup;
      await wrapper({ ...candidate, locale, companyName: 'Firma ' + locale }, 'pl', async body => {
        authorizeSignupRequest(body);
        if (++ready === 4) release();
        await gate;
        const metadata = signupMetadataForUser(body);
        expect(metadata.locale).toBe(locale);
        expect(metadata.role).toBe(employer ? 'employer' : 'candidate');
        expect(metadata.company_name).toBe(employer ? 'Firma ' + locale : undefined);
      });
    }));
  });
});
