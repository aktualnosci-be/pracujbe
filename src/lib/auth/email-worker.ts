import 'server-only';

import { renderEmail } from '@/emails/templates';
import { emailFromEnv, emailFromProblem, replyToFromEnv } from '@/lib/email/sender';
import { env, isAuthMailConfigured, isPortalAuthConfigured, isProductionMode } from '@/lib/env';
import { captureError } from '@/lib/error-report';
import {
  emailProviderFromEnv,
  mailTransportFromEnv,
  MailSendError,
  type MailErrorCode,
  type MailMessage,
  type MailSendOptions,
} from '@/lib/email/transport';
import { resendTransport } from '@/lib/email/transport/resend';
import {
  createRunDeadline,
  EMAIL_MIN_SEND_WINDOW_MS,
  sendWithDeadline,
  type RunDeadline,
} from '@/lib/email/run-deadline';
import {
  claimAuthEmails,
  completeAuthEmail,
  deferAuthEmail,
  expireAuthEmails,
  failAuthEmail,
  prepareAuthEmail,
  takeAuthSendBudget,
  type AuthEmailDelivery,
  type AuthSendBudget,
} from './email-outbox';

export interface AuthEmailProcessResult {
  processed: number;
  sent: number;
  failed: number;
  expired: number;
  /**
   * Dostawca przyjął list, ale `complete_email` odmówił (dzierżawę przejął inny worker albo
   * wygasła). Zlecenie nie jest liczone jako wysłane; ponowienie używa tego samego klucza
   * idempotencji, więc dostawca nie wyśle drugiego listu (#78).
   */
  stale?: number;
  /** Dostawca przyjął list, a zapis potwierdzenia w bazie zawiódł — alarm dla cronu. */
  ackErrors?: number;
  /**
   * Okno dostawcy pełne (budżet puli `auth`, 0137): zlecenia wróciły do kolejki bez zużycia
   * próby i wyjdą w następnym oknie. To nie jest błąd — `ok` bez zmian.
   */
  deferred?: number;
  /**
   * #731: zlecenia zwolnione BEZ próby wysyłki, bo skończył się budżet czasu przebiegu, caller
   * przerwał żądanie albo dzierżawa paczki nie wystarczała na bezpieczną wysyłkę. Wracają do
   * kolejki bez zużycia próby, nie są liczone jako `failed`; przebieg zwraca `ok: false`.
   */
  deadlineDeferred?: number;
  /**
   * #731: zlecenia, których dzierżawa wygasła, zanim worker je obsłużył (nie dało się ich ani
   * wysłać, ani odłożyć, ani zapisać porażki) — wrócą do puli same. Nie są liczone jako `failed`;
   * przebieg zwraca `ok: false`.
   */
  leaseLost?: number;
  skipped?: string;
  /** `false` = realny problem (brak konfiguracji w produkcji, błąd claimu/ACK) → 503 dla cronu. */
  ok: boolean;
}

export type AuthMailErrorCode = MailErrorCode;

/**
 * Błąd wysyłki z ustalonym kodem — bez komunikatu dostawcy (może zawierać adres lub link).
 * Ten sam typ dla każdego transportu (`src/lib/email/transport`).
 */
/** #1214: po błędzie konfiguracji kolejka kont czeka tyle przed kolejną próbą. */
export const AUTH_CONFIG_RETRY_MS = 10 * 60_000;

/** #731: dzierżawa paczki kont (sekundy) — dłuższa niż cały przebieg (`EMAIL_RUN_BUDGET_MS`). */
export const AUTH_EMAIL_LEASE_SECONDS = 300;
/** #731: twardy termin pojedynczej wysyłki listu konta (jak `SEND_DEADLINE_MS` kolejki domenowej). */
export const AUTH_SEND_DEADLINE_MS = 60_000;

export const AuthMailSendError = MailSendError;
export type AuthMailSendError = MailSendError;

export { classifyProviderError } from '@/lib/email/transport/resend';

type MailPool = Parameters<typeof claimAuthEmails>[0];

/** Minimalny kontrakt nadawcy (atrapy w testach); produkcja = `MailTransport`. */
export interface MailSender {
  send(message: MailMessage, options: MailSendOptions): Promise<{ id: string }>;
}

/** Transport Resend z klasyfikacją błędów (eksport dla testów i zgodności). */
export function resendSender(apiKey: string): MailSender {
  return resendTransport(apiKey);
}

/**
 * Jedna paczka kolejki `auth.email_outbox` (0061): potwierdzenie adresu i reset hasła.
 * Pula ma wyłącznie rolę `pracujbe_auth_mail` (claim/complete/fail/expire), bez tabel domeny.
 * Klucz idempotencji transportu = UUID zlecenia (Resend: Idempotency-Key, EmailLabs: stały
 * messageId + sprawdzenie przed wysyłką), więc ponowienie po utraconej odpowiedzi nie wysyła
 * drugiego listu. Token nigdy nie trafia do logów ani kanału błędów; po wysyłce baza go usuwa.
 */
