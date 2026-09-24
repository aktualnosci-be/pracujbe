import type * as Sentry from '@sentry/nextjs';
import { FILTERED, redactString, redactStrings, redactUrl, redactValue } from './redact';

/**
 * Filtr zdarzeń Sentry uruchamiany w SDK — PRZED wysłaniem (przeglądarka, Node, Edge).
 * Redakcja po stronie usługi działa dopiero po transmisji, więc tu usuwamy wszystko, co
 * mogłoby nieść dane kandydata: użytkownika, nagłówki/cookies/body żądania, query i fragment
 * URL, wartości w wiadomościach wyjątków (także `cause`), `extra`/`contexts`/tagach,
 * breadcrumbach i spanach. Zostają kody błędów, `area`, UUID-y i ścieżki bez parametrów.
 */

// Typy z opcji `Sentry.init` — bez bezpośredniej zależności od @sentry/core.
type InitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type ErrorEvent = Sentry.ErrorEvent;
type Event = Sentry.Event;
type Breadcrumb = Sentry.Breadcrumb;
type TransactionEvent = Parameters<NonNullable<InitOptions['beforeSendTransaction']>>[0];
type SpanJSON = Parameters<NonNullable<InitOptions['beforeSendSpan']>>[0];
type Integration = Exclude<NonNullable<InitOptions['integrations']>, (...args: never[]) => unknown>[number];
type Client = Parameters<NonNullable<Integration['setup']>>[0];

type AnyEvent = Event & { spans?: SpanJSON[] };

function scrubBreadcrumbInPlace(b: Breadcrumb): Breadcrumb {
  if (typeof b.message === 'string') b.message = redactString(b.message);
  if (b.data) {
    const data = { ...b.data };
    // Argumenty konsoli bywają dowolnymi obiektami domenowymi — wiadomość (po redakcji) wystarcza.
    if (b.category === 'console') {
      delete data.arguments;
    }
    for (const key of ['url', 'from', 'to']) {
      if (typeof data[key] === 'string') data[key] = redactUrl(data[key] as string);
    }
    b.data = redactValue(data);
  }
  return b;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  return scrubBreadcrumbInPlace({ ...breadcrumb });
}

export function scrubSpan<T extends { description?: string; data?: Record<string, unknown> }>(span: T): T {
  if (typeof span.description === 'string') span.description = redactString(span.description);
  if (span.data) span.data = redactValue(span.data);
  return span;
}

/** Konteksty środowiska SDK (nazwa/wersja systemu, przeglądarki, runtime'u) — bez danych użytkownika. */
const SDK_CONTEXTS = new Set(['os', 'browser', 'device', 'runtime', 'app', 'culture', 'cloud_resource']);

function scrubContexts(contexts: NonNullable<Event['contexts']>): NonNullable<Event['contexts']> {
  const out: Record<string, unknown> = {};
  for (const [key, ctx] of Object.entries(contexts)) {
    if (!ctx) continue;
    if (key === 'trace') {
      const { data, ...rest } = ctx as Record<string, unknown>;
      out[key] = { ...redactStrings(rest), ...(data ? { data: redactValue(data) } : {}) };
    } else if (SDK_CONTEXTS.has(key)) {
      out[key] = redactStrings(ctx);
    } else {
      out[key] = redactValue(ctx);
    }
  }
  return out as NonNullable<Event['contexts']>;
}

export function scrubEvent<T extends AnyEvent>(event: T): T {
  // Użytkownik: pseudonim to wciąż dana osobowa — nie wysyłamy nic.
  delete event.user;

  if (event.request) {
    const { method, url } = event.request;
    event.request = {
      ...(method ? { method } : {}),
      ...(url ? { url: redactUrl(url) } : {}),
    };
  }

  if (typeof event.message === 'string') event.message = redactString(event.message);
  if (event.logentry) {
    if (typeof event.logentry.message === 'string') event.logentry.message = redactString(event.logentry.message);
    if (event.logentry.params) event.logentry.params = event.logentry.params.map(() => FILTERED);
  }
  if (typeof event.transaction === 'string') event.transaction = redactString(event.transaction);

  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = redactString(ex.value);
    if (ex.mechanism?.data) ex.mechanism.data = redactValue(ex.mechanism.data);
    for (const frame of ex.stacktrace?.frames ?? []) {
      delete frame.vars;
    }
  }

  if (event.extra) event.extra = redactValue(event.extra);
  if (event.contexts) event.contexts = scrubContexts(event.contexts);
  if (event.tags) event.tags = redactValue(event.tags);
  if (event.fingerprint) event.fingerprint = event.fingerprint.map(redactString);

  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map((b) => scrubBreadcrumbInPlace({ ...b }));
  if (event.spans) event.spans = event.spans.map((s) => scrubSpan(s));

  return event;
}

/**
 * Nagłówek koperty (dynamic sampling context) niesie nazwę transakcji poza `beforeSend*`
 * i bywa ustawiany przez integracje po naszych hookach — redagujemy go tuż przed wysłaniem.
 */
export function privacyIntegration(): Integration {
  return {
    name: 'PracujbePrivacy',
    setup(client: Client) {
      client.on('beforeEnvelope', (envelope) => {
        const trace = envelope[0].trace as { transaction?: unknown } | undefined;
        if (trace && typeof trace.transaction === 'string') trace.transaction = redactString(trace.transaction);
      });
    },
  };
}

/** Wspólne opcje prywatności dla `Sentry.init` we wszystkich runtime'ach. */
export const sentryPrivacyOptions = {
  sendDefaultPii: false,
  // Bez nagłówków `sentry-trace`/`baggage` w żądaniach do usług zewnętrznych.
  tracePropagationTargets: [] as string[],
  integrations: (defaults: Integration[]): Integration[] => [...defaults, privacyIntegration()],
  beforeSend: (event: ErrorEvent): ErrorEvent => scrubEvent(event),
  beforeSendTransaction: (event: TransactionEvent): TransactionEvent => scrubEvent(event),
  beforeSendSpan: (span: SpanJSON): SpanJSON => scrubSpan(span),
  beforeBreadcrumb: (breadcrumb: Breadcrumb): Breadcrumb | null => scrubBreadcrumb(breadcrumb),
} as const;

/** Błędy rozszerzeń przeglądarki nie dotyczą aplikacji, a ich stack niesie cudze URL-e. */
export const sentryClientDenyUrls: RegExp[] = [/^(?:chrome|moz|safari(?:-web)?)-extension:\/\//i, /^webkit-masked-url:/i];
