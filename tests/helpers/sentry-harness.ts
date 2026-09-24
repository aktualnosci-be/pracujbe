// Wspólny zestaw zdarzeń dla testu SDK (#502) i jego kontroli ujemnej.
import * as Sentry from '@sentry/nextjs';
import { AppError } from '@/lib/errors';
import { sentryPrivacyOptions } from '@/lib/privacy/sentry-scrub';
import { PII } from './privacy-fixtures';

export const sent: string[] = [];

export function init(withPrivacy: boolean): void {
  Sentry.init({
    dsn: 'https://public@o0.ingest.sentry.io/0',
    tracesSampleRate: 1,
    defaultIntegrations: false,
    transport: (options: Parameters<typeof Sentry.createTransport>[0]) =>
      Sentry.createTransport(options, async (request) => {
        sent.push(typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body));
        return { statusCode: 200 };
      }),
    ...(withPrivacy ? sentryPrivacyOptions : { sendDefaultPii: true }),
    integrations: (defaults) => {
      const own = [Sentry.linkedErrorsIntegration(), ...defaults];
      return withPrivacy ? sentryPrivacyOptions.integrations(own) : own;
    },
  });
}

export async function emitAll(): Promise<void> {
  const { captureError } = await import('@/lib/sentry');
  const { onRequestError } = await import('@/instrumentation');

  Sentry.addBreadcrumb({ category: 'fetch', message: `POST /api?e=${PII.email}`, data: { url: `https://pracuj.be/api/x?token=${PII.token}`, body: PII.messageBody } });

  const providerError = new Error(`insert failed: Key (email)=(${PII.email}) Failing row contains (${PII.firstName}, ${PII.lastName})`);
  captureError(
    new AppError('INTERNAL', { cause: providerError, context: { area: 'candidate.profile', bio: PII.bio, phone: PII.phoneIntl } }),
    { area: 'candidate.profile', fileName: PII.cvFile, niss: PII.niss, message: PII.messageBody },
  );

  await onRequestError(
    new Error(`render failed for ${PII.email} ${PII.nissPlain}`),
    {
      path: `/pl/aplikacja/potwierdz?token=${PII.token}`,
      method: 'GET',
      headers: { cookie: `pb_session=${PII.jwt}`, 'x-forwarded-for': '203.0.113.9' },
    },
    { routerKind: 'App Router', routePath: '/[locale]/aplikacja/potwierdz', routeType: 'render', renderSource: 'react-server-components', revalidateReason: undefined, renderType: 'dynamic' } as never,
  );

  Sentry.startSpan({ name: `GET /pl/aplikacja/przejmij?token=${PII.token}`, attributes: { 'url.full': `https://pracuj.be/x?e=${PII.email}` } }, () => {
    Sentry.startSpan({ name: `select where email = '${PII.email}'` }, () => undefined);
  });

  await Sentry.flush(2000);
}