export async function processAuthEmailBatch(
  pool: MailPool,
  sender: MailSender,
  options: {
    baseURL: string;
    from: string;
    /** `EMAIL_REPLY_TO` (Reply-To); brak = bez nagłówka. */
    replyTo?: string | null;
    limit?: number;
    /** #731: budżet czasu przebiegu (wspólny z kolejką domenową) i przerwanie żądania callera. */
    deadline?: RunDeadline;
    now?: () => number;
  },
): Promise<AuthEmailProcessResult> {
  const deadline = options.deadline ?? createRunDeadline({ now: options.now });
  const now = options.now ?? Date.now;
  let expired = 0;
  let queue: AuthEmailDelivery[];
  try {
    expired = await expireAuthEmails(pool);
    // #731: przebieg, który już nie zdąży wysłać listu, nie rezerwuje nowych zleceń.
    queue = deadline.exhausted() ? [] : await claimAuthEmails(pool, options.limit ?? 20, AUTH_EMAIL_LEASE_SECONDS);
  } catch (error) {
    captureError(error, { area: 'auth.email.claim' });
    return { processed: 0, sent: 0, failed: 0, expired, skipped: 'claim error', ok: false };
  }

  let sent = 0;
  let failed = 0;
  let stale = 0;
  let ackErrors = 0;
  let deferred = 0;
  let configBlocked = false;
  let deadlineDeferred = 0;
  let leaseLost = 0;
  /** Odłożenie bez zużycia próby; utracona dzierżawa = `leaseLost` (zlecenie wróci samo). */
  const release = async (pending: AuthEmailDelivery) => {
    if (await deferAuthEmail(pool, pending, null).catch(() => false)) deadlineDeferred += 1;
    else leaseLost += 1;
  };
  /** Zapis porażki próby; gdy dzierżawa już nie nasza — `leaseLost`, nie `failed`. */
  const recordFailure = async (pending: AuthEmailDelivery, code: Parameters<typeof failAuthEmail>[2]) => {
    let recorded: boolean;
    try {
      recorded = await failAuthEmail(pool, pending, code);
    } catch {
      // Błąd zapisu: próba się odbyła i zawiodła; dzierżawa wygaśnie, zlecenie wróci do kolejki.
      recorded = true;
    }
    if (recorded) failed += 1;
    else leaseLost += 1;
  };
  for (const [index, delivery] of queue.entries()) {
    // #731: przed każdym listem — czy budżet przebiegu i dzierżawa wystarczą na kontrolowaną
    // wysyłkę. Jeśli nie, to i pozostałe zlecenia wracają do kolejki (bez próby, bez `failed`).
    const leaseLeftMs = delivery.lease_expires_at.getTime() - now();
    if (deadline.exhausted() || leaseLeftMs < EMAIL_MIN_SEND_WINDOW_MS) {
      for (const pending of queue.slice(index)) await release(pending);
      break;
    }
    let message: { subject: string; html: string; text: string };
    let prepared: ReturnType<typeof prepareAuthEmail>;
    try {
      prepared = prepareAuthEmail(delivery, options.baseURL);
      message = await renderEmail(prepared.template, prepared.locale, prepared.data);
    } catch (error) {
      captureError(error, { area: 'auth.email.render', kind: delivery.kind });
      await recordFailure(delivery, 'render_failed');
      continue;
    }
    // Budżet okna dostawcy (pula `auth`, #45/0137) — po renderze, tuż przed wysyłką. Odmowa:
    // to i pozostałe pobrane zlecenia wracają do kolejki bez zużycia próby. Awaria poboru nie
    // blokuje listu konta (fail-open, jak dawny hook): limit dostawcy zostaje ostatnią granicą.
    let budget: AuthSendBudget;
    try {
      budget = await takeAuthSendBudget(pool, prepared.template);
    } catch (error) {
      captureError(error, { area: 'auth.email.budget', kind: delivery.kind });
      budget = { granted: true };
    }
    if (!budget.granted) {
      for (const pending of queue.slice(index)) {
        if (await deferAuthEmail(pool, pending, budget.retryAt).catch(() => false)) deferred += 1;
      }
      break;
    }
    // #731: termin wysyłki = najmniejszy z: limitu listu, budżetu przebiegu i dzierżawy (z zapasem
    // na zapis wyniku). Zabraknie czasu po renderze/budżecie — zlecenie wraca bez próby.
    const sendTimeoutMs = Math.min(
      AUTH_SEND_DEADLINE_MS,
      deadline.remainingMs(),
      delivery.lease_expires_at.getTime() - now() - 5_000,
    );
    if (sendTimeoutMs <= 0) {
      for (const pending of queue.slice(index)) await release(pending);
      break;
    }
    let providerMessageId: string;
    try {
      providerMessageId = (await sendWithDeadline(
        sender,
        { from: options.from, to: prepared.to, ...message, ...(options.replyTo ? { replyTo: options.replyTo } : {}) },
        prepared.idempotencyKey,
        sendTimeoutMs,
        deadline.signal,
      )).id;
    } catch (error) {
      if (error instanceof MailSendError && error.code === 'configuration_error') {
        // #1214: błąd konfiguracji nadawcy/dostawcy dotyczy każdego listu — to i pozostałe
        // zlecenia wracają do kolejki bez zużycia próby (jak odmowa budżetu); alarm przez 503.
        captureError(error, { area: 'auth.email.config', kind: delivery.kind });
        const retryAt = new Date(Date.now() + AUTH_CONFIG_RETRY_MS);
        for (const pending of queue.slice(index)) {
          if (await deferAuthEmail(pool, pending, retryAt).catch(() => false)) deferred += 1;
        }
        configBlocked = true;
        break;
      }
      // Nieznany wyjątek (np. przerwane połączenie) traktujemy jak chwilową niedostępność.
      const code = error instanceof MailSendError && error.code !== 'configuration_error' ? error.code : 'provider_unavailable';
      captureError(new MailSendError(code), { area: 'auth.email.send', kind: delivery.kind });
      // Dzierżawa wygaśnie sama, gdy zapis porażki też się nie uda — zlecenie wróci do kolejki.
      await recordFailure(delivery, code);
      continue;
    }
    // Dostawca przyjął list. Od tej chwili NIE wołamy fail_email (to przywróciłoby próbę jako
    // porażkę); gdy potwierdzenie się nie zapisze, dzierżawa wygaśnie, a ponowienie z tym samym
    // kluczem idempotencji nie wyśle drugiego listu.
    try {
      if (await completeAuthEmail(pool, delivery, providerMessageId)) sent += 1;
      else stale += 1;
    } catch (error) {
      captureError(error, { area: 'auth.email.ack', kind: delivery.kind });
      ackErrors += 1;
    }
  }
  return {
    processed: queue.length,
    sent,
    failed,
    expired,
    stale,
    ackErrors,
    deferred,
    ...(deadlineDeferred > 0 ? { deadlineDeferred } : {}),
    ...(leaseLost > 0 ? { leaseLost } : {}),
    ...(configBlocked ? { skipped: 'email provider configuration error' } : {}),
    ok: ackErrors === 0 && !configBlocked && deadlineDeferred === 0 && leaseLost === 0,
  };
}

