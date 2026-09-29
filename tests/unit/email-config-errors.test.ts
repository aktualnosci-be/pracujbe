// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emailFromEnv, emailFromProblem, marketingSenderFromEnv } from '@/lib/email/sender';
import { parseMailbox } from '@/lib/email/mailbox';
import { sendErrorFor } from '@/lib/email/transport/emaillabs';
import { MailSendError } from '@/lib/email/transport';
import { readinessChecks } from '@/lib/env';
import { evaluateOps, type OpsMetrics } from '@/lib/ops/sensors';
import { buildOpsRows } from '@/lib/ops/dashboard';
import { parseRequeueArgs } from '../../scripts/db/requeue-failed-emails.mjs';

/**
 * #1214 (OPS-1): błąd konfiguracji nadawcy/dostawcy jest wspólny dla wszystkich listów — nie może
 * trwale kończyć każdego wiersza jako `failed` po pierwszej próbie. Tu: normalizacja `EMAIL_FROM`,
 * gotowość `/api/health`, klasyfikacja odpowiedzi EmailLabs, czujki `/api/health/ops`, panel
 * i argumenty skryptu ponownego zakolejkowania. Worker: `email-outbox-lease.test.ts` (#1214),
 * kolejka kont: `auth-email-worker.test.ts`.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('EMAIL_FROM — normalizacja i walidacja', () => {
  it('zdejmuje otaczające cudzysłowy z .env.example', () => {
    expect(emailFromEnv({ EMAIL_FROM: '"Pracuj.be <no-reply@pracuj.be>"' })).toBe('Pracuj.be <no-reply@pracuj.be>');
    expect(emailFromEnv({ EMAIL_FROM: "'no-reply@pracuj.be'" })).toBe('no-reply@pracuj.be');
    expect(emailFromProblem({ EMAIL_FROM: '"Pracuj.be <no-reply@pracuj.be>"' })).toBeNull();
    expect(marketingSenderFromEnv({
      EMAIL_FROM: '"Pracuj.be <no-reply@pracuj.be>"', EMAIL_SENDER_IDENTITY: 'X', EMAIL_SENDER_POSTAL_ADDRESS: 'Y',
    })?.from).toBe('Pracuj.be <no-reply@pracuj.be>');
  });

  it('cudzysłów tylko wokół nazwy zostaje bez zmian i jest poprawny', () => {
    expect(emailFromEnv({ EMAIL_FROM: '"Pracuj.be" <no-reply@pracuj.be>' })).toBe('"Pracuj.be" <no-reply@pracuj.be>');
    expect(emailFromProblem({ EMAIL_FROM: '"Pracuj.be" <no-reply@pracuj.be>' })).toBeNull();
  });

  it.each([
    'Pracuj.be no-reply@pracuj.be',
    'Pracuj.be',
    '"Pracuj.be <no-reply@pracuj.be>',
    '<no-reply>',
    'x'.repeat(301) + '@pracuj.be',
  ])('nieużywalny EMAIL_FROM %j = invalid', (value) => {
    expect(emailFromProblem({ EMAIL_FROM: value })).toBe('invalid');
  });

  it('brak EMAIL_FROM = domyślny nadawca, bez problemu', () => {
    expect(emailFromProblem({})).toBeNull();
    expect(emailFromProblem({ EMAIL_FROM: '  ' })).toBeNull();
    expect(parseMailbox(emailFromEnv({}))).not.toBeNull();
  });

  it('/api/health: emailProviderReady=false przy nieużywalnym nadawcy mimo kompletu kluczy', () => {
    vi.stubEnv('EMAIL_PROVIDER', 'resend');
    vi.stubEnv('RESEND_API_KEY', 're_live_key');
    vi.stubEnv('EMAIL_FROM', 'Pracuj.be <no-reply@pracuj.be>');
    expect(readinessChecks().emailProviderReady).toBe(true);
    vi.stubEnv('EMAIL_FROM', 'Pracuj.be no-reply@pracuj.be');
    expect(readinessChecks().emailProviderReady).toBe(false);
    expect(readinessChecks().emailSender).toBe(false);
    // Cudzysłowy z .env.example są zdejmowane — nadawca gotowy.
    vi.stubEnv('EMAIL_FROM', '"Pracuj.be <no-reply@pracuj.be>"');
    expect(readinessChecks().emailProviderReady).toBe(true);
  });
});

describe('EmailLabs — klasyfikacja odpowiedzi', () => {
  it.each([
    [401, null, 'configuration_error'],
    [403, null, 'configuration_error'],
    [400, { message: 'smtpAccount not found' }, 'configuration_error'],
    [422, { errors: { from: ['Domain not verified'] } }, 'configuration_error'],
    [400, { errors: [{ message: 'kandydat@example.test invalid' }] }, 'delivery_failed'],
    [207, { message: 'account' }, 'delivery_failed'],
    [429, null, 'provider_unavailable'],
    [503, null, 'provider_unavailable'],
  ] as const)('HTTP %i %j → %s', (status, body, code) => {
    const error = sendErrorFor(status, body);
    expect(error).toBeInstanceOf(MailSendError);
    expect(error.code).toBe(code);
  });
});

function metrics(patch: Partial<OpsMetrics['email']> = {}): OpsMetrics {
  return {
    email: { ready: 0, oldestReadyAgeSeconds: 0, abandonedLeases: 0, failedLast24h: 0, ...patch },
    authEmail: null,
    webhooks: { stuckProcessing: 0, failedLast24h: 0 },
    maintenance: { overdueActiveJobs: 0 },
    connections: { used: 1, max: 100, reserved: 3 },
    mail: null,
  };
}

describe('czujki (#1214, #1227)', () => {
  it('listy odłożone po błędzie konfiguracji = alarm krytyczny email_provider_config', () => {
    expect(evaluateOps(metrics({ configBlocked: 3 })).alerts).toContain('email_provider_config');
    expect(evaluateOps(metrics({ configBlocked: 0 })).alerts).not.toContain('email_provider_config');
    // baza sprzed 0980 (bez pola) — czujka milczy
    expect(evaluateOps(metrics()).status).toBe('ok');
  });

  it('nieużywalny EMAIL_FROM = alarm email_sender_invalid; nie mierzono = bez sygnału', () => {
    expect(evaluateOps(metrics(), null, undefined, undefined, false).alerts).toEqual(['email_sender_invalid']);
    expect(evaluateOps(metrics(), null, undefined, undefined, true).alerts).toEqual([]);
    expect(evaluateOps(metrics()).alerts).toEqual([]);
  });

  it('wygaszone listy (suppressedLast24h) nie dają ostrzeżenia email_failed; porażki dają', () => {
    expect(evaluateOps(metrics({ suppressedLast24h: 40, failedLast24h: 0 })).warnings).not.toContain('email_failed');
    expect(evaluateOps(metrics({ failedLast24h: 1 })).warnings).toContain('email_failed');
  });

  it('panel: wiersz emailConfigBlocked w stanie alarmu', () => {
    const m = metrics({ configBlocked: 2 });
    const evaluation = evaluateOps(m);
    const rows = buildOpsRows({
      alerts: evaluation.alerts,
      warnings: evaluation.warnings,
      metrics: m,
      appPool: null,
      aiBudget: null,
      maintenanceRun: undefined,
      backup: { status: 'ok', ageSeconds: 60, lastBackupAt: '2026-09-29T00:00:00Z' },
    });
    const row = rows.find((r) => r.id === 'emailConfigBlocked');
    expect(row?.state).toBe('alert');
    expect(row?.value).toEqual({ kind: 'count', value: 2 });
  });
});

describe('skrypt requeue-failed-emails — argumenty', () => {
  it('domyślnie dry-run; --apply wymaga --confirm z tą samą liczbą dni', () => {
    expect(parseRequeueArgs(['--days', '3'])).toEqual({ ok: true, days: 3, apply: false, templates: null, errors: null });
    expect(parseRequeueArgs(['--days', '3', '--apply']).ok).toBe(false);
    expect(parseRequeueArgs(['--days', '3', '--apply', '--confirm', '4']).ok).toBe(false);
    expect(parseRequeueArgs(['--days=3', '--apply', '--confirm=3', '--template', 'jobMatch', '--error', 'EMAIL_PROVIDER_REJECTED']))
      .toEqual({ ok: true, days: 3, apply: true, templates: ['jobMatch'], errors: ['EMAIL_PROVIDER_REJECTED'] });
  });

  it.each([[[]], [['--days', '0']], [['--days', '31']], [['--days', 'x']], [['--days', '3', '--template', "a';drop"]], [['--foo']]])(
    'odrzuca %j',
    (argv) => {
      expect(parseRequeueArgs(argv as string[]).ok).toBe(false);
    },
  );
});
