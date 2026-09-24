'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Loader2, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TURNSTILE_ACTIONS, turnstileSiteKey, type TurnstileFlow } from '@/lib/turnstile/policy';

/**
 * Widżet Cloudflare Turnstile (#46). Bez `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (demo/E2E) nic nie
 * renderuje i nie ładuje skryptu. Skrypt ładowany jest tylko na stronie z chronionym
 * formularzem — to ochrona niezbędna, nie tracking (Invariant #7), więc nie czeka na zgodę.
 *
 * Gdy skrypt się nie załaduje (blokada treści, awaria sieci), pokazujemy komunikat i przycisk
 * ponownego ładowania; przycisk wysyłki formularza nie jest martwy — wysyłka bez tokenu
 * pokazuje jasny komunikat przy widżecie.
 */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SCRIPT_ID = 'cf-turnstile-script';
/** Po tym czasie bez `window.turnstile` uznajemy, że skrypt się nie załadował. */
const LOAD_TIMEOUT_MS = 15000;
/** Poniżej tej szerokości kontenera widżet `flexible` (min. 300 px) by się nie mieścił. */
const FLEXIBLE_MIN_WIDTH = 300;

interface TurnstileRenderOptions {
  sitekey: string;
  action: string;
  language?: string;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'flexible' | 'compact';
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => boolean | void;
  'timeout-callback'?: () => void;
}

interface TurnstileApi {
  render: (el: HTMLElement, options: TurnstileRenderOptions) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Czy widżet jest aktywny w tym buildzie (klucz witryny ustawiony). */
export function isTurnstileWidgetEnabled(): boolean {
  return Boolean(turnstileSiteKey());
}

/** Ładuje skrypt Turnstile raz na stronę; kolejne wywołania czekają na to samo ładowanie. */
function loadScript(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    const timer = window.setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS);
    script.addEventListener('load', () => {
      window.clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('missing_api'));
    });
    script.addEventListener('error', () => {
      window.clearTimeout(timer);
      // Usuwamy nieudany skrypt, żeby „Załaduj ponownie” mogło spróbować od nowa.
      script?.remove();
      reject(new Error('load_error'));
    });
  });
}

export interface TurnstileHandle {
  /** Unieważnia bieżący token i prosi o nowy (token jest jednorazowy). */
  reset: () => void;
}

export interface TurnstileWidgetProps {
  flow: TurnstileFlow;
  /** Nowy token albo `null` (wygasł / błąd / reset). */
  onToken: (token: string | null) => void;
  /** Formularz próbował wysłać bez tokenu — pokaż komunikat przy widżecie. */
  showRequired?: boolean;
}

type WidgetState = 'loading' | 'ready' | 'expired' | 'failed';

export const TurnstileWidget = React.forwardRef<TurnstileHandle, TurnstileWidgetProps>(
  function TurnstileWidget({ flow, onToken, showRequired = false }, ref) {
    const t = useTranslations('auth');
    const locale = useLocale();
    const siteKey = turnstileSiteKey();
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const widgetIdRef = React.useRef<string | undefined>(undefined);
    const onTokenRef = React.useRef(onToken);
    onTokenRef.current = onToken;
    const [state, setState] = React.useState<WidgetState>('loading');
    const [attempt, setAttempt] = React.useState(0);
    const statusId = React.useId();

    React.useImperativeHandle(ref, () => ({
      reset: () => {
        onTokenRef.current(null);
        if (widgetIdRef.current !== undefined) window.turnstile?.reset(widgetIdRef.current);
      },
    }));

    React.useEffect(() => {
      if (!siteKey) return;
      let cancelled = false;
      setState('loading');
      loadScript()
        .then((api) => {
          const el = containerRef.current;
          if (cancelled || !el) return;
          widgetIdRef.current = api.render(el, {
            sitekey: siteKey,
            action: TURNSTILE_ACTIONS[flow],
            language: locale,
            theme: 'light',
            size: el.clientWidth > 0 && el.clientWidth < FLEXIBLE_MIN_WIDTH ? 'compact' : 'flexible',
            callback: (token) => {
              setState('ready');
              onTokenRef.current(token);
            },
            'expired-callback': () => {
              setState('expired');
              onTokenRef.current(null);
            },
            'timeout-callback': () => {
              setState('expired');
              onTokenRef.current(null);
            },
            'error-callback': () => {
              onTokenRef.current(null);
              // false = Turnstile sam ponawia wyzwanie; komunikat pokazujemy dopiero przy
              // braku skryptu (niżej). Tu tylko czyścimy token.
              return false;
            },
          });
          setState('ready');
        })
        .catch(() => {
          if (!cancelled) {
            onTokenRef.current(null);
            setState('failed');
          }
        });
      return () => {
        cancelled = true;
        if (widgetIdRef.current !== undefined) {
          window.turnstile?.remove(widgetIdRef.current);
          widgetIdRef.current = undefined;
        }
      };
    }, [siteKey, flow, locale, attempt]);

    if (!siteKey) return null;

    let message: string | null = null;
    if (state === 'failed') message = t('botCheckLoadFailed');
    else if (state === 'expired') message = t('botCheckExpired');
    else if (showRequired) message = t('botCheckRequired');

    return (
      <div role="group" aria-label={t('botCheckLabel')} className="space-y-2">
        <div ref={containerRef} className="min-h-[65px] w-full max-w-full overflow-hidden" />
        {state === 'loading' ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('botCheckLoading')}
          </p>
        ) : null}
        <div id={statusId} aria-live="polite">
          {message ? (
            <p className="flex items-start gap-2 text-sm text-error">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{message}</span>
            </p>
          ) : null}
        </div>
        {state === 'failed' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAttempt((n) => n + 1)}
            aria-describedby={statusId}
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
            {t('botCheckRetry')}
          </Button>
        ) : null}
      </div>
    );
  },
);
