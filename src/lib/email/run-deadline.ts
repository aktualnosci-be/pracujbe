import { MailSendError, type MailMessage, type MailSendOptions } from '@/lib/email/transport';

/**
 * Wspólny kontrakt czasu przebiegu kolejek poczty (#731) — `/api/email/process` uruchamia
 * równolegle kolejkę domenową (`email_deliveries`) i kolejkę kont (`auth.email_outbox`).
 *
 * Wartości są ze sobą powiązane (test `email-run-deadline` pilnuje nierówności):
 *
 * - caller (Cloudflare Worker / cron Railway) czeka najwyżej `CRON_CALLER_TIMEOUT_MS` (120 s,
 *   `CRON_TIMEOUT_SECONDS` w `infra/cloudflare-cron/wrangler.toml`);
 * - przebieg kończy pracę przed `EMAIL_RUN_BUDGET_MS` (90 s) — zapas na odpowiedź HTTP i zapis
 *   wyników, więc caller nie oznacza poprawnego przebiegu jako timeout;
 * - pojedyncza wysyłka startuje tylko, gdy do końca budżetu zostało co najmniej
 *   `EMAIL_MIN_SEND_WINDOW_MS` (25 s ≥ sprawdzenie GET + POST EmailLabs po 10 s), a jej termin to
 *   mniejsza z wartości: własny limit wysyłki i pozostały budżet przebiegu;
 * - dzierżawa wiersza (300 s) jest dłuższa niż cały przebieg, więc rekord nie wraca do puli
 *   w trakcie przebiegu, który go trzyma — drugi, nakładający się przebieg go nie dostanie.
 *
 * Rekordów, których przebieg nie zdążył wysłać, NIE liczymy jako porażek: wracają do kolejki
 * bez zużycia próby, a przebieg zwraca `ok: false` (503 — zaległość widać w monitoringu).
 */
export const CRON_CALLER_TIMEOUT_MS = 120_000;
export const EMAIL_RUN_BUDGET_MS = 90_000;
export const EMAIL_MIN_SEND_WINDOW_MS = 25_000;

export interface RunDeadline {
  /** Milisekundy do końca budżetu (≤ 0 = po terminie albo przerwane żądanie). */
  remainingMs(): number;
  /** `true` = nowej wysyłki nie zaczynamy (za mało czasu albo caller się rozłączył). */
  exhausted(minWindowMs?: number): boolean;
  /** Przerwane żądanie callera (rozłączenie) — sygnał do kontrolowanego zatrzymania. */
  readonly signal?: AbortSignal;
}

export function createRunDeadline(options: {
  budgetMs?: number;
  signal?: AbortSignal;
  now?: () => number;
} = {}): RunDeadline {
  const now = options.now ?? Date.now;
  const end = now() + (options.budgetMs ?? EMAIL_RUN_BUDGET_MS);
  const signal = options.signal;
  const remainingMs = () => (signal?.aborted ? 0 : end - now());
  return {
    remainingMs,
    exhausted: (minWindowMs = EMAIL_MIN_SEND_WINDOW_MS) => remainingMs() < minWindowMs,
    signal,
  };
}

/** Wysyłka przerwana terminem — wynik u dostawcy nieznany (ponowienie z tym samym kluczem). */
export class SendDeadlineError extends MailSendError {
  constructor() {
    super('provider_unavailable');
    this.name = 'SendDeadlineError';
  }
}

/** Minimalny kontrakt nadawcy (transport albo atrapa w testach). */
export interface DeadlineSender {
  send(message: MailMessage, options: MailSendOptions): Promise<{ id: string }>;
}

/**
 * Jedna wysyłka z twardym terminem: po `timeoutMs` albo przerwaniu żądania callera przerywa
 * żądanie dostawcy (sygnał — EmailLabs) i przestaje na nie czekać (Resend bez sygnału).
 * Spóźniony wynik jest pomijany bez nieobsłużonego odrzucenia.
 */
export async function sendWithDeadline(
  sender: DeadlineSender,
  message: MailMessage,
  idempotencyKey: string,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<{ id: string }> {
  if (timeoutMs <= 0 || parentSignal?.aborted) throw new SendDeadlineError();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    const stop = () => {
      controller.abort();
      reject(new SendDeadlineError());
    };
    timer = setTimeout(stop, timeoutMs);
    onAbort = stop;
    parentSignal?.addEventListener('abort', stop, { once: true });
  });
  const sending = sender.send(message, { idempotencyKey, signal: controller.signal });
  sending.catch(() => undefined);
  try {
    return await Promise.race([sending, deadline]);
  } finally {
    clearTimeout(timer);
    if (onAbort) parentSignal?.removeEventListener('abort', onAbort);
  }
}
