import { redactError, redactString, redactValue } from './redact';

/**
 * Redakcja logów serwera (Railway zbiera stdout/stderr) tymi samymi regułami co Sentry.
 * Next.js i biblioteki logują błędy przez `console.*` — owijamy te metody raz, w
 * `src/instrumentation.ts`, zanim wystartuje obsługa żądań.
 */

const LEVELS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
const INSTALLED = Symbol.for('pracujbe.consoleRedaction');

export function redactLogArg(arg: unknown): unknown {
  if (typeof arg === 'string') return redactString(arg);
  if (arg instanceof Error) return redactError(arg);
  if (arg !== null && typeof arg === 'object') return redactValue(arg);
  return arg;
}

type ConsoleLike = Pick<Console, (typeof LEVELS)[number]>;

export function installConsoleRedaction(target: ConsoleLike = console): void {
  const marked = target as ConsoleLike & { [INSTALLED]?: true };
  if (marked[INSTALLED]) return;
  for (const level of LEVELS) {
    const original = target[level].bind(target) as (...args: unknown[]) => void;
    target[level] = (...args: unknown[]) => original(...args.map(redactLogArg));
  }
  marked[INSTALLED] = true;
}
