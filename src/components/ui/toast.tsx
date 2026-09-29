'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, XCircle, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/**
 * Toast — lekki komunikat zwrotny (np. „✓ Zapisano", błąd zapisu).
 *
 * Prezentacyjny komponent kliencki: renderuje kartę z ikoną (sukces/błąd), treścią
 * (przekazaną już przetłumaczoną) i przyciskiem zamknięcia (aria-label z i18n `nav.close`).
 * Pozycjonowanie i logikę pojawiania/znikania zapewnia ekran-rodzic. `role="status"`
 * + `aria-live` dla czytników ekranu.
 *
 * #1054: komunikat wstawiony razem z własnym `role="status"` bywa niezauważony przez czytnik
 * ekranu (region musi istnieć w DOM przed treścią). Dlatego zalecany sposób to `ToastRegion`:
 * karta trafia do współdzielonego, wcześniej utworzonego regionu na żywo (osobny
 * `role="status"`/polite dla sukcesu i `role="alert"`/assertive dla błędu, w `<body>`, poza
 * treścią strony). Toast w regionie nie ma własnej roli. Błąd nie znika sam (tylko po zamknięciu
 * albo kolejnej akcji, która czyści stan rodzica); sukces znika po `SUCCESS_TOAST_MS`, z pauzą
 * przy najechaniu/fokusie.
 */

/** Czas widoczności komunikatu sukcesu w `ToastRegion` (WCAG 2.2.1: wystarczająco długo). */
export const SUCCESS_TOAST_MS = 8000;

const ToastInRegionContext = React.createContext(false);

export interface ToastProps {
  message: string;
  tone?: 'success' | 'error';
  onClose?: () => void;
  /**
   * Samoczynne zamknięcie (ms) — tylko sukces z `onClose`; błąd nigdy nie znika sam.
   * Czas zatrzymuje się przy najechaniu myszą i fokusie wewnątrz karty.
   */
  autoDismissMs?: number;
}

export function Toast({
  message,
  tone = 'success',
  onClose,
  autoDismissMs,
}: ToastProps): React.JSX.Element {
  const t = useTranslations('nav');
  const inRegion = React.useContext(ToastInRegionContext);
  const isError = tone === 'error';
  const Icon = isError ? XCircle : CheckCircle2;
  const [paused, setPaused] = React.useState(false);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  const dismissMs = !isError && onClose && autoDismissMs && autoDismissMs > 0 ? autoDismissMs : 0;
  React.useEffect(() => {
    if (!dismissMs || paused) return;
    const timer = window.setTimeout(() => onCloseRef.current?.(), dismissMs);
    return () => window.clearTimeout(timer);
  }, [dismissMs, paused, message]);

  return (
    <div
      {...(inRegion ? {} : { role: 'status', 'aria-live': 'polite' as const })}
      onMouseEnter={dismissMs ? () => setPaused(true) : undefined}
      onMouseLeave={dismissMs ? () => setPaused(false) : undefined}
      onFocus={dismissMs ? () => setPaused(true) : undefined}
      onBlur={dismissMs ? () => setPaused(false) : undefined}
      className={cn(
        // `.notice` z prototypu „04 Ludzie i praca” (promień 16 px, linia, 13–15 px) jako komunikat.
        'flex items-start gap-3 rounded-[16px] border bg-card px-5 py-4 shadow-lg',
        isError ? 'border-error/30' : 'border-success/30',
      )}
    >
      <Icon
        className={cn('mt-0.5 h-5 w-5 shrink-0', isError ? 'text-error-text' : 'text-success')}
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 break-words text-[13px] font-[650] leading-[1.5] text-foreground">{message}</p>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="-my-3 -mr-3 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export interface ToastRegionState {
  message: string;
  tone: 'success' | 'error';
  /** Zmiana `id` przy tym samym tekście wymusza ponowne ogłoszenie i restart czasu. */
  id?: number | string;
}

export interface ToastRegionProps {
  toast: ToastRegionState | null;
  onClose: () => void;
  /** Pozycjonowanie karty (domyślnie prawy dolny róg). */
  className?: string;
  /** Czas widoczności sukcesu; błędy nie znikają same. */
  successMs?: number;
}

/**
 * Współdzielony korzeń regionów na żywo (#1054): jeden na stronę, dołączany do `<body>` (poza
 * `<main>` i listami) przy montażu pierwszego `ToastRegion` i usuwany z odmontowaniem ostatniego.
 * Dzięki temu region istnieje w DOM ZANIM pojawi się treść (czytniki ekranu ją ogłaszają), a
 * strony bez toastów — i lista kart z wieloma przyciskami zapisu — nie mają pustych
 * `role="status"`/`role="alert"` w treści.
 */
interface LiveTargets {
  polite: HTMLElement;
  assertive: HTMLElement;
}

let liveRoot: HTMLElement | null = null;
let liveTargets: LiveTargets | null = null;
let liveRefs = 0;

function acquireLiveTargets(): LiveTargets {
  if (!liveRoot || !liveTargets || !liveRoot.isConnected) {
    const root = document.createElement('div');
    root.setAttribute('data-toast-live-regions', '');
    const polite = document.createElement('div');
    polite.setAttribute('role', 'status');
    polite.setAttribute('aria-live', 'polite');
    polite.setAttribute('aria-atomic', 'true');
    const assertive = document.createElement('div');
    assertive.setAttribute('role', 'alert');
    assertive.setAttribute('aria-live', 'assertive');
    assertive.setAttribute('aria-atomic', 'true');
    root.append(polite, assertive);
    document.body.appendChild(root);
    liveRoot = root;
    liveTargets = { polite, assertive };
  }
  liveRefs += 1;
  return liveTargets!;
}

function releaseLiveTargets(): void {
  liveRefs = Math.max(0, liveRefs - 1);
  if (liveRefs === 0 && liveRoot) {
    liveRoot.remove();
    liveRoot = null;
    liveTargets = null;
  }
}

/**
 * Toast wpisywany do stałego regionu na żywo (#1054): sukces do `role="status"` (polite), błąd
 * do `role="alert"` (assertive). Obie części są zawsze w DOM, gdy strona ma `ToastRegion`.
 * Puste regiony nie zajmują miejsca; karta ma pozycję `fixed` i nie przechwytuje kliknięć poza sobą.
 */
export function ToastRegion({
  toast,
  onClose,
  className,
  successMs = SUCCESS_TOAST_MS,
}: ToastRegionProps): React.JSX.Element | null {
  const [targets, setTargets] = React.useState<LiveTargets | null>(null);
  React.useEffect(() => {
    setTargets(acquireLiveTargets());
    return () => {
      releaseLiveTargets();
      setTargets(null);
    };
  }, []);

  if (!targets || !toast) return null;
  const host = toast.tone === 'error' ? targets.assertive : targets.polite;
  return createPortal(
    <ToastInRegionContext.Provider value>
      <div
        className={cn(
          'pointer-events-none fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm [&>*]:pointer-events-auto',
          className,
        )}
      >
        <Toast
          key={toast.id ?? toast.message}
          message={toast.message}
          tone={toast.tone}
          onClose={onClose}
          autoDismissMs={successMs}
        />
      </div>
    </ToastInRegionContext.Provider>,
    host,
  );
}