/**
 * Wywołanie z `/api/email/process` (cron Railway). Bez kont PostgreSQL (tryb demo / przed
 * przepięciem) kolejka nie istnieje → pominięcie bez alarmu. Konta skonfigurowane, a brak loginu
 * workera, dostawcy poczty (`EMAIL_PROVIDER`) lub kanonicznego origin w produkcji → `ok: false` (listy nie wychodzą).
 */
export async function processAuthEmailQueue(
  limit = 20,
  options: { deadline?: RunDeadline } = {},
): Promise<AuthEmailProcessResult> {
  const empty = { processed: 0, sent: 0, failed: 0, expired: 0 };
  if (!isPortalAuthConfigured()) return { ...empty, skipped: 'auth not configured', ok: true };
  const transport = mailTransportFromEnv();
  const baseURL = env.authBaseUrl;
  // #1214: nieużywalny `EMAIL_FROM` — nie pobieramy kolejki (listy czekają, próby niezużyte).
  if (transport && emailFromProblem()) {
    return { ...empty, skipped: 'email sender invalid', ok: !isProductionMode() };
  }
  if (!isAuthMailConfigured() || !transport || !baseURL) {
    const reason = !transport && emailProviderFromEnv().provider === null
      ? 'email provider not configured'
      : 'auth mail not configured';
    return { ...empty, skipped: reason, ok: !isProductionMode() };
  }
  try {
    const { getAuthMailPool } = await import('@/lib/db/runtime');
    return await processAuthEmailBatch(await getAuthMailPool(), transport, {
      baseURL,
      from: emailFromEnv(),
      replyTo: replyToFromEnv(),
      limit,
      ...(options.deadline ? { deadline: options.deadline } : {}),
    });
  } catch (error) {
    captureError(error, { area: 'auth.email.worker' });
    return { ...empty, skipped: 'worker error', ok: false };
  }
}
